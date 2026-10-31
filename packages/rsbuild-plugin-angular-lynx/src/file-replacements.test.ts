import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRspeedy } from '@lynx-js/rspeedy';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pluginAngularCliContext } from './angular-cli-context.js';
import { applyFileReplacements } from './file-replacements.js';
import { pluginAngularLynx } from './plugin-angular-lynx.js';

class NormalModuleReplacementPlugin {}

/**
 * Runs applyFileReplacements's chain hook and returns the plugins it added,
 * by name, with their arguments.
 */
const pluginsFor = (fileReplacements?: Record<string, string>) => {
  const plugins = new Map<string, [unknown, [RegExp, string]]>();
  const chain = {
    plugin: (name: string) => ({
      use: (plugin: unknown, args: [RegExp, string]) => {
        plugins.set(name, [plugin, args]);
      },
    }),
  };
  const api = {
    modifyBundlerChain: vi.fn((hook) =>
      hook(chain, { rspack: { NormalModuleReplacementPlugin } }),
    ),
  };
  applyFileReplacements(api as never, fileReplacements);
  return { plugins, api };
};

describe('applyFileReplacements', () => {
  it("replaces each file with a NormalModuleReplacementPlugin, as Angular's webpack plugin does", () => {
    const { plugins } = pluginsFor({
      '/app/src/environments/environment.ts':
        '/app/src/environments/environment.prod.ts',
      '/app/src/config.json': '/common/config.e2e.json',
    });

    expect([...plugins.keys()]).toEqual([
      'lynx:angular:file-replacement:/app/src/environments/environment.ts',
      'lynx:angular:file-replacement:/app/src/config.json',
    ]);
    const [plugin, [pattern, replacement]] = plugins.get(
      'lynx:angular:file-replacement:/app/src/environments/environment.ts',
    )!;
    expect(plugin).toBe(NormalModuleReplacementPlugin);
    expect(replacement).toBe('/app/src/environments/environment.prod.ts');
    expect(pattern.test('/app/src/environments/environment.ts')).toBe(true);
  });

  // A module's resource is its whole path, so a file whose path contains or
  // starts with another's isn't replaced, and `.` matches only a dot.
  it('matches only the exact path', () => {
    const { plugins } = pluginsFor({
      '/app (1)/src/env.ts': '/app (1)/src/env.prod.ts',
    });
    const [, [pattern]] = [...plugins.values()][0]!;

    expect(pattern.test('/app (1)/src/env.ts')).toBe(true);
    expect(pattern.test('/app (1)/src/env.ts.bak')).toBe(false);
    expect(pattern.test('/other/app (1)/src/env.ts')).toBe(false);
    expect(pattern.test('/app (1)/src/envXts')).toBe(false);
  });

  it('does nothing without file replacements', () => {
    expect(pluginsFor(undefined).api.modifyBundlerChain).not.toHaveBeenCalled();
  });
});

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The app's environment file, which every configuration but `e2e` builds. */
const ORIGINAL_ENVIRONMENT = `export const environment = {
  name: 'original environment',
};
`;

/**
 * The file `e2e` replaces it with. It's outside the workspace, as in a
 * monorepo whose apps share their environments, and imports a file next to
 * it, which must resolve from its own folder.
 */
const replacingEnvironment = (
  name: string,
) => `import { emulatorUrl } from './emulators';

export const environment = {
  name: '${name}',
  emulatorUrl,
};
`;

/**
 * Builds an app that reads its environment on both threads, with a
 * replacement for the environment, through the whole plugin: Angular's
 * compile, the generated background entry, both thread bundles of both
 * environments.
 */
describe('a build with file replacements', () => {
  let root: string;
  let appDir: string;

  beforeAll(() => {
    // The real path: rspack resolves modules to theirs, and the Angular
    // compile's output is looked up by the path it was compiled from.
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-file-replacements-')),
    );
    appDir = path.join(root, 'app');
    const files: Record<string, string> = {
      'app/angular.json': JSON.stringify({
        version: 1,
        projects: {
          app: {
            projectType: 'application',
            root: '',
            sourceRoot: 'src',
            architect: {
              build: { builder: '@blotch/angular-lynx-build:application' },
            },
          },
        },
      }),
      'app/tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          paths: { '@blotch/angular-lynx': ['./src/runtime.ts'] },
        },
        files: ['src/main.ts'],
      }),
      // Stands in for @blotch/angular-lynx, which is built after this
      // package's tests run. The generated background entry imports
      // ɵstartBackgroundThread from it, and a module-level backgroundFn()
      // call puts its module in the background bundle.
      'app/src/runtime.ts': `export const backgroundFn = <T>(fn: T): T => fn;
export const ɵstartBackgroundThread = (): void => {};
`,
      'app/src/main.ts': `import { readEnvironment } from './background';
import { environment } from './environments/environment';
import config from './config.json';

console.info(environment.name, environment, config, readEnvironment);
`,
      'app/src/background.ts': `import { backgroundFn } from '@blotch/angular-lynx';
import { environment } from './environments/environment';
import config from './config.json';

export const readEnvironment = backgroundFn(() => ({ environment, config }));
`,
      'app/src/environments/environment.ts': ORIGINAL_ENVIRONMENT,
      // Angular's builders replace JSON files too.
      'app/src/config.json': JSON.stringify({ name: 'original config' }),
      'common/config.e2e.json': JSON.stringify({ name: 'replacing config' }),
      'common/environments/environment.e2e.ts': replacingEnvironment(
        'replacing environment',
      ),
      'common/environments/emulators.ts': `export const emulatorUrl = 'http://127.0.0.1:9099';
`,
    };
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * Creates the build `ng build -c e2e` would run: the builders hand the
   * plugin the options Angular CLI resolved, relative to the workspace.
   */
  const createBuild = () =>
    createRspeedy({
      cwd: appDir,
      rspeedyConfig: {
        // A development build (`optimization: false`) keeps each thread's
        // code in its own file next to the bundles.
        mode: 'development',
        // No hot update clients: run from source, they're TypeScript that
        // only the package's own build compiles.
        dev: { hmr: false },
        source: { entry: path.join(appDir, 'src/main.ts') },
        environments: { lynx: {}, web: {} },
        resolve: {
          alias: {
            '@blotch/angular-lynx': path.join(appDir, 'src/runtime.ts'),
            // The plugin adds its polyfills by their path in its build
            // output, next to its one bundled module. Run from source, that
            // path is next to angular-config.ts instead.
            [path.join(SOURCE_DIR, 'utils/angular/polyfills')]: path.join(
              SOURCE_DIR,
              'polyfills.js',
            ),
          },
        },
        plugins: [
          pluginAngularCliContext({
            workspaceRoot: appDir,
            project: 'app',
            buildOptions: {
              browser: 'src/main.ts',
              tsConfig: 'tsconfig.json',
              optimization: false,
              fileReplacements: [
                {
                  replace: 'src/environments/environment.ts',
                  with: '../common/environments/environment.e2e.ts',
                },
                {
                  replace: 'src/config.json',
                  with: '../common/config.e2e.json',
                },
              ],
            },
          }),
          pluginAngularLynx(),
        ],
      },
    });

  const read = (file: string) =>
    fs.readFileSync(path.join(appDir, 'dist', file), 'latin1');

  /**
   * Each thread's code, and each environment's bundle.
   */
  const outputs = () => ({
    'main thread': read('main/main-thread.js'),
    'background thread': read('main/background-thread.js'),
    'lynx bundle': read('main.lynx.bundle'),
    'web bundle': read('main.web.bundle'),
  });

  it("builds the replacing file into both threads' bundles", async () => {
    const rspeedy = await createBuild();
    const { close } = await rspeedy.build();
    await close();

    for (const [output, code] of Object.entries(outputs())) {
      expect(code, output).toContain('replacing environment');
      expect(code, output).toContain('http://127.0.0.1:9099');
      expect(code, output).not.toContain('original environment');
      expect(code, output).toContain('replacing config');
      expect(code, output).not.toContain('original config');
    }
  }, 120_000);

  it('rebuilds when the replacing file changes', async () => {
    const rspeedy = await createBuild();
    let compiles = 0;
    let failed = false;
    rspeedy.onAfterBuild(({ stats }) => {
      compiles += 1;
      failed ||= !!stats?.hasErrors();
    });

    const { close } = await rspeedy.build({ watch: true });
    try {
      await vi.waitFor(() => expect(compiles).toBeGreaterThan(0), {
        timeout: 60_000,
      });
      fs.writeFileSync(
        path.join(root, 'common/environments/environment.e2e.ts'),
        replacingEnvironment('edited environment'),
      );

      // Polled rather than awaited after the next compile: each environment
      // rebuilds on its own, so the first to finish reports a compile while
      // the other may not have written its bundle yet. A build that doesn't
      // watch the replacing file never gets there.
      await vi.waitFor(
        () => {
          expect(failed, 'a compile failed').toBe(false);
          for (const [output, code] of Object.entries(outputs())) {
            expect(code, output).toContain('edited environment');
            expect(code, output).not.toContain('replacing environment');
          }
        },
        { timeout: 30_000, interval: 250 },
      );
    } finally {
      await close();
    }
  }, 120_000);
});

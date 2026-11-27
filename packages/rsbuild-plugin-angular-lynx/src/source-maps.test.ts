import fs from 'node:fs';
import { SourceMap } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRspeedy } from '@lynx-js/rspeedy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pluginAngularCliContext } from './angular-cli-context.js';
import { pluginAngularLynx } from './plugin-angular-lynx.js';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * A published library's module, which the plugin rewrites as it builds it
 * (Angular's transformer, the cross-thread and es-builtins passes).
 */
const LIBRARY = `export function fromLibrary() {
  return 'library marker';
}
//# sourceMappingURL=index.mjs.map
`;

/**
 * The map published beside it, which can only describe the file as
 * published. It puts every line down to a `wrong.ts`, so any of it in the
 * build's map shows the build laid it over the rewritten code.
 */
const STALE_MAP = JSON.stringify({
  version: 3,
  file: 'index.mjs',
  sources: ['wrong.ts'],
  sourcesContent: ['nothing here\n'],
  names: [],
  // Each line's start to the start of the next line of `wrong.ts`: `AAAA`
  // for the first, and one line on (`C`) for each after.
  mappings: ['AAAA', ...Array(3).fill(`AA${'C'}A`)].join(';'),
});

/**
 * Builds an app through the whole plugin with source maps on, and reads the
 * native main-thread script's map: the library's code must map to the
 * library's module, and the app's to its own TypeScript (issue #722).
 */
describe("the main-thread script's source map", () => {
  let root: string;
  let appDir: string;

  beforeAll(() => {
    // The real path: the Angular compile's output is looked up by the path
    // it was compiled from, and rspack resolves modules to theirs.
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-source-maps-')),
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
        },
        files: ['src/main.ts', 'src/library.d.ts'],
      }),
      // Stands in for @blotch/angular-lynx, which is built after this
      // package's tests run: the generated background entry imports it.
      'app/src/runtime.js': `export const ɵstartBackgroundThread = () => {};
`,
      // The interface leaves the compiled code, so only Angular's map puts
      // the function back on its line in the TypeScript.
      'app/src/main.ts': `import { fromLibrary } from 'library';

interface Marked {
  marker: string;
}

export function fromApp(): Marked['marker'] {
  return 'app marker';
}

console.info(fromApp(), fromLibrary());
`,
      'app/src/library.d.ts': `declare module 'library';
`,
      'app/node_modules/library/package.json': JSON.stringify({
        name: 'library',
        type: 'module',
        exports: './index.mjs',
      }),
      'app/node_modules/library/index.mjs': LIBRARY,
      'app/node_modules/library/index.mjs.map': STALE_MAP,
    };
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('maps each piece of code to the file it came from', async () => {
    const rspeedy = await createRspeedy({
      cwd: appDir,
      rspeedyConfig: {
        // A development build (`optimization: false`) keeps the main
        // thread's script in the intermediate folder.
        mode: 'development',
        dev: { hmr: false, liveReload: false },
        output: { sourceMap: { js: 'source-map' } },
        source: { entry: path.join(appDir, 'src/main.ts') },
        environments: { lynx: {} },
        resolve: {
          alias: {
            '@blotch/angular-lynx': path.join(appDir, 'src/runtime.js'),
            // The plugin adds its polyfills by their path in its build
            // output. Run from source, that path is next to
            // angular-config.ts instead.
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
              // Angular's compiler then leaves an inline map in the app's
              // modules, which has to reach the bundle's map.
              sourceMap: true,
            },
          }),
          pluginAngularLynx(),
        ],
      },
    });
    const { close } = await rspeedy.build();
    await close();

    const script = fs.readFileSync(
      path.join(appDir, 'dist/.lynx/main/main-thread.js'),
      'utf8',
    );
    // The map LynxTemplatePlugin's debug metadata carries for the script,
    // which DevTool and crash reports read (LynxEncodePlugin deletes the
    // `.map` file once it's encoded the script).
    const metadata = JSON.parse(
      fs.readFileSync(
        path.join(appDir, 'dist/.lynx/main/debug-metadata.json'),
        'utf8',
      ),
    );
    const payload = metadata.artifacts
      .find(({ kind }: { kind: string }) => kind === 'main-thread')
      .debugSources.find(
        ({ kind }: { kind: string }) => kind === 'source-map',
      ).map;
    const map = new SourceMap(payload);
    /**
     * Where the map puts the first character of `text` in the script.
     */
    const origin = (text: string) => {
      const at = script.indexOf(text);
      expect(at).toBeGreaterThan(-1);
      const before = script.slice(0, at).split('\n');
      const entry = map.findEntry(
        before.length - 1,
        before[before.length - 1]!.length,
      );
      if (!('originalSource' in entry)) {
        throw new Error(`No mapping for ${text}`);
      }
      const index = payload.sources.indexOf(entry.originalSource);
      return {
        source: entry.originalSource,
        line: (payload.sourcesContent[index] as string).split('\n')[
          entry.originalLine
        ],
        // Whether the map holds the module's TypeScript, rather than the
        // JavaScript the plugin was given.
        typeScript: (payload.sourcesContent[index] as string).includes(
          'interface',
        ),
      };
    };

    expect(payload.sources.some((source: string) => /wrong/.test(source))).toBe(
      false,
    );
    expect(origin("'library marker'")).toEqual({
      source: expect.stringMatching(/node_modules\/library\/index\.mjs$/),
      line: expect.stringContaining("'library marker'"),
      typeScript: false,
    });
    expect(origin("'app marker'")).toEqual({
      source: expect.stringMatching(/src\/main\.ts$/),
      line: expect.stringContaining("'app marker'"),
      typeScript: true,
    });
  }, 120_000);
});

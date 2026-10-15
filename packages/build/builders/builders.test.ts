import type { BuilderContext } from '@angular-devkit/architect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runApplication } from './application/index';
import { runDevServer } from './dev-server/index';
import { importFromProject } from './project-import';
import type { RspeedyModule, RspeedyPluginModule } from './rspeedy';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-builders-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'my-app', version: '2.0.0' }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * The Angular CLI side of a builder run: the project, and the build target
 * `ng serve` reads its options from.
 */
const fakeContext = (
  project: string | undefined = 'my-app',
  buildTargets: Record<string, Record<string, unknown>> = {
    'my-app:build:development': { tsConfig: 'tsconfig.app.json' },
  },
) => {
  const teardowns: (() => unknown)[] = [];
  const context = {
    target: project ? { project, target: 'build' } : undefined,
    workspaceRoot: root,
    getProjectMetadata: vi.fn(async () => ({ root: '' })),
    getTargetOptions: vi.fn(
      async (target: {
        project: string;
        target: string;
        configuration?: string;
      }) => {
        const options =
          buildTargets[
            [target.project, target.target, target.configuration]
              .filter(Boolean)
              .join(':')
          ];
        if (!options) {
          throw new Error(`No options for ${JSON.stringify(target)}`);
        }
        return options;
      },
    ),
    getBuilderNameForTarget: vi.fn(
      async () => '@blotch/angular-lynx-build:application',
    ),
    // Architect fills in schema defaults here; this stands in for one.
    validateOptions: vi.fn(async (options: Record<string, unknown>) => ({
      orientation: 'portrait',
      ...options,
    })),
    reportStatus: vi.fn(),
    addTeardown: (teardown: () => unknown) => teardowns.push(teardown),
    logger: { info: vi.fn() },
  };
  return {
    context: context as unknown as BuilderContext,
    teardowns,
    raw: context,
  };
};

/**
 * rspeedy's loadConfig/createRspeedy, recording what the builder asked for.
 */
const fakeRspeedy = (config: Record<string, unknown> = {}) => {
  const close = vi.fn(async () => {});
  const serverClose = vi.fn(async () => {});
  const instance = {
    context: { distPath: path.join(root, 'dist'), rootPath: root },
    build: vi.fn(async () => ({ close })),
    startDevServer: vi.fn(async () => ({
      urls: ['http://localhost:3000'],
      port: 3000,
      server: { close: serverClose },
    })),
  };
  const rspeedy: RspeedyModule = {
    loadConfig: vi.fn(async () => ({
      content: { ...config },
      configPath: path.join(root, 'lynx.config.ts'),
    })),
    createRspeedy: vi.fn(async () => instance),
  };
  /**
   * The config the builder handed to rspeedy.
   */
  const passedConfig = () =>
    vi.mocked(rspeedy.createRspeedy).mock.calls[0]![0].rspeedyConfig!;
  return { rspeedy, instance, close, serverClose, passedConfig };
};

/** What `pluginAngularLynx()` returns, as far as the builders can tell. */
const angularPlugin = { name: 'lynx:angular' };
/**
 * What `pluginAngularCliContext()` returns: a plugin carrying the context.
 */
const contextPlugin = (context: unknown) => ({
  name: 'lynx:angular-cli-context',
  context,
});
const importPlugin = async (): Promise<RspeedyPluginModule> => ({
  pluginAngularLynx: () => angularPlugin,
  pluginAngularCliContext: contextPlugin,
});

describe('application builder', () => {
  it('builds the bundle like `rspeedy build` without --platform', async () => {
    const { rspeedy, close } = fakeRspeedy();
    const importNative = vi.fn();
    const { context } = fakeContext();
    const options = { mode: 'development', tsConfig: 'tsconfig.app.json' };
    const result = await runApplication(options as never, context, {
      importRspeedy: async () => rspeedy,
      importPlugin,
      importNative,
    });
    expect(result).toEqual({ success: true });
    expect(rspeedy.loadConfig).toHaveBeenCalledWith({
      cwd: root,
      configPath: undefined,
    });
    expect(rspeedy.createRspeedy).toHaveBeenCalledWith({
      cwd: root,
      rspeedyConfig: {
        mode: 'development',
        plugins: [
          // The options as Angular CLI merged them reach the plugin as they
          // are: the builder doesn't re-read angular.json.
          contextPlugin({
            workspaceRoot: root,
            project: 'my-app',
            buildOptions: options,
          }),
          angularPlugin,
        ],
      },
      environment: [],
    });
    expect(close).toHaveBeenCalled();
    expect(importNative).not.toHaveBeenCalled();
  });

  it('builds only the lynx environment, then each platform, with --platform all', async () => {
    const { rspeedy } = fakeRspeedy();
    const buildNativeApp = vi.fn(
      async ({ platform }: { platform: string }) => ({
        artifacts: [path.join(root, 'dist', platform, 'app')],
        projectDir: '',
      }),
    );
    const { context, raw } = fakeContext();
    const result = await runApplication(
      {
        platform: 'all',
        appId: 'com.example.app',
        tsConfig: 'tsconfig.app.json',
      },
      context,
      {
        importRspeedy: async () => rspeedy,
        importPlugin,
        importNative: async () => ({ buildNativeApp }) as never,
      },
    );
    expect(result).toEqual({ success: true });
    expect(rspeedy.createRspeedy).toHaveBeenCalledWith(
      expect.objectContaining({ environment: ['lynx'] }),
    );
    expect(buildNativeApp.mock.calls.map(([options]) => options)).toEqual(
      ['ios', 'android'].map((platform) =>
        expect.objectContaining({
          platform,
          projectRoot: root,
          projectName: 'my-app',
          packageVersion: '2.0.0',
          bundleDir: path.join(root, 'dist'),
          outputDir: path.join(root, 'dist', platform),
          app: expect.objectContaining({ appId: 'com.example.app' }),
        }),
      ),
    );
    expect(raw.logger.info).toHaveBeenCalledWith('  ✓ dist/ios/app');
  });

  it('turns failures into a failed build with the message', async () => {
    const { rspeedy, instance } = fakeRspeedy();
    instance.build.mockRejectedValueOnce(new Error('Rspack build failed.'));
    const result = await runApplication({}, fakeContext().context, {
      importRspeedy: async () => rspeedy,
      importPlugin,
      importNative: vi.fn(),
    });
    expect(result).toEqual({ success: false, error: 'Rspack build failed.' });
  });

  it('fails before bundling when the native builder fails to load', async () => {
    const { rspeedy } = fakeRspeedy();
    const result = await runApplication(
      { platform: 'ios' },
      fakeContext().context,
      {
        importRspeedy: async () => rspeedy,
        importPlugin,
        importNative: async () => {
          throw new Error("Cannot find module '@blotch/angular-lynx-native'");
        },
      },
    );
    expect(result.success).toBe(false);
    expect(rspeedy.loadConfig).not.toHaveBeenCalled();
  });

  it('needs a project', async () => {
    expect(
      await runApplication({}, fakeContext(null as never).context),
    ).toEqual({
      success: false,
      error: 'The builder needs a project target.',
    });
  });

  it('invalidates a persistent build cache when lynx.config.ts changes, as rspeedy does', async () => {
    const configPath = path.join(root, 'lynx.config.ts');
    for (const [buildCache, expected] of [
      [true, { buildDependencies: [configPath] }],
      [{ buildDependencies: ['a'] }, { buildDependencies: ['a', configPath] }],
      [{}, { buildDependencies: [configPath] }],
    ] as const) {
      const { rspeedy, passedConfig } = fakeRspeedy({
        performance: { buildCache },
      });
      await runApplication({}, fakeContext().context, {
        importRspeedy: async () => rspeedy,
        importPlugin,
        importNative: vi.fn(),
      });
      expect(passedConfig()['performance']).toEqual({ buildCache: expected });
    }
  });
});

describe('the AngularLynx plugin', () => {
  const pluginsPassed = async (plugins: unknown) => {
    const { rspeedy, passedConfig } = fakeRspeedy(
      plugins === undefined ? {} : { plugins },
    );
    await runApplication({}, fakeContext().context, {
      importRspeedy: async () => rspeedy,
      importPlugin,
      importNative: vi.fn(),
    });
    return passedConfig()['plugins'];
  };
  const cliContext = contextPlugin({
    workspaceRoot: expect.any(String),
    project: 'my-app',
    buildOptions: {},
  });

  it("is added after lynx.config.ts's own plugins, with the Angular CLI context first", async () => {
    const qrCode = { name: 'lynx:qrcode' };
    expect(await pluginsPassed([qrCode])).toEqual([
      cliContext,
      qrCode,
      angularPlugin,
    ]);
  });

  it('is added to a config without plugins', async () => {
    expect(await pluginsPassed(undefined)).toEqual([cliContext, angularPlugin]);
  });

  it('is not added again when lynx.config.ts lists it to pass options', async () => {
    const configured = { name: 'lynx:angular', options: { enableSSR: true } };
    for (const plugins of [
      [configured],
      [false, null, [Promise.resolve(configured)]],
    ]) {
      expect(await pluginsPassed(plugins)).toEqual([cliContext, ...plugins]);
    }
  });
});

describe('NODE_ENV', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to production for ng build and development for ng serve, as rspeedy does', async () => {
    vi.stubEnv('NODE_ENV', '');
    await runApplication({}, fakeContext().context, {
      importRspeedy: async () => fakeRspeedy().rspeedy,
      importPlugin,
      importNative: vi.fn(),
    });
    expect(process.env['NODE_ENV']).toBe('production');

    vi.stubEnv('NODE_ENV', '');
    await runDevServer({}, fakeContext().context, {
      importRspeedy: async () => fakeRspeedy().rspeedy,
      importPlugin,
    })
      [Symbol.asyncIterator]()
      .next();
    expect(process.env['NODE_ENV']).toBe('development');
  });

  it('keeps one that is already set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await runApplication({}, fakeContext().context, {
      importRspeedy: async () => fakeRspeedy().rspeedy,
      importPlugin,
      importNative: vi.fn(),
    });
    expect(process.env['NODE_ENV']).toBe('development');
  });
});

describe('dev-server builder', () => {
  const serve = async (
    options: Parameters<typeof runDevServer>[0],
    buildTargets?: Record<string, Record<string, unknown>>,
    config: Record<string, unknown> = {},
  ) => {
    const fake = fakeRspeedy(config);
    const ctx = fakeContext('my-app', buildTargets);
    const outputs = runDevServer(options, ctx.context, {
      importRspeedy: async () => fake.rspeedy,
      importPlugin,
    })[Symbol.asyncIterator]();
    const first = await outputs.next();
    return { ...fake, ...ctx, outputs, first };
  };

  it('starts the dev server, reports its URL and closes it on teardown', async () => {
    const { first, teardowns, serverClose } = await serve({});
    expect(first.value).toEqual({
      success: true,
      baseUrl: 'http://localhost:3000',
    });
    await Promise.all(teardowns.map((teardown) => teardown()));
    expect(serverClose).toHaveBeenCalled();
  });

  it("serves the build target's development configuration by default, as Angular's dev server does", async () => {
    const { raw, rspeedy, passedConfig } = await serve(
      {},
      {
        'my-app:build:development': {
          tsConfig: 'tsconfig.app.json',
          config: 'lynx.dev.ts',
          mode: 'development',
          environment: ['lynx'],
        },
      },
    );
    expect(raw.getTargetOptions).toHaveBeenCalledWith({
      project: 'my-app',
      target: 'build',
      configuration: 'development',
    });
    expect(raw.validateOptions).toHaveBeenCalledWith(
      expect.objectContaining({ tsConfig: 'tsconfig.app.json' }),
      '@blotch/angular-lynx-build:application',
    );
    // The build target's rspeedy settings apply.
    expect(rspeedy.loadConfig).toHaveBeenCalledWith({
      cwd: root,
      configPath: 'lynx.dev.ts',
    });
    expect(rspeedy.createRspeedy).toHaveBeenCalledWith(
      expect.objectContaining({ environment: ['lynx'] }),
    );
    expect(passedConfig()['mode']).toBe('development');
    // And the plugin compiles with the build target's validated options.
    expect(passedConfig()['plugins']).toContainEqual(
      contextPlugin({
        workspaceRoot: root,
        project: 'my-app',
        buildOptions: {
          orientation: 'portrait',
          tsConfig: 'tsconfig.app.json',
          config: 'lynx.dev.ts',
          mode: 'development',
          environment: ['lynx'],
        },
      }),
    );
  });

  it('serves the build target it is given, e.g. `ng serve -c production`', async () => {
    const { raw, passedConfig } = await serve(
      { buildTarget: 'my-app:build:production' },
      { 'my-app:build:production': { mode: 'production' } },
    );
    expect(raw.getTargetOptions).toHaveBeenCalledWith({
      project: 'my-app',
      target: 'build',
      configuration: 'production',
    });
    expect(passedConfig()['mode']).toBe('production');
  });

  it("applies its own environment, port and host over the build target's and lynx.config.ts's", async () => {
    const { rspeedy, passedConfig } = await serve(
      { environment: ['web'], port: 4300, host: '127.0.0.1' },
      { 'my-app:build:development': { environment: ['lynx'] } },
      { server: { port: 3000, base: '/app' } },
    );
    expect(rspeedy.createRspeedy).toHaveBeenCalledWith(
      expect.objectContaining({ environment: ['web'] }),
    );
    expect(passedConfig()['server']).toEqual({
      port: 4300,
      host: '127.0.0.1',
      base: '/app',
    });
  });

  it("leaves lynx.config.ts's server settings alone without port or host", async () => {
    const { passedConfig } = await serve({}, undefined, {
      server: { port: 3000 },
    });
    expect(passedConfig()['server']).toEqual({ port: 3000 });
  });

  it('reports a build target that has no such configuration', async () => {
    const { first } = await serve({}, {});
    expect(first.value).toEqual({
      success: false,
      error:
        'No options for {"project":"my-app","target":"build","configuration":"development"}',
    });
  });

  it('reports a dev server that fails to start', async () => {
    const fake = fakeRspeedy();
    fake.instance.startDevServer.mockRejectedValueOnce(
      new Error('port in use'),
    );
    const outputs = runDevServer({}, fakeContext().context, {
      importRspeedy: async () => fake.rspeedy,
      importPlugin,
    })[Symbol.asyncIterator]();
    expect((await outputs.next()).value).toEqual({
      success: false,
      error: 'port in use',
    });
    expect((await outputs.next()).done).toBe(true);
  });

  it('needs a project', async () => {
    const outputs = runDevServer({}, fakeContext(null as never).context)[
      Symbol.asyncIterator
    ]();
    expect((await outputs.next()).value).toEqual({
      success: false,
      error: 'The builder needs a project target.',
    });
  });
});

describe('importFromProject', () => {
  const install = (
    name: string,
    packageJson: object,
    files: Record<string, string>,
  ) => {
    const dir = path.join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, ...packageJson }),
    );
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
  };

  it("imports an ESM-only package's import entry from the project", async () => {
    install(
      'esm-only',
      {
        type: 'module',
        exports: {
          '.': { types: './index.d.ts', import: './dist/index.js' },
          './package.json': './package.json',
        },
      },
      { 'dist/index.js': 'export const answer = 42;' },
    );
    expect(
      await importFromProject<{ answer: number }>('esm-only', root, ''),
    ).toMatchObject({ answer: 42 });
  });

  it('follows nested conditions and falls back to main', async () => {
    install(
      'nested',
      {
        type: 'module',
        exports: {
          '.': { node: { import: './n.js' } },
          './package.json': './package.json',
        },
      },
      { 'n.js': 'export default 1;' },
    );
    install(
      'main-only',
      { type: 'module', main: './m.js' },
      { 'm.js': 'export default 2;' },
    );
    expect(
      (await importFromProject<{ default: number }>('nested', root, ''))
        .default,
    ).toBe(1);
    expect(
      (await importFromProject<{ default: number }>('main-only', root, ''))
        .default,
    ).toBe(2);
  });

  it('says how to install a missing package', async () => {
    await expect(
      importFromProject(
        'not-installed',
        root,
        'Run npm install not-installed.',
      ),
    ).rejects.toThrow(
      'not-installed is not installed. Run npm install not-installed.',
    );
  });

  it('rejects a package without an entry point', async () => {
    install(
      'no-entry',
      { exports: { './package.json': './package.json', '.': null } },
      {},
    );
    await expect(importFromProject('no-entry', root, '')).rejects.toThrow(
      'no-entry has no ESM entry point.',
    );
  });
});

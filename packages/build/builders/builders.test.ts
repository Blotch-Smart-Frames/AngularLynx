import type { BuilderContext } from '@angular-devkit/architect';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequire } from 'node:module';

import { ANGULAR_BUILD_OPTIONS, ASSET_LOADERS } from './angular-build';
import applicationSchema from './application/schema.json';
import { runApplication } from './application/index';
import { nativeCacheDir } from './application/native-cache';
import { runDevServer } from './dev-server/index';
import extractI18nSchema from './extract-i18n/schema.json';
import {
  type ExtractI18nBuilderDeps,
  hasLocalize,
  runExtractI18n,
} from './extract-i18n/index';
import { importFromProject } from './project-import';
import {
  type RspeedyBuildResult,
  type RspeedyModule,
  type RspeedyPluginModule,
  modeFromOptimization,
} from './rspeedy';
import unitTestSchema from './unit-test/schema.json';
import {
  type AngularBuildModule,
  hasTestingLibrary,
  runUnitTest,
} from './unit-test/index';

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
 * A stand-in for the project's @angular/build, which only needs a version.
 */
const installAngularBuild = (version: string) => {
  const dir = path.join(root, 'node_modules/@angular/build');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@angular/build', version }),
  );
};

/**
 * The Angular CLI side of a builder run: the project, and the build target
 * `ng serve` reads its options from.
 */
const fakeContext = (
  project: string | undefined = 'my-app',
  buildTargets: Record<string, Record<string, unknown>> = {
    'my-app:build:development': {
      tsConfig: 'tsconfig.app.json',
      optimization: false,
    },
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
 * Given a config, the project has a lynx.config.ts that loads as it.
 */
const fakeRspeedy = (config?: Record<string, unknown>) => {
  if (config) {
    writeFileSync(path.join(root, 'lynx.config.ts'), 'export default {};');
  }
  const close = vi.fn(async () => {});
  const serverClose = vi.fn(async () => {});
  const afterBuild: ((result: RspeedyBuildResult) => void)[] = [];
  const instance = {
    context: { distPath: path.join(root, 'dist'), rootPath: root },
    build: vi.fn(async (_options?: { watch?: boolean }) => ({ close })),
    onAfterBuild: (callback: (result: RspeedyBuildResult) => void) =>
      afterBuild.push(callback),
    /** Reports a compile, as rspeedy does after each (re)build. */
    compiled: (hasErrors: boolean) => {
      for (const callback of afterBuild) {
        callback({ stats: { hasErrors: () => hasErrors } });
      }
    },
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

/**
 * The first result a builder reports, which is all a one-shot build reports.
 */
const firstOutput = async <T>(outputs: AsyncIterable<T>): Promise<T> =>
  (await outputs[Symbol.asyncIterator]().next()).value as T;

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

/**
 * What `pluginQRCode()` returns, as far as the dev server can tell.
 */
const qrCodePlugin = (options: unknown) => ({
  name: 'lynx:rsbuild:qrcode',
  options,
});
const importQRCodePlugin = async () => ({ pluginQRCode: qrCodePlugin });

describe('application builder', () => {
  const build = (
    options: Record<string, unknown>,
    rspeedy: RspeedyModule,
    context = fakeContext().context,
    importNative: () => Promise<never> = vi.fn(),
  ) =>
    runApplication(options as never, context, {
      importRspeedy: async () => rspeedy,
      importPlugin,
      importNative,
    });

  it('builds the bundle like `rspeedy build` without --platform', async () => {
    const { rspeedy, close } = fakeRspeedy({});
    const importNative = vi.fn();
    const options = {
      optimization: false,
      tsConfig: 'tsconfig.app.json',
      browser: 'src/main.ts',
    };
    const result = await firstOutput(
      build(options, rspeedy, fakeContext().context, importNative),
    );
    expect(result).toEqual({ success: true });
    expect(rspeedy.loadConfig).toHaveBeenCalledWith({
      cwd: root,
      configPath: undefined,
    });
    expect(rspeedy.createRspeedy).toHaveBeenCalledWith({
      cwd: root,
      rspeedyConfig: {
        mode: 'development',
        environments: { lynx: {}, web: {} },
        source: { entry: path.join(root, 'src/main.ts') },
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

  it('builds the app from angular.json alone when the project has no lynx.config.ts', async () => {
    const { rspeedy, passedConfig } = fakeRspeedy();
    await firstOutput(build({ browser: 'src/main.ts' }, rspeedy));
    expect(rspeedy.loadConfig).not.toHaveBeenCalled();
    expect(passedConfig()).toEqual({
      mode: 'production',
      environments: { lynx: {}, web: {} },
      source: { entry: path.join(root, 'src/main.ts') },
      plugins: [expect.anything(), angularPlugin],
    });
  });

  it("keeps lynx.config.ts's entry and environments", async () => {
    const { passedConfig, rspeedy } = fakeRspeedy({
      environments: { lynx: {} },
      source: { entry: { main: './src/main.ts', settings: './src/s.ts' } },
    });
    await firstOutput(build({ browser: 'src/main.ts' }, rspeedy));
    expect(passedConfig()).toMatchObject({
      environments: { lynx: {} },
      source: { entry: { main: './src/main.ts', settings: './src/s.ts' } },
    });
  });

  it('loads the config file the `config` option names, which rspeedy requires to exist', async () => {
    const { rspeedy } = fakeRspeedy();
    await firstOutput(build({ config: 'lynx.prod.ts' }, rspeedy));
    expect(rspeedy.loadConfig).toHaveBeenCalledWith({
      cwd: root,
      configPath: 'lynx.prod.ts',
    });
  });

  it('builds only the lynx environment, then each platform, with --platform all', async () => {
    installAngularBuild('22.2.2');
    const { rspeedy } = fakeRspeedy();
    const buildNativeApp = vi.fn(
      async ({ platform }: { platform: string }) => ({
        artifacts: [path.join(root, 'dist', platform, 'app')],
        projectDir: '',
      }),
    );
    const { context, raw } = fakeContext();
    const result = await firstOutput(
      build(
        {
          platform: 'all',
          appId: 'com.example.app',
          tsConfig: 'tsconfig.app.json',
        },
        rspeedy,
        context,
        async () => ({ buildNativeApp }) as never,
      ),
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
          workDir: path.join(root, '.angular/cache/22.2.2/my-app/lynx-native'),
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

  it('fails before bundling without @angular/build, which names the cache folder', async () => {
    const { rspeedy } = fakeRspeedy({});
    const result = await firstOutput(
      build(
        { platform: 'ios' },
        rspeedy,
        fakeContext().context,
        async () => ({}) as never,
      ),
    );
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('@angular/build is not installed'),
    });
    expect(rspeedy.loadConfig).not.toHaveBeenCalled();
  });

  it('turns failures into a failed build with the message', async () => {
    const { rspeedy, instance } = fakeRspeedy();
    instance.build.mockRejectedValueOnce(new Error('Rspack build failed.'));
    expect(await firstOutput(build({}, rspeedy))).toEqual({
      success: false,
      error: 'Rspack build failed.',
    });
  });

  it('turns a config that fails to load into a failed build', async () => {
    const { rspeedy } = fakeRspeedy({});
    vi.mocked(rspeedy.loadConfig).mockRejectedValueOnce('not an Error');
    expect(await firstOutput(build({}, rspeedy))).toEqual({
      success: false,
      error: 'not an Error',
    });
  });

  it('fails before bundling when the native builder fails to load', async () => {
    const { rspeedy } = fakeRspeedy({});
    const result = await firstOutput(
      build({ platform: 'ios' }, rspeedy, fakeContext().context, async () => {
        throw new Error("Cannot find module '@blotch/angular-lynx-native'");
      }),
    );
    expect(result.success).toBe(false);
    expect(rspeedy.loadConfig).not.toHaveBeenCalled();
  });

  it('needs a project', async () => {
    expect(
      await firstOutput(runApplication({}, fakeContext(null as never).context)),
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
      await firstOutput(build({}, rspeedy));
      expect(passedConfig()['performance']).toEqual({ buildCache: expected });
    }
  });

  describe('--watch', () => {
    it('reports every rebuild and stops watching on teardown', async () => {
      const { rspeedy, instance, close } = fakeRspeedy();
      const { context, teardowns } = fakeContext();
      const outputs = build({ watch: true }, rspeedy, context)[
        Symbol.asyncIterator
      ]();
      const first = outputs.next();
      // Wait for the watch build to start, then compile twice: a broken
      // save fails that result but the watch goes on.
      await vi.waitFor(() =>
        expect(instance.build).toHaveBeenCalledWith({ watch: true }),
      );
      instance.compiled(false);
      expect((await first).value).toEqual({ success: true });
      instance.compiled(true);
      instance.compiled(false);
      expect((await outputs.next()).value).toEqual({ success: false });
      expect((await outputs.next()).value).toEqual({ success: true });
      await Promise.all(teardowns.map((teardown) => teardown()));
      expect(close).toHaveBeenCalled();
    });

    it('reports a watch build that fails to start', async () => {
      const { rspeedy, instance } = fakeRspeedy();
      instance.build.mockRejectedValueOnce(new Error('no compiler'));
      expect(await firstOutput(build({ watch: true }, rspeedy))).toEqual({
        success: false,
        error: 'no compiler',
      });
    });

    it("can't be combined with --platform", async () => {
      const { rspeedy } = fakeRspeedy();
      const result = await firstOutput(
        build({ watch: true, platform: 'ios' }, rspeedy),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('--platform');
      expect(rspeedy.createRspeedy).not.toHaveBeenCalled();
    });
  });
});

describe('the mode', () => {
  it("follows Angular's optimization option, as Angular's dev mode does", () => {
    expect(modeFromOptimization(undefined)).toBe('production');
    expect(modeFromOptimization(true)).toBe('production');
    expect(modeFromOptimization(false)).toBe('development');
    expect(modeFromOptimization({ scripts: true })).toBe('production');
    expect(modeFromOptimization({ styles: true })).toBe('development');
  });
});

describe('the AngularLynx plugin', () => {
  const pluginsPassed = async (plugins: unknown) => {
    const { rspeedy, passedConfig } = fakeRspeedy(
      plugins === undefined ? {} : { plugins },
    );
    await firstOutput(
      runApplication({}, fakeContext().context, {
        importRspeedy: async () => rspeedy,
        importPlugin,
        importNative: vi.fn(),
      }),
    );
    return passedConfig()['plugins'];
  };
  const cliContext = contextPlugin({
    workspaceRoot: expect.any(String),
    project: 'my-app',
    buildOptions: {},
  });

  it("is added after lynx.config.ts's own plugins, with the Angular CLI context first", async () => {
    const other = { name: 'lynx:other' };
    expect(await pluginsPassed([other])).toEqual([
      cliContext,
      other,
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

  it("follows the mode: production for a production build, development for ng serve's default", async () => {
    vi.stubEnv('NODE_ENV', '');
    await firstOutput(
      runApplication({}, fakeContext().context, {
        importRspeedy: async () => fakeRspeedy().rspeedy,
        importPlugin,
        importNative: vi.fn(),
      }),
    );
    expect(process.env['NODE_ENV']).toBe('production');

    vi.stubEnv('NODE_ENV', '');
    await firstOutput(
      runDevServer({}, fakeContext().context, {
        importRspeedy: async () => fakeRspeedy().rspeedy,
        importPlugin,
        importQRCodePlugin,
      }),
    );
    expect(process.env['NODE_ENV']).toBe('development');
  });

  it('keeps one that is already set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await firstOutput(
      runApplication({}, fakeContext().context, {
        importRspeedy: async () => fakeRspeedy().rspeedy,
        importPlugin,
        importNative: vi.fn(),
      }),
    );
    expect(process.env['NODE_ENV']).toBe('development');
  });
});

describe('dev-server builder', () => {
  const serve = async (
    options: Parameters<typeof runDevServer>[0],
    buildTargets?: Record<string, Record<string, unknown>>,
    config?: Record<string, unknown>,
  ) => {
    const fake = fakeRspeedy(config);
    const ctx = fakeContext('my-app', buildTargets);
    const outputs = runDevServer(options, ctx.context, {
      importRspeedy: async () => fake.rspeedy,
      importPlugin,
      importQRCodePlugin,
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
          optimization: false,
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
          optimization: false,
          environment: ['lynx'],
        },
      }),
    );
  });

  it('serves the build target it is given, e.g. `ng serve -c production`', async () => {
    const { raw, passedConfig } = await serve(
      { buildTarget: 'my-app:build:production' },
      { 'my-app:build:production': { outputHashing: 'all' } },
    );
    expect(raw.getTargetOptions).toHaveBeenCalledWith({
      project: 'my-app',
      target: 'build',
      configuration: 'production',
    });
    expect(passedConfig()['mode']).toBe('production');
  });

  it('prints the Lynx Explorer QR code in full screen, unless lynx.config.ts configures it', async () => {
    const { passedConfig } = await serve({});
    expect(passedConfig()['plugins']).toContainEqual(
      qrCodePlugin({ fullscreen: true }),
    );

    const configured = { name: 'lynx:rsbuild:qrcode', options: 'custom' };
    const second = await serve({}, undefined, { plugins: [configured] });
    expect(
      (second.passedConfig()['plugins'] as { name: string }[]).filter(
        ({ name }) => name === 'lynx:rsbuild:qrcode',
      ),
    ).toEqual([configured]);
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
      importQRCodePlugin,
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

/**
 * A schema of @angular/build's, which its `exports` don't list.
 */
const angularSchema = (builder: string) =>
  JSON.parse(
    readFileSync(
      path.join(
        path.dirname(
          createRequire(__filename).resolve('@angular/build/package.json'),
        ),
        'src/builders',
        builder,
        'schema.json',
      ),
      'utf8',
    ),
  );

describe('unit-test builder', () => {
  /**
   * @angular/build's unit-test builder, recording what it was handed.
   */
  const fakeAngularBuild = () => {
    const calls: {
      options: Record<string, unknown>;
      context: BuilderContext;
    }[] = [];
    const angularBuild: AngularBuildModule = {
      executeUnitTestBuilder: async function* (options, context) {
        calls.push({ options: options as never, context });
        yield { success: true };
      },
    };
    return { angularBuild, calls };
  };

  const test = async (
    options: Record<string, unknown> = {},
    { testingLibrary = false } = {},
  ) => {
    const { angularBuild, calls } = fakeAngularBuild();
    const ctx = fakeContext('my-app', {
      'my-app:build:development': {
        tsConfig: 'tsconfig.app.json',
        appId: 'com.example.app',
        platform: 'ios',
        config: 'lynx.config.ts',
        environment: ['lynx'],
      },
      'my-app:lib:development': { project: 'ng-package.json' },
    });
    const result = await firstOutput(
      runUnitTest(options as never, ctx.context, {
        importAngularBuild: async () => angularBuild,
        hasTestingLibrary: () => testingLibrary,
      }),
    );
    return { ...ctx, result, ...calls[0]! };
  };

  const buildTarget = {
    project: 'my-app',
    target: 'build',
    configuration: 'development',
  };
  const LYNX_GLOBALS = '@blotch/angular-lynx-build/unit-test/lynx-globals';

  it("runs Angular's unit-test builder with the options it was given", async () => {
    const { result, options } = await test({
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test-setup.ts'],
    });
    expect(result).toEqual({ success: true });
    expect(options).toEqual({
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/test-setup.ts'],
    });
  });

  it('leaves out the empty lists Angular CLI fills in for options the user left out', async () => {
    const { options } = await test({
      reporters: [],
      browsers: [],
      coverageWatermarks: { lines: [], statements: [80, 95] },
      coverageThresholds: {},
      include: ['src/**/*.test.ts'],
    });
    expect(options).toEqual({
      coverageWatermarks: { statements: [80, 95] },
      coverageThresholds: {},
      include: ['src/**/*.test.ts'],
    });
  });

  it("loads the Lynx globals, then the testing library's setup when the project has it, after the app's polyfills", async () => {
    const without = await test();
    expect(
      (await without.context.getTargetOptions(buildTarget))['polyfills'],
    ).toEqual([LYNX_GLOBALS]);

    const { context, raw } = await test({}, { testingLibrary: true });
    raw.getTargetOptions.mockImplementation(async () => ({
      polyfills: '@angular/localize/init',
    }));
    expect((await context.getTargetOptions(buildTarget))['polyfills']).toEqual([
      '@angular/localize/init',
      LYNX_GLOBALS,
      '@blotch/angular-lynx-testing-library/setup',
    ]);
    raw.getTargetOptions.mockImplementation(async () => ({
      polyfills: ['zone.js'],
    }));
    expect((await context.getTargetOptions(buildTarget))['polyfills']).toEqual([
      'zone.js',
      LYNX_GLOBALS,
      '@blotch/angular-lynx-testing-library/setup',
    ]);
  });

  it('hands Angular a Lynx build target as an Angular one, with the options both builders share', async () => {
    const { context, raw } = await test();
    expect(await context.getBuilderNameForTarget(buildTarget)).toBe(
      '@angular/build:application',
    );
    expect(await context.getTargetOptions(buildTarget)).toEqual({
      tsConfig: 'tsconfig.app.json',
      // Imported images, fonts and media load as file URLs, as in the app.
      loader: ASSET_LOADERS,
      polyfills: [LYNX_GLOBALS],
    });
    expect(ASSET_LOADERS).toMatchObject({ '.png': 'file', '.ttf': 'file' });
    // Everything else is the real context's.
    expect(context.workspaceRoot).toBe(root);
    context.reportStatus('testing');
    expect(raw.reportStatus).toHaveBeenCalledWith('testing');
  });

  it('leaves other build targets alone', async () => {
    const { context, raw } = await test();
    raw.getBuilderNameForTarget.mockImplementation(
      async () => '@angular/build:ng-packagr',
    );
    const target = {
      project: 'my-app',
      target: 'lib',
      configuration: 'development',
    };
    expect(await context.getBuilderNameForTarget(target)).toBe(
      '@angular/build:ng-packagr',
    );
    expect(await context.getTargetOptions(target)).toEqual({
      project: 'ng-package.json',
    });
  });

  it('reports a project without @angular/build', async () => {
    const result = await firstOutput(
      runUnitTest({}, fakeContext().context, {
        importAngularBuild: async () => {
          throw new Error('@angular/build is not installed.');
        },
        hasTestingLibrary: () => false,
      }),
    );
    expect(result).toEqual({
      success: false,
      error: '@angular/build is not installed.',
    });
  });

  it('needs a project', async () => {
    expect(
      await firstOutput(runUnitTest({}, fakeContext(null as never).context)),
    ).toEqual({ success: false, error: 'The builder needs a project target.' });
  });

  it("takes the same options as Angular's unit-test builder", () => {
    expect(unitTestSchema.properties).toEqual(
      angularSchema('unit-test').properties,
    );
  });

  it("passes on only options Angular's application builder knows, and classifies every option", () => {
    const angular = angularSchema('application');
    for (const option of ANGULAR_BUILD_OPTIONS) {
      expect(angular.properties).toHaveProperty(option);
    }
    // Every other option of the Lynx builder is Lynx-only. A new one must
    // be added to one list or the other.
    expect(
      Object.keys(applicationSchema.properties).filter(
        (option) => !ANGULAR_BUILD_OPTIONS.includes(option),
      ),
    ).toEqual([
      'platform',
      'config',
      'environment',
      'appName',
      'appId',
      'version',
      'buildNumber',
      'orientation',
      'icon',
      'permissions',
      'deepLinkSchemes',
      'ios',
      'android',
    ]);
  });

  describe('hasTestingLibrary', () => {
    const install = (packageJson: object) => {
      const dir = path.join(
        root,
        'node_modules',
        '@blotch',
        'angular-lynx-testing-library',
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(packageJson),
      );
    };

    it('is false without the package', () => {
      expect(hasTestingLibrary(root)).toBe(false);
    });

    it("is true when it's installed, whether or not its package.json is exported", () => {
      install({ name: '@blotch/angular-lynx-testing-library' });
      expect(hasTestingLibrary(root)).toBe(true);
      install({
        name: '@blotch/angular-lynx-testing-library',
        exports: { '.': './index.js' },
      });
      expect(hasTestingLibrary(root)).toBe(true);
    });
  });
});

describe('extract-i18n builder', () => {
  const test = async (
    options: Record<string, unknown> = {},
    deps: Partial<ExtractI18nBuilderDeps> = {},
  ) => {
    const calls: {
      options: Record<string, unknown>;
      context: BuilderContext;
    }[] = [];
    const ctx = fakeContext('my-app', {
      'my-app:build': {
        browser: 'src/main.ts',
        polyfills: '@angular/localize/init',
        appId: 'com.example.app',
        platform: 'ios',
      },
    });
    const result = await runExtractI18n(options as never, ctx.context, {
      // @angular/build's extract-i18n builder, recording what it was handed.
      importAngularBuild: async () => ({
        executeExtractI18nBuilder: async (options, context) => {
          calls.push({ options: options as never, context });
          return { success: true };
        },
      }),
      hasLocalize: () => true,
      ...deps,
    });
    return { ...ctx, result, ...calls[0] };
  };

  it("runs Angular's extract-i18n builder with the options it was given", async () => {
    const { result, options } = await test({
      format: 'json',
      outputPath: 'src/locale',
    });
    expect(result).toEqual({ success: true });
    expect(options).toEqual({ format: 'json', outputPath: 'src/locale' });
  });

  it('hands Angular the Lynx build target as an Angular one, without the Lynx polyfills', async () => {
    const { context } = await test();
    const buildTarget = { project: 'my-app', target: 'build' };
    expect(await context!.getBuilderNameForTarget(buildTarget)).toBe(
      '@angular/build:application',
    );
    expect(await context!.getTargetOptions(buildTarget)).toEqual({
      browser: 'src/main.ts',
      // Angular's build fails on an imported image without a loader.
      loader: ASSET_LOADERS,
      // Nothing runs the extracted code, so the Lynx globals aren't needed.
      polyfills: ['@angular/localize/init'],
    });
  });

  it('says how to set up i18n in a project without @angular/localize', async () => {
    const { result, options } = await test({}, { hasLocalize: () => false });
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining(
        '`ng generate @blotch/angular-lynx:add-i18n`',
      ),
    });
    expect(options).toBeUndefined();
  });

  it('reports a project without @angular/build', async () => {
    const { result } = await test(
      {},
      {
        importAngularBuild: async () => {
          throw new Error('@angular/build is not installed.');
        },
      },
    );
    expect(result).toEqual({
      success: false,
      error: '@angular/build is not installed.',
    });
  });

  it('needs a project', async () => {
    expect(
      await runExtractI18n({}, fakeContext(null as never).context),
    ).toEqual({ success: false, error: 'The builder needs a project target.' });
  });

  it("takes the same options as Angular's extract-i18n builder", () => {
    expect(extractI18nSchema.properties).toEqual(
      angularSchema('extract-i18n').properties,
    );
  });

  describe('hasLocalize', () => {
    it('is false without the package', () => {
      expect(hasLocalize(root)).toBe(false);
    });

    it("is true when it's installed", () => {
      const dir = path.join(root, 'node_modules/@angular/localize');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: '@angular/localize',
          exports: { './package.json': './package.json' },
        }),
      );
      expect(hasLocalize(root)).toBe(true);
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

describe('nativeCacheDir', () => {
  const cacheDir = (metadata: Record<string, unknown> = {}) =>
    nativeCacheDir({
      metadata,
      workspaceRoot: root,
      projectRoot: path.join(root, 'projects/app'),
      projectName: 'app',
    });

  beforeEach(() => installAngularBuild('22.2.2'));

  it("is the project's folder in Angular's versioned cache", () => {
    expect(cacheDir()).toBe(
      path.join(root, '.angular/cache/22.2.2/app/lynx-native'),
    );
  });

  it('follows cli.cache.path, relative to the workspace or absolute', () => {
    expect(cacheDir({ cli: { cache: { path: 'tmp/ng' } } })).toBe(
      path.join(root, 'tmp/ng/22.2.2/app/lynx-native'),
    );
    const absolute = path.join(os.tmpdir(), 'ng-cache');
    expect(cacheDir({ cli: { cache: { path: absolute } } })).toBe(
      path.join(absolute, '22.2.2/app/lynx-native'),
    );
  });

  it('ignores a cache setting without a path', () => {
    expect(cacheDir({ cli: { cache: { enabled: false } } })).toBe(
      path.join(root, '.angular/cache/22.2.2/app/lynx-native'),
    );
  });
});

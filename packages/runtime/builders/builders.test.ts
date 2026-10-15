import type { BuilderContext } from '@angular-devkit/architect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runApplication } from './application/index';
import { runDevServer } from './dev-server/index';
import { importFromProject } from './project-import';
import type { RspeedyModule } from './rspeedy';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-builders-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'my-app', version: '2.0.0' }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const fakeContext = (project: string | undefined = 'my-app') => {
  const teardowns: (() => unknown)[] = [];
  const context = {
    target: project ? { project, target: 'build' } : undefined,
    workspaceRoot: root,
    getProjectMetadata: vi.fn(async () => ({ root: '' })),
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
  return { rspeedy, instance, close, serverClose };
};

describe('application builder', () => {
  it('builds the bundle like `rspeedy build` without --platform', async () => {
    const { rspeedy, close } = fakeRspeedy();
    const importNative = vi.fn();
    const { context } = fakeContext();
    const result = await runApplication({ mode: 'development' }, context, {
      importRspeedy: async () => rspeedy,
      importNative,
    });
    expect(result).toEqual({ success: true });
    expect(rspeedy.loadConfig).toHaveBeenCalledWith({
      cwd: root,
      configPath: undefined,
    });
    expect(rspeedy.createRspeedy).toHaveBeenCalledWith({
      cwd: root,
      rspeedyConfig: { mode: 'development' },
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
      importNative: vi.fn(),
    });
    expect(result).toEqual({ success: false, error: 'Rspack build failed.' });
  });

  it('fails before bundling when the native package is missing', async () => {
    const { rspeedy } = fakeRspeedy();
    const result = await runApplication(
      { platform: 'ios' },
      fakeContext().context,
      {
        importRspeedy: async () => rspeedy,
        importNative: async () => {
          throw new Error('@blotch/angular-lynx-native is not installed.');
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
      const { rspeedy } = fakeRspeedy({ performance: { buildCache } });
      await runApplication({}, fakeContext().context, {
        importRspeedy: async () => rspeedy,
        importNative: vi.fn(),
      });
      expect(rspeedy.createRspeedy).toHaveBeenCalledWith(
        expect.objectContaining({
          rspeedyConfig: { performance: { buildCache: expected } },
        }),
      );
    }
  });
});

describe('dev-server builder', () => {
  it('starts the dev server, reports its URL and closes it on teardown', async () => {
    const { rspeedy, serverClose } = fakeRspeedy();
    const { context, teardowns } = fakeContext();
    const outputs = runDevServer({ config: 'lynx.dev.ts' }, context, {
      importRspeedy: async () => rspeedy,
    })[Symbol.asyncIterator]();
    expect((await outputs.next()).value).toEqual({
      success: true,
      baseUrl: 'http://localhost:3000',
    });
    expect(rspeedy.loadConfig).toHaveBeenCalledWith({
      cwd: root,
      configPath: 'lynx.dev.ts',
    });
    await Promise.all(teardowns.map((teardown) => teardown()));
    expect(serverClose).toHaveBeenCalled();
  });

  it('reports a dev server that fails to start', async () => {
    const { rspeedy, instance } = fakeRspeedy();
    instance.startDevServer.mockRejectedValueOnce(new Error('port in use'));
    const outputs = runDevServer({}, fakeContext().context, {
      importRspeedy: async () => rspeedy,
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

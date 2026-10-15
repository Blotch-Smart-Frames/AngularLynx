import { LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin';
import { describe, expect, it, vi } from 'vitest';
import {
  AngularBudgetsPlugin,
  applyBudgets,
  bundleEntryName,
  collectBudgetAssets,
  toBudgetError,
} from './budgets-plugin';
import type { ComponentStyleSize } from './utils/angular/budgets';
import type { Budget } from './utils/angular/options';

const PROCESS_ASSETS_STAGE_REPORT = 5000;

const asset = (
  name: string,
  size: number,
  info: { hotModuleReplacement?: boolean } = {},
) => ({ name, source: { size: () => size }, info });

describe('toBudgetError', () => {
  it('makes an error rspack fails the build on', () => {
    const error = toBudgetError({
      severity: 'error',
      label: 'total',
      message: 'total exceeded maximum budget.',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AngularBudgetError');
    expect(error.message).toBe('total exceeded maximum budget.');
    expect(error.hideStack).toBe(true);
  });

  it('makes a warning rspack prints', () => {
    expect(
      toBudgetError({ severity: 'warning', label: 'total', message: 'm' }).name,
    ).toBe('AngularBudgetWarning');
  });
});

describe('bundleEntryName', () => {
  const entrypoints = new Set(['main', 'main__main-thread']);

  it('names the entry a template was built from, not its main-thread twin', () => {
    expect(
      bundleEntryName(
        [{ name: 'main__main-thread' }, { name: 'main' }],
        entrypoints,
      ),
    ).toBe('main');
  });

  it('is undefined for a lazy bundle, built from async chunk groups', () => {
    expect(
      bundleEntryName([{ name: null }, { name: 'route' }, {}], entrypoints),
    ).toBeUndefined();
  });
});

describe('collectBudgetAssets', () => {
  it('counts the bundles and scripts that ship, and which entry each bundle is', () => {
    expect(
      collectBudgetAssets(
        [
          asset('main.lynx.bundle', 3000),
          asset('lazy-bundle/route.bundle', 400),
          asset('async/chunk.js', 200),
          asset('async/chunk.js.map', 900),
          asset('static/image/logo.png', 5000),
          asset('static/font/a.ttf', 5000),
          asset('main.hot-update.js', 50, { hotModuleReplacement: true }),
          asset('.rspeedy/main/main-thread.js', 700),
          asset('.rspeedy/main/debug-info.json', 700),
        ],
        new Map([['main.lynx.bundle', 'main']]),
        '.rspeedy',
      ),
    ).toEqual([
      { name: 'main.lynx.bundle', size: 3000, entryName: 'main' },
      { name: 'lazy-bundle/route.bundle', size: 400 },
      { name: 'async/chunk.js', size: 200 },
    ]);
  });

  it('keeps every script when the intermediate directory is unknown', () => {
    expect(
      collectBudgetAssets(
        [asset('.rspeedy/main/main-thread.js', 700)],
        new Map(),
        undefined,
      ),
    ).toEqual([{ name: '.rspeedy/main/main-thread.js', size: 700 }]);
  });
});

/**
 * A stand-in for the rspack compiler and one compilation, recording the taps
 * the plugin makes so a test can run them in the order rspack would.
 */
const createCompiler = (assets: ReturnType<typeof asset>[]) => {
  const compilation = {
    entrypoints: new Map([
      ['main', {}],
      ['main__main-thread', {}],
    ]),
    errors: [] as Error[],
    warnings: [] as Error[],
    getAssets: () => assets,
    hooks: {
      processAssets: {
        tap: vi.fn<(options: { stage: number }, fn: () => void) => void>(),
      },
    },
  };
  const compiler = {
    webpack: { Compilation: { PROCESS_ASSETS_STAGE_REPORT } },
    hooks: {
      thisCompilation: {
        tap: vi.fn((_name: string, fn: (c: typeof compilation) => void) =>
          fn(compilation),
        ),
      },
    },
  };
  return {
    compiler,
    compilation,
    templateHooks: () =>
      LynxTemplatePlugin.getLynxTemplatePluginHooks(compilation as never),
    processAssets: () => {
      const [options, fn] = compilation.hooks.processAssets.tap.mock.calls[0]!;
      return { stage: options.stage, run: fn };
    },
  };
};

describe('AngularBudgetsPlugin', () => {
  const budgets: Budget[] = [
    { type: 'initial', maximumWarning: '1kb', maximumError: '2kb' },
    { type: 'anyComponentStyle', maximumWarning: '100b' },
  ];

  it("reports each entry's bundle and each component stylesheet against the budgets", async () => {
    const componentStyleSizes = new Map<string, ComponentStyleSize>([
      ['src/app/app.ts#0', { label: 'src/app/app.css', size: 150 }],
    ]);
    const { compiler, compilation, templateHooks, processAssets } =
      createCompiler([
        asset('main.lynx.bundle', 1500),
        asset('.rspeedy/main/main-thread.js', 9000),
      ]);
    new AngularBudgetsPlugin({
      budgets,
      componentStyleSizes,
      intermediateDir: '.rspeedy',
    }).apply(compiler as never);

    // The template plugin emits the entry's bundle, then the assets are final.
    const args = {
      outputName: 'main.lynx.bundle',
      chunkGroups: [{ name: 'main__main-thread' }, { name: 'main' }],
    };
    await expect(
      templateHooks().beforeEmit.promise(args as never),
    ).resolves.toBe(args);
    const { stage, run } = processAssets();
    expect(stage).toBe(PROCESS_ASSETS_STAGE_REPORT + 2);
    run();

    expect(compilation.errors).toEqual([]);
    expect(compilation.warnings.map((warning) => warning.message)).toEqual([
      'bundle initial exceeded maximum budget. Budget 1.00 kB was not met by 500 bytes with a total of 1.50 kB.',
      'src/app/app.css exceeded maximum budget. Budget 100 bytes was not met by 50 bytes with a total of 150 bytes.',
    ]);
  });

  it('fails the compilation on an error threshold, and ignores lazy bundles for `initial`', async () => {
    const { compiler, compilation, templateHooks, processAssets } =
      createCompiler([
        asset('main.lynx.bundle', 2500),
        asset('lazy-bundle/route.bundle', 9000),
      ]);
    new AngularBudgetsPlugin({
      budgets,
      componentStyleSizes: new Map(),
      intermediateDir: undefined,
    }).apply(compiler as never);

    await templateHooks().beforeEmit.promise({
      outputName: 'lazy-bundle/route.bundle',
      chunkGroups: [{ name: 'route' }],
    } as never);
    await templateHooks().beforeEmit.promise({
      outputName: 'main.lynx.bundle',
      chunkGroups: [{ name: 'main' }],
    } as never);
    processAssets().run();

    expect(compilation.errors.map((error) => error.message)).toEqual([
      'bundle initial exceeded maximum budget. Budget 2.00 kB was not met by 500 bytes with a total of 2.50 kB.',
    ]);
    expect(compilation.warnings.map((warning) => warning.message)).toEqual([
      'bundle initial exceeded maximum budget. Budget 1.00 kB was not met by 1.50 kB with a total of 2.50 kB.',
    ]);
  });
});

/**
 * A stand-in for the Rsbuild plugin API, recording `modifyBundlerChain`. Pass
 * `null` for a build without `pluginLynx`, which exposes no Lynx config.
 */
const createApi = (
  action: 'build' | 'dev',
  lynxConfig: { resolveIntermediateDir: () => string } | null = {
    resolveIntermediateDir: () => '.rspeedy',
  },
) => {
  const api = {
    context: { action },
    modifyBundlerChain: vi.fn(),
    useExposed: vi.fn(() => lynxConfig ?? undefined),
  };
  const runChain = (environmentName: string) => {
    const use = vi.fn();
    const chain = { plugin: vi.fn(() => ({ use })) };
    const [fn] = api.modifyBundlerChain.mock.calls[0]!;
    fn(chain, { environment: { name: environmentName } });
    return { chain, use };
  };
  return { api, runChain };
};

describe('applyBudgets', () => {
  const budgets: Budget[] = [{ type: 'initial', maximumError: '1mb' }];
  const componentStyleSizes = new Map<string, ComponentStyleSize>();

  it('adds the budget check to the lynx environment only', () => {
    const { api, runChain } = createApi('build');
    applyBudgets(api as never, {
      budgets,
      componentStyleSizes,
      underAngularCli: false,
    });

    const lynx = runChain('lynx');
    expect(lynx.chain.plugin).toHaveBeenCalledWith('lynx:angular:budgets');
    expect(lynx.use).toHaveBeenCalledWith(AngularBudgetsPlugin, [
      { budgets, componentStyleSizes, intermediateDir: '.rspeedy' },
    ]);

    const web = runChain('web');
    expect(web.chain.plugin).not.toHaveBeenCalled();
  });

  it('checks without an intermediate directory when the Lynx config is not exposed', () => {
    const { api, runChain } = createApi('build', null);
    applyBudgets(api as never, {
      budgets,
      componentStyleSizes,
      underAngularCli: true,
    });
    expect(runChain('lynx').use).toHaveBeenCalledWith(AngularBudgetsPlugin, [
      { budgets, componentStyleSizes, intermediateDir: undefined },
    ]);
  });

  it('does nothing without budgets', () => {
    const { api } = createApi('build');
    applyBudgets(api as never, {
      budgets: [],
      componentStyleSizes,
      underAngularCli: true,
    });
    expect(api.modifyBundlerChain).not.toHaveBeenCalled();
  });

  it("skips plain `rspeedy dev`, which reads the production configuration's budgets", () => {
    const { api } = createApi('dev');
    applyBudgets(api as never, {
      budgets,
      componentStyleSizes,
      underAngularCli: false,
    });
    expect(api.modifyBundlerChain).not.toHaveBeenCalled();
  });

  it('checks under `ng serve`, which passes the configuration it serves', () => {
    const { api } = createApi('dev');
    applyBudgets(api as never, {
      budgets,
      componentStyleSizes,
      underAngularCli: true,
    });
    expect(api.modifyBundlerChain).toHaveBeenCalledOnce();
  });
});

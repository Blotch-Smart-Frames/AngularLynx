import { beforeEach, describe, expect, it, vi } from 'vitest';

// The CSS-extract plugins are dynamically imported inside applyCSS; provide
// constructable stand-ins with a static `loader` so the loader-wiring runs.
vi.mock('@lynx-js/css-extract-webpack-plugin', () => {
  class CssExtractRspackPlugin {
    static loader = 'rspack-css-extract-loader';
    args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
    }
  }
  class CssExtractWebpackPlugin {
    static loader = 'webpack-css-extract-loader';
    args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
    }
  }
  return { CssExtractRspackPlugin, CssExtractWebpackPlugin };
});

vi.mock('@lynx-js/template-webpack-plugin', () => ({
  CSSPlugins: {
    parserPlugins: { removeFunctionWhiteSpace: () => ({ name: 'stub' }) },
  },
}));

import { applyCSS, normalizeCssLoaderOptions } from './css';

const CHAIN_ID = {
  RULE: {
    CSS: 'css',
    SASS: 'sass',
    LESS: 'less',
    STYLUS: 'stylus',
    CSS_INLINE: 'css-inline',
    SASS_INLINE: 'sass-inline',
    LESS_INLINE: 'less-inline',
    // Deliberately undefined to exercise the `rule && ...` guard in the
    // inline-rules filter (mirrors bundlers that don't define every variant).
    STYLUS_INLINE: undefined as unknown as string,
    FONT: 'font',
  },
  USE: {
    LIGHTNINGCSS: 'lightningcss',
    MINI_CSS_EXTRACT: 'mini-css-extract',
    CSS: 'css',
    IGNORE_CSS: 'ignore-css',
  },
  PLUGIN: { MINI_CSS_EXTRACT: 'mini-css-extract' },
};

/**
 * A fluent rule builder recording the calls applyCSS makes on it. 
 */
const createRule = (hasLightning: boolean) => {
  const rule: any = {};
  const useBuilder: any = {
    loader: vi.fn(() => useBuilder),
    after: vi.fn(() => useBuilder),
    merge: vi.fn(() => useBuilder),
    options: vi.fn(() => useBuilder),
    end: vi.fn(() => rule),
  };
  const cssUse = { entries: vi.fn(() => ({ options: { modules: true } })) };
  const usesEntries: Record<string, unknown> = { css: cssUse };
  const usesMap: any = {
    has: vi.fn((k: string) =>
      k === 'lightningcss' ? hasLightning : k in usesEntries,
    ),
    delete: vi.fn(() => usesMap),
    merge: vi.fn(() => usesMap),
    entries: vi.fn(() => usesEntries),
    end: vi.fn(() => rule),
  };
  rule.uses = usesMap;
  rule.oneOfs = { clear: vi.fn() };
  rule.entries = vi.fn(() => ({ test: /\.css$/ }));
  rule.type = vi.fn(() => rule);
  rule.merge = vi.fn(() => rule);
  rule.issuerLayer = vi.fn(() => rule);
  rule.use = vi.fn(() => useBuilder);
  return rule;
};

const createMockChain = (config: {
  presentRules?: string[];
  lightningRules?: string[];
}) => {
  const present = new Set(config.presentRules ?? []);
  const lightning = new Set(config.lightningRules ?? []);
  const rulesByName = new Map<string, ReturnType<typeof createRule>>();

  const scopedRuleBuilder: any = {
    test: vi.fn(() => scopedRuleBuilder),
    resourceQuery: vi.fn(() => scopedRuleBuilder),
    sideEffects: vi.fn(() => scopedRuleBuilder),
  };

  const pluginBuilder: any = {
    tap: vi.fn((fn: (args: unknown[]) => unknown[]) => {
      pluginBuilder._tappedArgs = fn([{ base: true }]);
      return pluginBuilder;
    }),
    init: vi.fn((fn: (a: unknown, args: unknown[]) => unknown) => {
      pluginBuilder._instance = fn(undefined, pluginBuilder._tappedArgs);
      return pluginBuilder;
    }),
    end: vi.fn(() => pluginBuilder),
  };

  const moduleObj: any = {
    rules: { has: vi.fn((n: string) => present.has(n)) },
    rule: vi.fn((n: string) => {
      let r = rulesByName.get(n);
      if (!r) {
        // Lightning presence is keyed on the base rule name (e.g. "css").
        r = createRule(lightning.has(n));
        rulesByName.set(n, r);
      }
      return r;
    }),
    when: vi.fn((cond: boolean, cb: (m: unknown) => void) => {
      if (cond) cb({ rule: () => scopedRuleBuilder });
    }),
  };

  const chain: any = {
    module: moduleObj,
    plugin: vi.fn(() => pluginBuilder),
  };

  return { chain, rulesByName, scopedRuleBuilder, pluginBuilder };
};

const createMockApi = (bundlerType: 'rspack' | 'webpack') => {
  let bundlerChainHandler:
    | ((chain: unknown, utils: { CHAIN_ID: unknown; environment: unknown }) => unknown)
    | undefined;
  let rsbuildConfigHandler:
    | ((config: unknown, utils: { mergeRsbuildConfig: unknown }) => unknown)
    | undefined;

  const api = {
    context: { bundlerType },
    modifyRsbuildConfig: vi.fn((handler: any) => {
      rsbuildConfigHandler = handler;
    }),
    modifyBundlerChain: vi.fn((handler: any) => {
      bundlerChainHandler = handler;
    }),
  };

  return {
    api,
    triggerRsbuildConfig: (config: unknown, mergeRsbuildConfig: unknown) =>
      rsbuildConfigHandler!(config, { mergeRsbuildConfig }),
    triggerBundlerChain: async (chain: unknown, environmentName: string) =>
      await bundlerChainHandler!(chain, {
        CHAIN_ID,
        environment: { name: environmentName },
      }),
  };
};

const defaultOptions = {
  enableRemoveCSSScope: undefined,
  enableCSSSelector: true,
  enableCSSInvalidation: true,
  targetSdkVersion: '3.0',
} as any;

describe('applyCSS', () => {
  it('disables injectStyles via modifyRsbuildConfig', () => {
    const { api, triggerRsbuildConfig } = createMockApi('rspack');
    applyCSS(api as never, defaultOptions);

    const mergeRsbuildConfig = vi.fn((_c, override) => override);
    triggerRsbuildConfig({}, mergeRsbuildConfig);

    expect(mergeRsbuildConfig).toHaveBeenCalledWith(
      {},
      { output: { injectStyles: false } },
    );
  });

  it('wires CSS loaders, inlines fonts, and scopes CSS modules on lynx (rspack)', async () => {
    const { api, triggerBundlerChain } = createMockApi('rspack');
    const { chain, rulesByName, scopedRuleBuilder, pluginBuilder } =
      createMockChain({
        presentRules: ['css', 'css-inline', 'font'],
        lightningRules: ['css'],
      });

    applyCSS(api as never, defaultOptions);
    await triggerBundlerChain(chain, 'lynx');

    // LightningCSS removed from the css rule on lynx.
    expect(rulesByName.get('css')!.uses.delete).toHaveBeenCalledWith(
      'lightningcss',
    );
    // Fonts inlined as data URIs.
    const fontRule = rulesByName.get('font')!;
    expect(fontRule.oneOfs.clear).toHaveBeenCalled();
    expect(fontRule.type).toHaveBeenCalledWith('asset/inline');
    // Scoped CSS module rule marked side-effect free (enableRemoveCSSScope undefined).
    expect(scopedRuleBuilder.sideEffects).toHaveBeenCalledWith(false);
    // The extract plugin was constructed via .init() with an rspack instance.
    expect(pluginBuilder._instance).toBeDefined();
  });

  it('keeps LightningCSS and skips font inlining on web (non-rspack)', async () => {
    const { api, triggerBundlerChain } = createMockApi('webpack');
    const { chain, rulesByName } = createMockChain({
      presentRules: ['css', 'css-inline', 'font'],
      lightningRules: ['css'],
    });

    applyCSS(
      api as never,
      { ...defaultOptions, enableRemoveCSSScope: false } as any,
    );
    await triggerBundlerChain(chain, 'web');

    // Not lynx → LightningCSS is left in place even though the rule has it.
    expect(rulesByName.get('css')!.uses.delete).not.toHaveBeenCalledWith(
      'lightningcss',
    );
    // Environment is web → the font branch short-circuits before the rule is
    // ever requested from the chain, so no font rule is created.
    expect(rulesByName.has('font')).toBe(false);
  });

  it('handles lynx with no font rule present', async () => {
    const { api, triggerBundlerChain } = createMockApi('rspack');
    const { chain, rulesByName } = createMockChain({
      presentRules: ['css'],
      lightningRules: [],
    });

    applyCSS(api as never, defaultOptions);
    await triggerBundlerChain(chain, 'lynx');

    // FONT rule absent → never requested from the chain.
    expect(rulesByName.has('font')).toBe(false);
  });
});

describe('normalizeCssLoaderOptions', () => {
  it('modules true + exportOnlyLocals true returns { exportOnlyLocals: true }', () => {
    const options = { modules: true } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result.modules).toEqual({ exportOnlyLocals: true });
  });

  it('modules string + exportOnlyLocals true returns { mode, exportOnlyLocals }', () => {
    const options = { modules: 'local' } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result.modules).toEqual({ mode: 'local', exportOnlyLocals: true });
  });

  it('modules object + exportOnlyLocals true merges exportOnlyLocals', () => {
    const options = { modules: { namedExport: true } } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result.modules).toEqual({
      namedExport: true,
      exportOnlyLocals: true,
    });
  });

  it('modules false + exportOnlyLocals true returns options unchanged', () => {
    const options = { modules: false } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result).toBe(options);
  });

  it('modules true + exportOnlyLocals false returns options unchanged', () => {
    const options = { modules: true } as any;

    const result = normalizeCssLoaderOptions(options, false);

    expect(result).toBe(options);
  });

  it('does not mutate the original options object', () => {
    const originalModules = { namedExport: true };
    const options = { modules: originalModules } as any;

    const result = normalizeCssLoaderOptions(options, true);

    expect(result).not.toBe(options);
    expect(originalModules).toEqual({ namedExport: true });
    expect(result.modules).not.toBe(originalModules);
  });
});

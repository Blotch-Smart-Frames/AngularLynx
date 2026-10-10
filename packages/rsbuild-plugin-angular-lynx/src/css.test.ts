import { describe, expect, it, vi } from 'vitest';

// The CSS-extract plugin is dynamically imported inside applyCSS; provide a
// constructable stand-in with a static `loader` so the loader-wiring runs.
// Only the Rspack plugin exists since css-extract-webpack-plugin 0.8.
vi.mock('@lynx-js/css-extract-webpack-plugin', () => {
  class CssExtractRspackPlugin {
    static loader = 'rspack-css-extract-loader';
    args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
    }
  }
  return { CssExtractRspackPlugin };
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
    FONT: 'font',
  },
  // Rsbuild 2 splits each CSS rule into `oneOf` branches. Plain CSS uses these
  // dedicated IDs; Sass/Less/Stylus use `<rule>` and `<rule>-inline`.
  ONE_OF: {
    CSS_MAIN: 'css-main',
    CSS_INLINE: 'css-inline',
  },
  USE: {
    LIGHTNINGCSS: 'lightningcss',
    MINI_CSS_EXTRACT: 'mini-css-extract',
    CSS: 'css',
    IGNORE_CSS: 'ignore-css',
  },
  PLUGIN: { MINI_CSS_EXTRACT: 'mini-css-extract' },
};

type MockChainConfig = {
  /** Top-level rules `chain.module.rules.has()` reports as present. */
  presentRules?: string[];
  /** Branch keys (`<rule>/<oneOf>`) whose uses contain lightningcss. */
  lightningBranches?: string[];
  /** Branch keys whose uses have no css-loader (e.g. a stripped-down rule). */
  noCssLoaderBranches?: string[];
  /** Branch keys whose `uses.entries()` returns undefined (no uses at all). */
  emptyUsesBranches?: string[];
  /** Parent rule entries (`test`/`dependency`) keyed by rule name. */
  parentEntries?: Record<string, Record<string, unknown>>;
};

/**
 * A fluent rule builder recording the calls applyCSS makes on it. The same
 * shape serves parent rules, `oneOf` branches and the main-thread copy rules.
 */
const createRule = (
  key: string,
  config: MockChainConfig,
  entries: Record<string, unknown>,
) => {
  const rule: any = {};
  const useBuilder: any = {
    loader: vi.fn(() => useBuilder),
    after: vi.fn(() => useBuilder),
    merge: vi.fn(() => useBuilder),
    options: vi.fn(() => useBuilder),
    end: vi.fn(() => rule),
  };
  const hasLightning = (config.lightningBranches ?? []).includes(key);
  const cssUse = { entries: vi.fn(() => ({ options: { modules: true } })) };
  const usesEntries: Record<string, unknown> | undefined = (
    config.emptyUsesBranches ?? []
  ).includes(key)
    ? undefined
    : (config.noCssLoaderBranches ?? []).includes(key)
      ? {}
      : { css: cssUse };
  const usesMap: any = {
    has: vi.fn((k: string) =>
      k === 'lightningcss'
        ? hasLightning
        : usesEntries !== undefined && k in usesEntries,
    ),
    delete: vi.fn(() => usesMap),
    merge: vi.fn(() => usesMap),
    entries: vi.fn(() => usesEntries),
    end: vi.fn(() => rule),
  };
  const oneOfs = new Map<string, any>();
  rule.uses = usesMap;
  rule.oneOfs = { clear: vi.fn() };
  rule.oneOf = vi.fn((name: string) => {
    let branch = oneOfs.get(name);
    if (!branch) {
      branch = createRule(`${key}/${name}`, config, {});
      oneOfs.set(name, branch);
    }
    return branch;
  });
  rule.getOneOf = (name: string) => oneOfs.get(name);
  rule.entries = vi.fn(() => entries);
  rule.type = vi.fn(() => rule);
  rule.test = vi.fn(() => rule);
  rule.merge = vi.fn(() => rule);
  rule.issuerLayer = vi.fn(() => rule);
  rule.use = vi.fn(() => useBuilder);
  rule._useBuilder = useBuilder;
  return rule;
};

const createMockChain = (config: MockChainConfig) => {
  const present = new Set(config.presentRules ?? []);
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
        r = createRule(n, config, config.parentEntries?.[n] ?? {});
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

const createMockApi = () => {
  let bundlerChainHandler:
    | ((
        chain: unknown,
        utils: { CHAIN_ID: unknown; environment: unknown },
      ) => unknown)
    | undefined;
  let rsbuildConfigHandler:
    | ((config: unknown, utils: { mergeRsbuildConfig: unknown }) => unknown)
    | undefined;

  const api = {
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
    const { api, triggerRsbuildConfig } = createMockApi();
    applyCSS(api as never, defaultOptions);

    const mergeRsbuildConfig = vi.fn((_c, override) => override);
    triggerRsbuildConfig({}, mergeRsbuildConfig);

    expect(mergeRsbuildConfig).toHaveBeenCalledWith(
      {},
      { output: { injectStyles: false } },
    );
  });

  it('wires CSS loaders on the css-main branch, inlines fonts, and scopes CSS modules on lynx', async () => {
    const { api, triggerBundlerChain } = createMockApi();
    const { chain, rulesByName, scopedRuleBuilder, pluginBuilder } =
      createMockChain({
        presentRules: ['css', 'font'],
        lightningBranches: ['css/css-main', 'css/css-inline'],
        parentEntries: { css: { test: /\.css$/ } },
      });

    applyCSS(api as never, defaultOptions);
    await triggerBundlerChain(chain, 'lynx');

    const cssRule = rulesByName.get('css')!;
    const mainBranch = cssRule.getOneOf('css-main');
    const inlineBranch = cssRule.getOneOf('css-inline');
    // Loaders live on the oneOf branches now, so LightningCSS is removed from
    // both the main and the `?inline` branch — never from the parent rule.
    expect(mainBranch.uses.delete).toHaveBeenCalledWith('lightningcss');
    expect(inlineBranch.uses.delete).toHaveBeenCalledWith('lightningcss');
    expect(cssRule.uses.delete).not.toHaveBeenCalled();
    // Background extraction is wired onto the main branch with the Rspack loader.
    expect(mainBranch.issuerLayer).toHaveBeenCalledWith('background');
    expect(mainBranch._useBuilder.loader).toHaveBeenCalledWith(
      'rspack-css-extract-loader',
    );

    // The main-thread copy takes `test` from the parent rule (the branch has
    // none) and no `dependency` merge happens when the parent has none.
    const mainThreadRule = rulesByName.get('css:main')!;
    expect(mainThreadRule.test).toHaveBeenCalledWith(/\.css$/);
    expect(mainThreadRule.issuerLayer).toHaveBeenCalledWith('main');
    expect(mainThreadRule.merge).not.toHaveBeenCalledWith(
      expect.objectContaining({ dependency: expect.anything() }),
    );
    // css-loader is re-added with exportOnlyLocals forced on.
    expect(mainThreadRule._useBuilder.options).toHaveBeenCalledWith({
      modules: { exportOnlyLocals: true },
    });

    // Fonts inlined as data URIs.
    const fontRule = rulesByName.get('font')!;
    expect(fontRule.oneOfs.clear).toHaveBeenCalled();
    expect(fontRule.type).toHaveBeenCalledWith('asset/inline');
    // Scoped CSS module rule marked side-effect free (enableRemoveCSSScope undefined).
    expect(scopedRuleBuilder.sideEffects).toHaveBeenCalledWith(false);
    // The extract plugin was constructed via .init() with the Rspack plugin
    // and the Lynx-specific options merged over the defaults.
    expect(pluginBuilder._instance.constructor.name).toBe(
      'CssExtractRspackPlugin',
    );
    expect(pluginBuilder._instance.args[0]).toMatchObject({
      base: true,
      enableCSSSelector: true,
      targetSdkVersion: '3.0',
    });
  });

  it('uses `<rule>` / `<rule>-inline` branches for sass and copies the parent dependency', async () => {
    const { api, triggerBundlerChain } = createMockApi();
    const dependency = { not: 'url' };
    const { chain, rulesByName } = createMockChain({
      presentRules: ['sass'],
      lightningBranches: ['sass/sass', 'sass/sass-inline'],
      parentEntries: { sass: { test: /\.s[ac]ss$/, dependency } },
    });

    applyCSS(api as never, defaultOptions);
    await triggerBundlerChain(chain, 'lynx');

    const sassRule = rulesByName.get('sass')!;
    expect(sassRule.oneOf).toHaveBeenCalledWith('sass');
    expect(sassRule.oneOf).toHaveBeenCalledWith('sass-inline');
    expect(sassRule.getOneOf('sass').uses.delete).toHaveBeenCalledWith(
      'lightningcss',
    );
    expect(sassRule.getOneOf('sass-inline').uses.delete).toHaveBeenCalledWith(
      'lightningcss',
    );

    // Without the parent's `dependency` (e.g. Rsbuild's `{ not: 'url' }`) the
    // main-thread copy would also match `url` dependencies the parent excludes.
    const mainThreadRule = rulesByName.get('sass:main')!;
    expect(mainThreadRule.test).toHaveBeenCalledWith(/\.s[ac]ss$/);
    expect(mainThreadRule.merge).toHaveBeenCalledWith({ dependency });
  });

  it('skips the main-thread copy when the branch has no css-loader', async () => {
    const { api, triggerBundlerChain } = createMockApi();
    const { chain, rulesByName } = createMockChain({
      presentRules: ['css', 'less'],
      noCssLoaderBranches: ['css/css-main'],
      // `uses.entries()` may return undefined for a branch with no uses at all;
      // the `?? {}` fallback must still reach the missing-css-loader skip.
      emptyUsesBranches: ['less/less'],
    });

    applyCSS(api as never, defaultOptions);
    await triggerBundlerChain(chain, 'lynx');

    // Extraction is still wired on the background layer...
    expect(
      rulesByName.get('css')!.getOneOf('css-main').issuerLayer,
    ).toHaveBeenCalledWith('background');
    // ...but there is nothing to rebuild for the main thread, so no copy rule.
    expect(rulesByName.has('css:main')).toBe(false);
    expect(rulesByName.has('less:main')).toBe(false);
    // The inline branches are still processed afterwards.
    expect(rulesByName.get('less')!.oneOf).toHaveBeenCalledWith('less-inline');
  });

  it('keeps LightningCSS and skips font inlining on web', async () => {
    const { api, triggerBundlerChain } = createMockApi();
    const { chain, rulesByName } = createMockChain({
      presentRules: ['css', 'font'],
      lightningBranches: ['css/css-main', 'css/css-inline'],
    });

    applyCSS(
      api as never,
      { ...defaultOptions, enableRemoveCSSScope: false } as any,
    );
    await triggerBundlerChain(chain, 'web');

    // Not lynx → LightningCSS is left in place even though the branches have it.
    const cssRule = rulesByName.get('css')!;
    expect(cssRule.getOneOf('css-main').uses.delete).not.toHaveBeenCalledWith(
      'lightningcss',
    );
    expect(cssRule.getOneOf('css-inline').uses.delete).not.toHaveBeenCalled();
    // Environment is web → the font branch short-circuits before the rule is
    // ever requested from the chain, so no font rule is created.
    expect(rulesByName.has('font')).toBe(false);
  });

  it('handles lynx with no font rule present', async () => {
    const { api, triggerBundlerChain } = createMockApi();
    const { chain, rulesByName } = createMockChain({
      presentRules: ['css'],
    });

    applyCSS(api as never, defaultOptions);
    await triggerBundlerChain(chain, 'lynx');

    // FONT rule absent → never requested from the chain.
    expect(rulesByName.has('font')).toBe(false);
    // Branches without LightningCSS are left untouched.
    expect(
      rulesByName.get('css')!.getOneOf('css-main').uses.delete,
    ).not.toHaveBeenCalled();
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

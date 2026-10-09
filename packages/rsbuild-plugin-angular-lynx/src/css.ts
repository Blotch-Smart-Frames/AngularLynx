// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CssExtractRspackPluginOptions } from '@lynx-js/css-extract-webpack-plugin';
import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import { CSSPlugins } from '@lynx-js/template-webpack-plugin';
import type { CSSLoaderOptions } from '@rsbuild/core';
import { LAYERS } from './layers.js';
import type { PluginAngularLynxOptions } from './utils/options.js';

export const applyCSS = (
  api: RsbuildPluginAPI,
  options: Required<PluginAngularLynxOptions>,
): void => {
  const {
    enableRemoveCSSScope,
    enableCSSSelector,
    enableCSSInvalidation,
    targetSdkVersion,
  } = options;

  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
    return mergeRsbuildConfig(config, {
      // This has following effects:
      // - disables `style-loader`
      // - enables CssExtractRspackPlugin
      // - disables `experiment.css`(which is all we need)
      // See: https://rsbuild.dev/config/output/inject-styles
      output: { injectStyles: false },
    });
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  api.modifyBundlerChain(async (chain, { CHAIN_ID, environment }) => {
    // css-extract-webpack-plugin 0.8 dropped webpack support, so the Rspack
    // plugin is the only one left (and Rspeedy only ever runs Rspack).
    const { CssExtractRspackPlugin } =
      await import('@lynx-js/css-extract-webpack-plugin');

    /**
     * LightningCSS transforms CSS features that Lynx's native CSS engine
     * doesn't support (e.g. nesting, custom media queries). But it also
     * rewrites selectors in ways that break Lynx's CSS matching — for example,
     * it merges duplicate selectors and reorders properties. Remove it so
     * CSS passes through to Lynx's engine as-authored.
     *
     * It takes a `oneOf` branch rather than the whole CSS rule because Rsbuild 2
     * attaches the loaders to the branches. Calling it on the parent rule would
     * find no LightningCSS loader there and silently leave it in place.
     */
    const removeLightningCSS = (
      rule: ReturnType<ReturnType<typeof chain.module.rule>['oneOf']>,
    ) => {
      if (
        rule.uses.has(CHAIN_ID.USE.LIGHTNINGCSS) &&
        // We only disable lightningcss for Lynx
        environment.name === 'lynx'
      ) {
        rule.uses.delete(CHAIN_ID.USE.LIGHTNINGCSS);
      }
    };

    const cssRules = [
      CHAIN_ID.RULE.CSS,
      CHAIN_ID.RULE.SASS,
      CHAIN_ID.RULE.LESS,
      CHAIN_ID.RULE.STYLUS,
    ] as const;

    for (const ruleName of cssRules.filter((rule) =>
      chain.module.rules.has(rule),
    )) {
      const rule = chain.module.rule(ruleName);
      // Rsbuild 2 no longer puts the loaders on the CSS rule itself: the rule
      // holds `oneOf` branches — the main branch (`css-main` for plain CSS,
      // `<rule>` for Sass/Less/Stylus) and the `?inline` branch. Only the main
      // branch emits stylesheets, so that is where extraction happens.
      const mainRuleName =
        ruleName === CHAIN_ID.RULE.CSS ? CHAIN_ID.ONE_OF.CSS_MAIN : ruleName;
      const mainRule = rule.oneOf(mainRuleName);
      // `test`/`dependency` now live on the parent rule, so the main-thread
      // copy below has to take them from there rather than from the branch.
      const parentRuleEntries = rule.entries() as Rspack.RuleSetRule;

      removeLightningCSS(mainRule);

      // Background layer: extract CSS to separate .css files for the Lynx
      // template plugin. CSS is processed by css-loader → CssExtractPlugin.
      mainRule
        .issuerLayer(LAYERS.BACKGROUND)
        .use(CHAIN_ID.USE.MINI_CSS_EXTRACT)
        .loader(CssExtractRspackPlugin.loader)
        .end();

      // The Rsbuild default loaders
      //   - CssExtractRspackPlugin.loader
      //   - css-loader
      //   - resolve-url-loader(for sass/less)
      //   - sass-loader/less-loader(for sass/less)
      // `?? {}`: rspack-chain returns undefined (not an empty map) for a branch
      // with no loaders, and the lookup below must not throw on it.
      const uses = mainRule.uses.entries() ?? {};
      const ruleEntries = mainRule.entries();

      // A branch without css-loader (e.g. a preprocessor plugin that wires its
      // main branch differently) has nothing to copy into the main-thread rule,
      // and calling `.entries()` on the missing loader would crash the build.
      // Skip it, as React Lynx does, and leave that rule as Rsbuild built it.
      const cssLoader = uses[CHAIN_ID.USE.CSS];
      if (!cssLoader) {
        continue;
      }
      const cssLoaderRule = cssLoader.entries() as Rspack.RuleSetRule;

      // Main-thread layer: CSS is NOT extracted — the main thread JS has no
      // CSS runtime. Use ignore-css-loader to return empty module exports.
      // css-loader still runs (with exportOnlyLocals: true) so CSS module
      // class name bindings resolve, but no actual CSS is emitted.
      const mainThreadLayerRule = chain.module
        .rule(`${ruleName}:${LAYERS.MAIN_THREAD}`)
        .test(parentRuleEntries.test as RegExp)
        .merge(ruleEntries)
        .issuerLayer(LAYERS.MAIN_THREAD);
      // The main-thread rule is a standalone top-level rule, not a branch, so it
      // needs the parent's conditions copied in explicitly. Without `test` it
      // would match every module (running css-loader on JS); without
      // `dependency: { not: 'url' }` it would also catch `url()` asset
      // references, which must stay with the asset rules.
      if (parentRuleEntries.dependency !== undefined) {
        mainThreadLayerRule.merge({ dependency: parentRuleEntries.dependency });
      }

      // dprint-ignore
      mainThreadLayerRule
        .use(CHAIN_ID.USE.IGNORE_CSS)
        .loader(path.resolve(__dirname, './loaders/ignore-css-loader'))
        .end()
        .uses.merge(uses)
        .delete(CHAIN_ID.USE.MINI_CSS_EXTRACT)
        .delete(CHAIN_ID.USE.LIGHTNINGCSS)
        .delete(CHAIN_ID.USE.CSS)
        .end()
        // We replace the css-loader rules with the normalized one
        // to force setting `exportOnlyLocals: true`.
        .use(CHAIN_ID.USE.CSS)
        .after(CHAIN_ID.USE.IGNORE_CSS)
        .merge(cssLoaderRule)
        .options(
          normalizeCssLoaderOptions(
            cssLoaderRule.options as CSSLoaderOptions,
            true,
          ),
        )
        .end();
    }

    // `?inline` imports are their own `oneOf` branch in Rsbuild 2 (the separate
    // `*_INLINE` rule IDs are gone); they still need LightningCSS removed.
    for (const ruleName of cssRules.filter((rule) =>
      chain.module.rules.has(rule),
    )) {
      const inlineRuleName =
        ruleName === CHAIN_ID.RULE.CSS
          ? CHAIN_ID.ONE_OF.CSS_INLINE
          : `${ruleName}-inline`;
      removeLightningCSS(chain.module.rule(ruleName).oneOf(inlineRuleName));
    }

    // Inline `@font-face` fonts as Base64 data URIs on Lynx.
    //
    // A font referenced from CSS `@font-face { src: url(...) }` is resolved by
    // css-extract's child compilation, which hardcodes a `webpack://` base URI
    // and does NOT inherit the runtime publicPath the way JS-imported assets
    // (e.g. an `<image src>` import) do. The result is a baked-in
    // `webpack:///static/font/<name>.<hash>.ttf` URL — a scheme the native Lynx
    // `GenericResourceFetcher` cannot fetch (iOS reports NSURLErrorDomain -1002
    // "unsupported URL"), so every custom font silently fails to load. Because
    // the URL is absolute (it carries the `webpack://` scheme) Lynx does not
    // re-resolve it against the bundle origin, unlike the root-relative
    // `/static/image/...` paths that make images work.
    //
    // `output.dataUriLimit` can't fix this: the `url()` request matches
    // css-loader's `?__inline=false` asset/resource branch before the size
    // threshold is ever consulted. Instead, force fonts to inline. Data URIs are
    // absolute, so they survive the `webpack://` base-URI join untouched and
    // need no network fetch or publicPath at all — exactly what the Lynx
    // `@font-face` docs recommend ("Base64-encoded fonts"). Only the Lynx target
    // is affected; web keeps normal asset/resource fonts served over HTTP.
    if (
      environment.name === 'lynx' &&
      chain.module.rules.has(CHAIN_ID.RULE.FONT)
    ) {
      const fontRule = chain.module.rule(CHAIN_ID.RULE.FONT);
      // Drop the oneOf branches (asset/resource plus the `?url`/`?inline`/`?raw`
      // query variants) that would emit a separate font file Lynx can't fetch,
      // and inline every matched font instead regardless of any css-loader query.
      fontRule.oneOfs.clear();
      fontRule.type('asset/inline');
    }

    chain
      .plugin(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)
      .tap(([options]) => {
        return [
          {
            ...options,
            enableRemoveCSSScope,
            enableCSSSelector,
            enableCSSInvalidation,
            targetSdkVersion,
            cssPlugins: [CSSPlugins.parserPlugins.removeFunctionWhiteSpace()],
          } as CssExtractRspackPluginOptions,
        ];
      })
      .init((_, args: unknown[]) => {
        return new CssExtractRspackPlugin(
          ...(args as [options: CssExtractRspackPluginOptions]),
        );
      })
      .end()
      .end();

    // We add `sideEffects: false` to all Scoped CSS Modules.
    // Since there is no need to emit scoped CSS when the CSS Modules is not used.
    chain.module.when(
      // - enableRemoveCSSScope === undefined: we will add `?cssId=<hash>` to all CSS Modules
      //   E.g.: `import styles from './foo.modules.css'`
      enableRemoveCSSScope === undefined,
      (module) =>
        module
          .rule('lynx.css.scoped')
          .test(/\.css$/)
          .resourceQuery({
            and: [
              /cssId/,
              // Global CSS (?common) must always be emitted — exclude it from tree-shaking
              { not: /common/ },
            ],
          })
          .sideEffects(false),
    );
  });
};

/**
 * This is copied from https://github.com/web-infra-dev/rsbuild/blob/9f8be2d71ffeb7da969cda36fd9755db2cadaff5/packages/core/src/plugins/css.ts#L42
 *
 * If the target is not `web` and the modules option of css-loader is enabled,
 * we must enable exportOnlyLocals to only exports the modules identifier mappings.
 * Otherwise, the compiled CSS code may contain invalid code, such as `new URL`.
 * https://github.com/webpack-contrib/css-loader#exportonlylocals
 */
export const normalizeCssLoaderOptions = (
  options: CSSLoaderOptions,
  exportOnlyLocals: boolean,
): CSSLoaderOptions => {
  if (options.modules && exportOnlyLocals) {
    let { modules } = options;
    if (modules === true) {
      modules = { exportOnlyLocals: true };
    } else if (typeof modules === 'string') {
      modules = {
        // @ts-expect-error Type 'string' is not assignable to type 'CSSLoaderModulesMode | undefined'.
        mode: modules,
        exportOnlyLocals: true,
      };
    } else {
      // create a new object to avoid modifying the original options
      modules = {
        ...modules,
        exportOnlyLocals: true,
      };
    }

    return {
      ...options,
      modules,
    };
  }

  return options;
};

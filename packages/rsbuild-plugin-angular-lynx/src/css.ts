// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CssExtractRspackPluginOptions,
  CssExtractWebpackPluginOptions,
} from '@lynx-js/css-extract-webpack-plugin';
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
    const { CssExtractRspackPlugin, CssExtractWebpackPlugin } =
      await import('@lynx-js/css-extract-webpack-plugin');
    const CssExtractPlugin =
      api.context.bundlerType === 'rspack'
        ? CssExtractRspackPlugin
        : CssExtractWebpackPlugin;

    /**
     * LightningCSS transforms CSS features that Lynx's native CSS engine
     * doesn't support (e.g. nesting, custom media queries). But it also
     * rewrites selectors in ways that break Lynx's CSS matching — for example,
     * it merges duplicate selectors and reorders properties. Remove it so
     * CSS passes through to Lynx's engine as-authored.
     */
    const removeLightningCSS = (rule: ReturnType<typeof chain.module.rule>) => {
      if (
        // Webpack does not have lightningcss-loader
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

      removeLightningCSS(rule);

      // Background layer: extract CSS to separate .css files for the Lynx
      // template plugin. CSS is processed by css-loader → CssExtractPlugin.
      rule
        .issuerLayer(LAYERS.BACKGROUND)
        .use(CHAIN_ID.USE.MINI_CSS_EXTRACT)
        .loader(CssExtractPlugin.loader)
        .end();

      // The Rsbuild default loaders
      //   - CssExtractRspackPlugin.loader
      //   - css-loader
      //   - resolve-url-loader(for sass/less)
      //   - sass-loader/less-loader(for sass/less)
      const uses = rule.uses.entries();
      const ruleEntries = rule.entries() as Rspack.RuleSetRule;

      const cssLoaderRule = uses[
        CHAIN_ID.USE.CSS
      ]?.entries() as Rspack.RuleSetRule;

      // Main-thread layer: CSS is NOT extracted — the main thread JS has no
      // CSS runtime. Use ignore-css-loader to return empty module exports.
      // css-loader still runs (with exportOnlyLocals: true) so CSS module
      // class name bindings resolve, but no actual CSS is emitted.
      // dprint-ignore
      chain.module
        .rule(`${ruleName}:${LAYERS.MAIN_THREAD}`)
        .merge(ruleEntries)
        .issuerLayer(LAYERS.MAIN_THREAD)
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

    const inlineCSSRules = [
      CHAIN_ID.RULE.CSS_INLINE,
      CHAIN_ID.RULE.SASS_INLINE,
      CHAIN_ID.RULE.LESS_INLINE,
      CHAIN_ID.RULE.STYLUS_INLINE,
    ] as const;

    for (const ruleName of inlineCSSRules.filter(
      (rule) => rule && chain.module.rules.has(rule),
    )) {
      const rule = chain.module.rule(ruleName);
      removeLightningCSS(rule);
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
          } as CssExtractWebpackPluginOptions | CssExtractRspackPluginOptions,
        ];
      })
      .init((_, args: unknown[]) => {
        return new CssExtractPlugin(
          ...(args as [
            options: CssExtractWebpackPluginOptions &
              CssExtractRspackPluginOptions,
          ]),
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

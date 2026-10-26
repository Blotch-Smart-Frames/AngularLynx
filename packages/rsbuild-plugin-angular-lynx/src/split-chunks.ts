// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { NormalizedPluginAngularLynxOptions } from './utils/options.js';

// type CacheGroups = Rspack.Configuration extends {
//   optimization?: {
//     splitChunks?:
//       | {
//         cacheGroups?: infer P
//       }
//       | false
//       | undefined
//   } | undefined
// } ? P
//   : never

// type SplitChunks = Rspack.Configuration extends {
//   optimization?: {
//     splitChunks?: infer P
//   } | undefined
// } ? P
//   : never

// const isPlainObject = (obj: unknown): obj is Record<string, unknown> =>
//   obj !== null
//   && typeof obj === 'object'
//   && Object.prototype.toString.call(obj) === '[object Object]'

export const applySplitChunksRule = (
  api: RsbuildPluginAPI,
  options: NormalizedPluginAngularLynxOptions,
): void => {
  // Per environment rather than global: `splitChunks` can be set per
  // environment (e.g. only for `web`), so each one needs its own decision.
  api.modifyEnvironmentConfig((config, { name, mergeEnvironmentConfig }) => {
    // Read the user's intent for this environment, preferring the
    // environment-scoped config over the global one (as React Lynx does). The
    // 'original' config is used because the merged `config` already carries
    // Rsbuild's defaults, which would make it look as if the user had
    // configured splitting and stop us from turning it off.
    const userConfig = api.getRsbuildConfig('original');
    const scoped = userConfig.environments?.[name];
    const splitChunks = scoped?.splitChunks ?? userConfig.splitChunks;
    const chunkSplitStrategy =
      scoped?.performance?.chunkSplit?.strategy ??
      userConfig.performance?.chunkSplit?.strategy;
    // Disabling chunk splitting is critical for lazy loading: without it,
    // shared dependencies get extracted into unnamed sibling chunks that are
    // absent from lynx_aci (Lynx's async chunk index). Those unnamed chunks
    // fall through to requireModuleAsync (broken on some SDKs), causing
    // navigation failures. With splitting off, each lazy route is a single
    // self-contained chunk.
    //
    // Rsbuild 2 replaced `performance.chunkSplit` with the top-level
    // `splitChunks` option and ignores the legacy one once `splitChunks` is
    // set, so we set `splitChunks: false` — unless the user configured
    // splitting themselves. A legacy `all-in-one` strategy still maps to
    // "off", matching React Lynx's handling.
    if (
      splitChunks === undefined &&
      (!chunkSplitStrategy || chunkSplitStrategy === 'all-in-one')
    ) {
      return mergeEnvironmentConfig(config, { splitChunks: false });
    }
    return config;
  });

  // Every environment, not just `lynx`: the web bundle is a Lynx bundle too
  // (encoded by WebEncodePlugin), with the same main-thread / background
  // split, and React Lynx applies its rule to every environment as well.
  api.modifyRspackConfig((rspackConfig) => {
    // When experimental_isLazyBundle is disabled (the default), set asyncChunks=false
    // so rspack inlines all dynamic imports into the initial bundle. Routes still use
    // loadComponent() syntax but modules are synchronously available at runtime — this
    // avoids needing Lynx's async chunk loading (lynx.loadLazyBundle → QueryComponent),
    // which needs a main-thread half in every lazy bundle. The plugin compiles both
    // threads' modules into the same layer, so the two entries share one async chunk,
    // and the lazy bundle encoded from it has no main-thread code. Applying this only to
    // `lynx` once left `web` emitting such bundles: Lynx for Web evaluates a lazy
    // bundle's main-thread root when loading it, so every lazy route and @defer block
    // failed there with "SyntaxError: Unexpected token '}'".
    // When enabled, asyncChunks remains true and each loadComponent() produces a
    // separate lazy bundle loaded at runtime.
    rspackConfig.output = rspackConfig.output ?? {};
    if (!options.experimental_isLazyBundle) {
      (rspackConfig.output as any).asyncChunks = false;
    }

    if (!rspackConfig.optimization) {
      return rspackConfig;
    }

    if (!rspackConfig.optimization.splitChunks) {
      return rspackConfig;
    }
    // Preserve the user's original `chunks` setting (e.g. 'async', 'initial', 'all', or a function)
    // so we can compose it with the main-thread exclusion below.
    const originalChunks = rspackConfig.optimization.splitChunks.chunks;

    rspackConfig.optimization.splitChunks.chunks = (chunk) => {
      // Main-thread chunks must never be split — they run on the native UI thread
      // and must remain as single bundles.
      if (chunk.name?.includes('__main-thread')) {
        return false;
      }

      // Apply the original chunks filter so user settings like 'async' are respected.
      if (typeof originalChunks === 'function') {
        return originalChunks(chunk);
      }
      if (originalChunks === 'async') {
        return !chunk.canBeInitial();
      }
      if (originalChunks === 'initial') {
        return chunk.canBeInitial();
      }
      // 'all' or unset — include all non-main-thread chunks
      return true;
    };
    return rspackConfig;
  });
};

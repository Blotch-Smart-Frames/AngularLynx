// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

// import * as fs from 'node:fs';
// import { createRequire } from 'node:module';

import { LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin';
import { RuntimeGlobals } from '@lynx-js/webpack-runtime-globals';
import type { Chunk, Compilation, Compiler } from '@rspack/core';
import invariant from 'tiny-invariant';
import { LAYERS } from './layers.js';
import { createLynxProcessEvalResultRuntimeModule } from './lynx-process-eval-result-runtime-module.js';

// const require = createRequire(import.meta.url);

/**
 * The options for extractStr.
 *
 * @public
 */
export type ExtractStrConfig = {
  /**
   * The minimum length of string literals to be extracted.
   *
   * @defaultValue `20`
   *
   * @public
   */
  strLength: number;
  /**
   * @internal
   */
  extractedStrArr?: string[];
};
/**
 * The options for AngularWebpackPluginOptions
 *
 * @public
 */
type AngularWebpackPluginOptions = {
  /**
   * Whether to disable warnings about incompatible createSelectorQuery usage
   */
  disableCreateSelectorQueryIncompatibleWarning?: boolean | undefined;

  /**
   * When to sync the first screen content
   */
  firstScreenSyncTiming?: 'immediately' | 'jsReady';

  /**
   * Whether to enable server-side rendering
   */
  enableSSR?: boolean;

  /**
   * Whether this bundle targets the web runtime (`@lynx-js/web-core`) rather
   * than native Lynx. Injected into the bundle as the `__WEB__` compile-time
   * define so the runtime can branch on web-only behavior (e.g. forcing the
   * first element-tree flush, which native does implicitly but web-core does
   * not). Set from `environment.name === 'web'` in entry.ts.
   */
  isWeb?: boolean;

  /**
   * The chunk names to be considered as main thread chunks.
   */
  mainThreadChunks?: string[] | undefined;

  /**
   * Merge same string literals in JS and Lepus to reduce output bundle size.
   * Set to `false` to disable.
   *
   * @defaultValue false
   */
  extractStr?: Partial<ExtractStrConfig> | boolean;

  /**
   * Whether to enable lazy bundle.
   *
   * @alpha
   */
  experimental_isLazyBundle?: boolean;
};

/**
 * AngularWebpackPlugin allows using Angular with Lynx and webpack
 *
 * @example
 * ```js
 * // webpack.config.js
 * import { AngularWebpackPlugin } from '@lynx-js/angular-webpack-plugin'
 * export default {
 *   plugins: [new AngularWebpackPlugin()],
 * }
 * ```
 *
 * @public
 */
class AngularWebpackPlugin {
  /**
   * The loaders for Angular with Lynx.
   *
   * @remarks
   * Note that this loader will only transform TypeScript to valid JavaScript.
   * You should use `swc-loader` to load TypeScript files.
   *
   * @example
   * ```js
   * // webpack.config.js
   * import { AngularWebpackPlugin, LAYERS } from '@lynx-js/angular-webpack-plugin'
   * export default {
   *   module: {
   *     rules: [
   *       {
   *         test: /\.ts$/,
   *         layer: LAYERS.MAIN_THREAD,
   *         use: ['swc-loader', AngularWebpackPlugin.loaders.MAIN_THREAD]
   *       },
   *       {
   *         test: /\.ts$/,
   *         layer: LAYERS.BACKGROUND,
   *         use: ['swc-loader', AngularWebpackPlugin.loaders.BACKGROUND]
   *       },
   *     ],
   *   },
   *   plugins: [new AngularWebpackPlugin()],
   * }
   * ```
   *
   * @public
   */ // static loaders: Record<keyof typeof LAYERS, string> = {
  //   BACKGROUND: require.resolve('../lib/loaders/background.js'),
  //   MAIN_THREAD: require.resolve('../lib/loaders/main-thread.js'),
  // };
  options: AngularWebpackPluginOptions | undefined;
  constructor(options?: AngularWebpackPluginOptions | undefined) {
    this.options = options;
  }

  /**
   * `defaultOptions` is the default options that the {@link AngularWebpackPlugin} uses.
   *
   * @public
   */
  static defaultOptions: Readonly<Required<AngularWebpackPluginOptions>> =
    Object.freeze<Required<AngularWebpackPluginOptions>>({
      disableCreateSelectorQueryIncompatibleWarning: false,
      firstScreenSyncTiming: 'immediately',
      enableSSR: false,
      isWeb: false,
      mainThreadChunks: [],
      extractStr: false,
      experimental_isLazyBundle: false,
    });

  /**
   * The entry point of a webpack plugin.
   * @param compiler - the webpack compiler
   */
  apply(compiler: Compiler): void {
    const options = Object.assign(
      {},
      AngularWebpackPlugin.defaultOptions,
      this.options,
    );

    // SSR requires synchronous first-frame rendering via the jsReady timing
    // so the engine can call ssrEncode after the first render completes.
    if (options.enableSSR && options.firstScreenSyncTiming !== 'jsReady') {
      options.firstScreenSyncTiming = 'jsReady';
    }

    const { DefinePlugin, EnvironmentPlugin } = compiler.webpack;

    new EnvironmentPlugin({
      // Default values of null and undefined behave differently.
      // Use undefined for variables that must be provided during bundling, or null if they are optional.
      DEBUG: null,
    }).apply(compiler);
    new DefinePlugin({
      __DEV__: JSON.stringify(compiler.options.mode === 'development'),
      // We enable profile by default in development.
      __PROFILE__: JSON.stringify(compiler.options.mode === 'development'),
      __EXTRACT_STR__: JSON.stringify(Boolean(options.extractStr)),
      __FIRST_SCREEN_SYNC_TIMING__: JSON.stringify(
        options.firstScreenSyncTiming,
      ),
      __ENABLE_SSR__: JSON.stringify(options.enableSSR),
      // Web target flag. Native builds get `false`, so any `if (__WEB__)` block
      // in the runtime is dead-code-eliminated from native bundles.
      __WEB__: JSON.stringify(Boolean(options.isWeb)),
      __DISABLE_CREATE_SELECTOR_QUERY_INCOMPATIBLE_WARNING__: JSON.stringify(
        options.disableCreateSelectorQueryIncompatibleWarning,
      ),
    }).apply(compiler);

    compiler.hooks.thisCompilation.tap(this.constructor.name, (compilation) => {
      const onceForChunkSet = new WeakSet<Chunk>();

      // Lazy loading wiring: when webpack detects a dynamic import() and emits
      // ensureChunkHandlers (the hook for async chunk loading), we add
      // lynxProcessEvalResult as a runtime requirement. This installs the
      // chunk-installation function that Lynx's native runtime calls after it
      // fetches and evaluates an async chunk via requireModuleAsync.
      compilation.hooks.runtimeRequirementInTree
        .for(compiler.webpack.RuntimeGlobals.ensureChunkHandlers)
        .tap('VanillaWebpackPlugin', (chunk, runtimeRequirements) => {
          runtimeRequirements.add(RuntimeGlobals.lynxProcessEvalResult);
        });

      // Add the lynxProcessEvalResult runtime module to ALL chunks that need it,
      // including background-thread chunks. Angular Router's loadComponent() runs
      // on the background thread, so chunk installation must work there. An earlier
      // version excluded :background chunks — that caused lazy routes to silently
      // fail because the chunk installer was missing from the thread that needed it.
      compilation.hooks.runtimeRequirementInTree
        .for(RuntimeGlobals.lynxProcessEvalResult)
        .tap('VanillaWebpackPlugin', (chunk) => {
          if (onceForChunkSet.has(chunk)) {
            return;
          }
          onceForChunkSet.add(chunk);

          const LynxProcessEvalResultRuntimeModule =
            createLynxProcessEvalResultRuntimeModule(compiler.webpack);
          compilation.addRuntimeModule(
            chunk,
            new LynxProcessEvalResultRuntimeModule(),
          );
        });

      // Mark main-thread assets with `lynx:main-thread` info so
      // LynxTemplatePlugin knows which .js files are Lepus code (main thread)
      // vs background-thread code. This includes both explicitly listed
      // mainThreadChunks AND any async chunks whose originating modules are
      // in the MAIN_THREAD layer (e.g. lazy route main-thread splits).
      compilation.hooks.processAssets.tap(
        {
          name: this.constructor.name,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          for (const name of options.mainThreadChunks ?? []) {
            this.#updateMainThreadInfo(compilation, name);
          }

          for (const cg of compilation.chunkGroups
            .filter((cg) => !cg.isInitial())
            .filter((cg) =>
              cg.origins.every(
                (origin) => origin.module?.layer === LAYERS.MAIN_THREAD,
              ),
            )) {
            const files = cg.getFiles();
            for (const name of files.filter((name) => name.endsWith('.js'))) {
              this.#updateMainThreadInfo(compilation, name);
            }
          }
        },
      );

      // Inject __MAIN_THREAD__ flag and globDynamicComponentEntry into chunks.
      // The thread-globals-loader approach (via webpack layers/oneOf) is unreliable
      // because Rsbuild's parent typescript rule processes modules before the oneOf
      // rules match. Instead, inject the flag directly into the bundled output.
      //
      // For lazy loading: __MAIN_THREAD__ is critical because the main thread (Lepus)
      // has NO async module loading capability — lynx.requireModuleAsync is background-
      // thread-only. Runtime code checks this flag to suppress chunk loading on the
      // main thread (returning a never-resolving promise) preventing crashes.
      {
        const { ConcatSource } = compiler.webpack.sources;
        const mainThreadChunkSet = new Set(options.mainThreadChunks ?? []);

        compilation.hooks.processAssets.tap(
          {
            name: `${this.constructor.name}:threadGlobals`,
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
          },
          () => {
            for (const [name] of Object.entries(compilation.assets).filter(
              ([n]) => n.endsWith('.js'),
            )) {
              const isMainThread = mainThreadChunkSet.has(name);
              const prefix = `globalThis["__MAIN_THREAD__"]=${isMainThread};`;
              compilation.updateAsset(
                name,
                (old) => new ConcatSource(prefix, old),
              );
            }

            // Inject globDynamicComponentEntry into main-thread chunks.
            // Only needed when NOT in lazy bundle mode — in that mode, async
            // sub-bundles provide their own entry via the AMD init mechanism
            // and globDynamicComponentEntry comes from the native runtime context.
            if (!options.experimental_isLazyBundle) {
              for (const name of options.mainThreadChunks ?? []) {
                const asset = compilation.getAsset(name);
                if (!asset) continue;

                const source = asset.source.source().toString();
                const useStrictPrefix = /^(['"])use strict\1;?/.test(source)
                  ? `'use strict';`
                  : '';

                compilation.updateAsset(
                  name,
                  (old) =>
                    new ConcatSource(
                      `${useStrictPrefix}var globDynamicComponentEntry=globDynamicComponentEntry||'__Card__';`,
                      old,
                    ),
                );
              }
            }
          },
        );
      }

      const hooks = LynxTemplatePlugin.getLynxTemplatePluginHooks(
        compilation as unknown as Parameters<
          typeof LynxTemplatePlugin.getLynxTemplatePluginHooks
        >[0],
      );

      const { ConcatSource } = compiler.webpack.sources;

      // Inject `module.exports` wrapper for DynamicComponent (lazy bundle)
      // main-thread chunks. When the native engine loads a lazy bundle, it
      // evaluates the main-thread JS via __init_card_bundle__() which expects
      // a function that returns `module.exports`. Card-type (root app) chunks
      // don't need this — they execute at top level. Only DynamicComponent
      // chunks (from loadComponent routes) need the wrapper.
      hooks.beforeEncode.tap(this.constructor.name, (args) => {
        const { encodeData } = args;

        // Enable CSS custom property resolution (var(--xxx) / {{--xxx}}) in the
        // Lynx native runtime. Without this, Lynx's CSS engine can't resolve
        // variable references like hsl({{--background}}/1) — every Tailwind
        // theme color, border-radius, etc. that uses CSS variables silently
        // evaluates to nothing, producing a page with no visible styles.
        // React Lynx enables this via pluginLynxConfig({ enableCSSInlineVariables: true }).
        // This is a Config option (sourceContent.config), NOT a CompilerOptions
        // option — the Lynx engine reads it from the config section at runtime.
        encodeData.sourceContent.config = {
          ...encodeData.sourceContent.config,
          enableCSSInlineVariables: true,
        };

        if (!encodeData.lepusCode.root) {
          return args;
        }

        if (encodeData.sourceContent.appType === 'card') {
          return args;
        }

        compilation.updateAsset(
          encodeData.lepusCode.root.name,
          (old) =>
            new ConcatSource(
              `\
(function (globDynamicComponentEntry) {
  const module = { exports: {} }
  const exports = module.exports
`,
              old,
              `
  ;return module.exports
})`,
            ),
        );
        return args;
      });
    });
  }

  #updateMainThreadInfo(compilation: Compilation, name: string) {
    const asset = compilation.getAsset(name);

    invariant(asset, `Should have main thread asset ${name}`);

    compilation.updateAsset(asset.name, asset.source, {
      ...asset.info,
      'lynx:main-thread': true,
    });
  }
}

export type { AngularWebpackPluginOptions };
export { AngularWebpackPlugin };

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
import { styleIndexOf, styleIndexStatement } from './style-index.js';
import { createLynxProcessEvalResultRuntimeModule } from './lynx-process-eval-result-runtime-module.js';
import type { PreferredFps } from './utils/options.js';

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

  /**
   * The frame rate Lynx asks for while it animates, written into the page
   * config (see PluginAngularLynxOptions' `preferredFps`).
   *
   * @defaultValue 'high'
   */
  preferredFps?: PreferredFps;

  /**
   * Whether touch events carry every finger, written into the page config
   * as `enableMultiTouch` (see PluginAngularLynxOptions' `multiTouch`).
   *
   * @defaultValue false
   */
  multiTouch?: boolean;
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
      preferredFps: 'high',
      multiTouch: false,
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
      // including background-thread chunks: an `import()` in a background
      // function loads a background chunk. An earlier version excluded
      // :background chunks — that caused lazy routes to silently fail because the
      // chunk installer was missing from the thread that needed it.
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
      // SWC replaces `__MAIN_THREAD__` in each module with its layer's value
      // (layers.ts); the global is for code that reads it from `globalThis`.
      // A main-thread lazy chunk sets it too, so it's told apart by the
      // `lynx:main-thread` info set at the ADDITIONAL stage above: setting
      // `false` there would flip the main thread's global when it loads one.
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
            this.#markMainThreadHotUpdates(compilation, mainThreadChunkSet);
            // What the runtime needs to know of the app's CSS to draw text
            // written for the browser (see style-index.ts): read from the
            // stylesheets the compilation made, once, for the entry's
            // main-thread chunk, where Angular runs.
            let styleIndex: string | undefined;
            const styleIndexFor = (): string =>
              (styleIndex ??= styleIndexStatement(
                styleIndexOf(
                  Object.keys(compilation.assets)
                    .filter((n) => n.endsWith('.css'))
                    // Each name is a key of compilation.assets.
                    .map((n) =>
                      compilation.getAsset(n)!.source.source().toString(),
                    ),
                ),
              ));
            for (const [name] of Object.entries(compilation.assets).filter(
              ([n]) =>
                n.endsWith('.js') &&
                // A hot update runs in a thread that already has the flag,
                // and the value here would be wrong for the main thread's:
                // only the initial chunks are in mainThreadChunkSet.
                !compilation.getAsset(n)?.info.hotModuleReplacement,
            )) {
              const isMainThread =
                mainThreadChunkSet.has(name) ||
                compilation.getAsset(name)?.info['lynx:main-thread'] === true;
              const prefix =
                `globalThis["__MAIN_THREAD__"]=${isMainThread};` +
                (mainThreadChunkSet.has(name) ? styleIndexFor() : '');
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

      // A native lazy bundle's main-thread code is a function of the
      // bundle's entry that returns the chunk (`{ ids, modules }`): the
      // runtime's loader (chunk-loader.ts) evaluates the bundle's main-thread
      // section with `lynx.loadScript()`, which returns what the script
      // evaluates to, and calls it. Lynx for Web runs the section as CommonJS
      // and returns its `module.exports` (web-core's template loader starts
      // it with `var exports=(module.exports={});`), which the chunk sets
      // itself, so the web's isn't wrapped. The entries' own main-thread
      // files run as they are. As in React Lynx, this runs after the minifier
      // (which could drop the wrapped code as unused) and before the source
      // maps are made (which the extra lines would shift), and well before
      // LynxTemplatePlugin reads the files into the bundle.
      if (!options.isWeb) {
        const { ConcatSource } = compiler.webpack.sources;
        const mainThreadChunkSet = new Set(options.mainThreadChunks ?? []);
        compilation.hooks.processAssets.tap(
          {
            name: `${this.constructor.name}:lazyBundleWrapper`,
            stage:
              compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE +
              1,
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (
                asset.name.endsWith('.js') &&
                asset.info['lynx:main-thread'] === true &&
                !mainThreadChunkSet.has(asset.name) &&
                // The main thread's hot update client runs a hot update
                // chunk's CommonJS as it is.
                !asset.info.hotModuleReplacement
              ) {
                compilation.updateAsset(
                  asset.name,
                  (old) =>
                    new ConcatSource(
                      `(function (globDynamicComponentEntry) {
  const module = { exports: {} }
  const exports = module.exports
`,
                      old,
                      `
  ;return module.exports
})`,
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
        //
        // enableElementInvokeUIMethodPendingTask (Lynx 4.1) queues a UI
        // method (__InvokeUIMethod: focus, scrollIntoView, a field's setValue,
        // boundingClientRect) on its element, and sends it to the UI with the
        // element's next flush, after the operations that make and change
        // its UI. Without it, the call goes straight to the UI thread. That
        // was safe while the apps ran Lynx's engine on the UI thread (Lynx's
        // default thread strategy): native had made the UI of every element
        // flushed so far, and answered a call on one it hadn't yet at once,
        // so the runtime could call again after the flush. The shells now
        // run the engine on a thread of its own (see packages/native), where
        // the flush reaches the UI later and the answer comes later still: a
        // field focused as it appears would have been dropped.
        encodeData.sourceContent.config = {
          ...encodeData.sourceContent.config,
          enableCSSInlineVariables: true,
          // Lynx runs every animation and transition from a CADisplayLink on
          // iOS, and only asks it for more than 60 fps with 'high'. The app's
          // Info.plist has to allow it too (CADisableMinimumFrameDurationOnPhone
          // in packages/native's template). Android ignores it.
          preferredFps:
            this.options?.preferredFps ??
            AngularWebpackPlugin.defaultOptions.preferredFps,
          enableElementInvokeUIMethodPendingTask: true,
          // Lynx reads it from the page config when the bundle loads, on iOS
          // (LynxUIRenderer's touch recognizer) and Android
          // (TouchEventDispatcher), and nowhere else: a LynxView has no
          // property for it. Lynx for Web has no flag; its touch events
          // carry the browser's touch lists either way.
          enableMultiTouch:
            this.options?.multiTouch ??
            AngularWebpackPlugin.defaultOptions.multiTouch,
          // iOS exposure measures elements against the active scene's key
          // window, and with this on (Lynx's default) an app that isn't
          // active has none: Control Center, Notification Center or the app
          // switcher over the app, or the app in the background, takes every
          // element off the screen. A browser's IntersectionObserver reports
          // nothing then, and code written for it stops work it takes to be
          // out of sight, such as angular-three's drawing, which then misses
          // the light or dark switch made in Control Center. Off, iOS checks
          // against the key window of a scene in the foreground, active or
          // not. Android reads its own option for this,
          // enableDisexposureWhenLynxHidden, which this leaves on.
          enableDisexposureWhenBackground: false,
          // The shells set the LynxView's font scale from the phone's text
          // size (Dynamic Type on iOS, the font size on Android). Lynx would
          // multiply every px font-size, line-height and letter-spacing by
          // it; with this, only `sp` lengths grow, which the page's root font
          // size is written in (text-scale.ts). Everything in `rem` grows
          // with the root, and a px size stays as written, as on the web.
          fontScaleEffectiveOnlyOnSp: true,
        };

        return args;
      });
    });
  }

  /**
   * Marks the hot update chunks of the main thread's chunks as main-thread
   * code, as their chunks are. The main thread loads them itself (see
   * client/main-thread-hot-updates.ts), so they must stay plain CommonJS:
   * RuntimeWrapperWebpackPlugin skips marked files, and wraps the rest in the
   * background thread's module loader. LynxTemplatePlugin leaves hot updates
   * out of the bundle either way.
   *
   * A chunk is the main thread's if one of its files is: an entry's
   * main-thread file, or a file of a lazy chunk the main thread loads, which
   * the processAssets hook above marked at an earlier stage. This runs before
   * RuntimeWrapperWebpackPlugin's wrapping, at a later stage than that hook.
   */
  #markMainThreadHotUpdates(
    compilation: Compilation,
    mainThreadChunkSet: ReadonlySet<string>,
  ) {
    for (const chunk of compilation.chunks) {
      const files = [...chunk.files];
      if (
        !files.some(
          (file) =>
            mainThreadChunkSet.has(file) ||
            (!compilation.getAsset(file)?.info.hotModuleReplacement &&
              compilation.getAsset(file)?.info['lynx:main-thread']),
        )
      ) {
        continue;
      }
      for (const file of files) {
        if (
          file.endsWith('.js') &&
          compilation.getAsset(file)?.info.hotModuleReplacement
        ) {
          this.#updateMainThreadInfo(compilation, file);
        }
      }
    }
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

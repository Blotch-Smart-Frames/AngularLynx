// import type {
//   NormalizedEnvironmentConfig,
// } from "@rsbuild/core";

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LynxConfig } from '@lynx-js/rsbuild-plugin';
import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import { RuntimeWrapperWebpackPlugin } from '@lynx-js/runtime-wrapper-webpack-plugin';
import {
  CSSPlugins,
  LynxEncodePlugin,
  LynxTemplatePlugin,
  WebEncodePlugin,
} from '@lynx-js/template-webpack-plugin';
import type { UndefinedOnPartialDeep } from 'type-fest';
import { AngularWebpackPlugin } from './angular-webpack-plugin.js';
import type { BackgroundEntries } from './background-entry.js';
import { LAYERS } from './layers.js';
import type { NormalizedPluginAngularLynxOptions } from './utils/options.js';

/**
 * The key `pluginLynx` (the Lynx build engine, which Rspeedy registers) exposes
 * its resolved config under. Mirrors `S_LYNX_CONFIG` in React Lynx's plugin.
 */
export const S_LYNX_CONFIG = Symbol.for('@lynx-js/rsbuild-plugin:config');
const PLUGIN_NAME_TEMPLATE = 'lynx:template';
const PLUGIN_NAME_RUNTIME_WRAPPER = 'lynx:runtime-wrapper';
const PLUGIN_NAME_ANGULAR = 'lynx:angular';
const RULE_BACKGROUND_MODULES = 'lynx:background-modules';
const PLUGIN_NAME_CSS_HOT_UPDATE = 'lynx:css-hot-update';

/**
 * The `blur-view` rule that approximates iOS's blur materials on Android,
 * from variables the runtime sets (see the file). Only the native bundle gets
 * it: web draws the materials itself, in the element's shadow root, and an
 * app-level rule there would beat them. It goes before every other import, so
 * the app's own stylesheets come later and win a tie.
 */
export const BLUR_VIEW_STYLESHEET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './styles/blur-view.css',
);

/**
 * The hot update clients (see client/). The background one stands in for
 * `@rspack/core/hot/dev-server`; the main-thread one gives the main thread its
 * own hot updates. Together they apply each update on both threads, or reload.
 */
export const HMR_BACKGROUND_CLIENT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './client/hmr-background.js',
);
export const HMR_MAIN_THREAD_CLIENT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './client/hmr-main-thread.js',
);
/**
 * Applies stylesheet edits on the main thread, in place of css-extract's
 * `runtime/hotModuleReplacement.cjs` (see client/css-hot-update.ts).
 */
export const CSS_HOT_UPDATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './client/css-hot-update.cjs',
);
const CSS_EXTRACT_HOT_UPDATE =
  /css-extract-webpack-plugin[\\/]runtime[\\/]hotModuleReplacement\.cjs$/;

/**
 * The dev transport's `reloadApp` module, which the background client reloads
 * the page with. It's resolved from `@lynx-js/rsbuild-plugin`, which installs
 * the transport, so the client gets the copy Rspeedy itself injects.
 */
const resolveReloadApp = (): string =>
  createRequire(
    createRequire(import.meta.url).resolve('@lynx-js/rsbuild-plugin'),
  ).resolve('@lynx-js/webpack-dev-transport/reloadApp');

export const applyEntry = (
  api: RsbuildPluginAPI,
  options: NormalizedPluginAngularLynxOptions,
  backgroundEntries: BackgroundEntries,
  appEntries: Set<string>,
): void => {
  const {
    customCSSInheritanceList,
    debugInfoOutside,
    defaultDisplayLinear,
    defaultOverflowVisible,
    enableA11y,
    enableAccessibilityElement,
    enableCSSInheritance,
    enableCSSInvalidation,
    enableCSSSelector,
    enableNewGesture,
    enableRemoveCSSScope,
    removeDescendantSelectorScope,
    targetSdkVersion,
  } = options;

  api.modifyBundlerChain((chain, { environment, isDev, rspack }) => {
    // The bundle filename and the intermediate directory are owned by the Lynx
    // build engine since Rspeedy 0.17. Resolving them through it (rather than
    // reading `output.filename` and hardcoding the old `.rspeedy` directory)
    // keeps LynxTemplatePlugin in sync with where css-extract emits its
    // intermediate CSS (now `.lynx`), and supports function-form filenames.
    const lynxConfig = api.useExposed<LynxConfig>(S_LYNX_CONFIG);
    if (!lynxConfig) {
      throw new Error(
        'No Lynx config exposed. `pluginLynx` has to be applied for the Lynx build engine to be configured.',
      );
    }

    const isLynx = environment.name === 'lynx';
    const isWeb = environment.name === 'web';
    // Mirror React Lynx's HMR/live-reload flag logic (rspeedy/plugin-react/src/entry.ts).
    // HMR requires both the hot dev server and the transport client running before user code.
    // Live-reload only needs the transport client (it triggers a full page reload via CDP).
    const { hmr, liveReload } = environment.config.dev ?? {};
    const enabledHMR = isDev && !isWeb && hmr !== false;
    const enabledLiveReload = isDev && !isWeb && liveReload !== false;

    // Dual-thread entry splitting: each user entry (e.g. "main") becomes two
    // webpack entries with different layers:
    //   "main__main-thread" → layer "main", outputs main-thread.js (Lepus)
    //   "main"              → layer "background", outputs background-thread.js
    // The main thread runs the app, so its entry is the app's own. The
    // background thread runs no Angular, so its entry is a generated module
    // that imports only the runtime and the modules that define a background
    // function or a MainThreadRef (background-entry.ts). Both get the
    // `source.preEntry` polyfills. The layer determines each module's SWC
    // target (ES2019 vs ES2015), CSS handling and __MAIN_THREAD__ value
    // (layers.ts, css.ts). LynxTemplatePlugin combines them into a single
    // .lynx.bundle file.
    const entries = chain.entryPoints.entries() ?? {};
    chain.entryPoints.clear();
    const preEntry = new Set(environment.config.source.preEntry);
    const mainThreadChunks: string[] = [];
    for (const [entryName, entryPoint] of Object.entries(entries)) {
      const { imports: entryImports } = getChunks(
        entryName,
        entryPoint.values(),
      );
      // The app's CSS is extracted from the main-thread half (see css.ts), so
      // only that half needs the blur-view rule.
      const mainThreadImports = isLynx
        ? [BLUR_VIEW_STYLESHEET, ...entryImports]
        : entryImports;
      const backgroundImports = [
        ...entryImports.filter((entryImport) => preEntry.has(entryImport)),
        backgroundEntries.fileFor(environment.name, entryName),
      ];
      // The app's own entry modules, which take the hot updates nothing else
      // takes (see hot-updates.ts). Package imports such as polyfills aren't
      // the app's, so only paths count.
      for (const entryImport of entryImports) {
        if (entryImport.startsWith('.') || path.isAbsolute(entryImport)) {
          appEntries.add(path.resolve(api.context.rootPath, entryImport));
        }
      }

      const templateFilename = lynxConfig.resolveBundleFilename({
        entryName,
        platform: environment.name,
      });

      // Set only when `output.filename.bundle` is a function, which can name
      // lazy bundles per platform. Otherwise LynxTemplatePlugin keeps its
      // default name (under `lazy-bundle/`, with the compilation hash), as in
      // React Lynx.
      const lazyBundleFilename = lynxConfig.resolveLazyBundleFilename({
        platform: environment.name,
      });

      const mainThreadEntry = `${entryName}__main-thread`;
      const mainThreadName = path.posix.join(`${entryName}/main-thread.js`);
      const backgroundEntry = entryName;
      const backgroundThreadName = path.posix.join(
        `${entryName}/background-thread.js`,
      );

      mainThreadChunks.push(mainThreadName);
      chain
        .entry(mainThreadEntry)
        .add({
          layer: LAYERS.MAIN_THREAD,
          import: mainThreadImports,
          filename: mainThreadName,
        })
        .when(enabledHMR, (entry) => {
          // Before the app's code, so the main thread can take a hot update
          // as soon as the first one arrives.
          entry.prepend({
            layer: LAYERS.MAIN_THREAD,
            import: HMR_MAIN_THREAD_CLIENT,
          });
        })
        .end();

      chain
        .entry(backgroundEntry)
        .add({
          layer: LAYERS.BACKGROUND,
          import: backgroundImports,
          filename: backgroundThreadName,
        })
        .when(enabledHMR, (entry) => {
          // Use prepend so the webpack HMR runtime executes before user code.
          // Adding after user code (with .add()) would mean module.hot is not yet
          // installed when components first run, breaking hot update acceptance.
          //
          // It's this plugin's client rather than `@rspack/core/hot/dev-server`
          // (which Rspeedy aliases to Lynx's), which only updates the
          // background thread. The app runs on the main thread.
          entry.prepend({
            layer: LAYERS.BACKGROUND,
            import: HMR_BACKGROUND_CLIENT,
          });
        })
        .when(enabledHMR || enabledLiveReload, (entry) => {
          // Transport client connects to the rspeedy dev server WebSocket and either
          // triggers webpack's webpackHotUpdate event (HMR) or CDP Page.reload (live reload).
          // Must be prepended first so the connection is established before anything else runs.
          entry.prepend({
            layer: LAYERS.BACKGROUND,
            // This is aliased with hostname/port query params by rspeedy's dev plugin
            import: '@lynx-js/webpack-dev-transport/client',
          });
        })
        .end();
      // apply lynx plugins
      chain
        .plugin(`${PLUGIN_NAME_TEMPLATE}-${entryName}`)
        .use(LynxTemplatePlugin, [
          {
            filename: templateFilename,
            ...(lazyBundleFilename ? { lazyBundleFilename } : {}),
            intermediate: lynxConfig.resolveIntermediateDir({ entryName }),
            chunks: [mainThreadEntry, backgroundEntry],
            cssPlugins: [CSSPlugins.parserPlugins.removeFunctionWhiteSpace()],
            customCSSInheritanceList,
            debugInfoOutside,
            defaultDisplayLinear,
            defaultOverflowVisible,
            enableAccessibilityElement,
            enableCSSInheritance,
            enableCSSInvalidation,
            enableCSSSelector,
            enableNewGesture,
            enableRemoveCSSScope,
            removeDescendantSelectorScope,
            targetSdkVersion,
            enableA11y,
            // DO NOT pass experimental_isLazyBundle to LynxTemplatePlugin.
            // Setting it here would make the ROOT app a standalone lazy bundle
            // (appType: DynamicComponent), which crashes LynxExplorer with decode
            // error 10204. For a normal card app with lazy routes, the root must
            // remain appType: card. Only the async sub-bundles (generated by
            // LynxTemplatePlugin's #generateAsyncTemplate for each loadComponent
            // route) should be DynamicComponent type.
          },
        ])
        .end();
    }
    // The background entry imports its modules only for what they do when
    // they load, so a package or app that declares `"sideEffects": false`
    // would have them dropped. In the background layer they keep their side
    // effects; tree shaking inside them is unaffected.
    chain.module
      .rule(RULE_BACKGROUND_MODULES)
      .issuerLayer(LAYERS.BACKGROUND)
      .test((file: string) => backgroundEntries.isBackgroundModule(file))
      .sideEffects(true);
    if (enabledHMR) {
      chain.resolve.alias.set(
        '@lynx-js/webpack-dev-transport/reloadApp',
        resolveReloadApp(),
      );
      // Every CSS module css-extract generates calls this runtime when a hot
      // update replaces it. Its version updates the stylesheet from the
      // background thread, but the main thread takes the CSS modules' updates
      // (and the background thread may not have them at all).
      chain
        .plugin(PLUGIN_NAME_CSS_HOT_UPDATE)
        .use(rspack.NormalModuleReplacementPlugin, [
          CSS_EXTRACT_HOT_UPDATE,
          CSS_HOT_UPDATE,
        ])
        .end();
    }
    if (isLynx) {
      chain
        .plugin(PLUGIN_NAME_RUNTIME_WRAPPER)
        .use(RuntimeWrapperWebpackPlugin, [
          {
            // Rename the injected 'Component' variable to '__Component' to avoid
            // colliding with Angular's Component decorator import. The runtime
            // wrapper injects Lynx globals as local vars; 'Component' clashes
            // with `import { Component } from '@angular/core'`.
            injectVars(vars) {
              return vars.map((name) => {
                if (name === 'Component') {
                  return '__Component';
                }
                return name;
              });
            },
            targetSdkVersion,
            // Wrap all .js files EXCEPT main-thread bundles with Lynx's AMD runtime
            // (tt.define/tt.require pattern). Main-thread JS runs synchronously in
            // Lepus and cannot use AMD. Async chunks MUST be AMD-wrapped because
            // lynx.requireModuleAsync evaluates them via __init_card_bundle__({tt})
            // which calls tt.define(name, factory) — without AMD wrapping, the native
            // runtime cannot process the module and the callback never fires (hangs).
            test: /^(?!.*main-thread(?:\.[A-Fa-f0-9]*)?\.js$).*\.js$/,
          },
        ])
        .end();
      chain
        .plugin(`${LynxEncodePlugin.name}`)
        .use(LynxEncodePlugin, [{}])
        .end();
    }
    if (isWeb) {
      chain.plugin(`${WebEncodePlugin.name}`).use(WebEncodePlugin, []).end();
    }
    // AngularWebpackPlugin MUST run after LynxTemplatePlugin (.after()) because
    // it hooks into LynxTemplatePlugin's beforeEncode to inject module.exports
    // wrappers for DynamicComponent chunks. Running before would miss the hooks.
    chain
      .plugin(PLUGIN_NAME_ANGULAR)
      .after(PLUGIN_NAME_TEMPLATE)
      .use(AngularWebpackPlugin, [
        {
          mainThreadChunks,
          enableSSR: options.enableSSR,
          isWeb,
        },
      ]);
  });
};

/**
 * This is copied from https://github.com/web-infra-dev/rsbuild/blob/037da7b9d92e20c7136c8b2efa21eef539fa2f88/packages/core/src/plugins/html.ts#L168
 */
export const getChunks = (
  entryName: string,
  entryValue: (
    | string
    | string[]
    | UndefinedOnPartialDeep<Rspack.EntryDescription>
  )[],
): { chunks: string[]; imports: string[] } => {
  const chunks = [entryName];
  const imports: string[] = [];

  for (const item of entryValue) {
    if (typeof item === 'string') {
      imports.push(item);
      continue;
    }

    if (Array.isArray(item)) {
      imports.push(...imports);
      continue;
    }

    const { dependOn } = item;

    if (Array.isArray(item.import)) {
      imports.push(...item.import);
    } else {
      imports.push(item.import);
    }

    if (!dependOn) {
      continue;
    }

    if (typeof dependOn === 'string') {
      chunks.unshift(dependOn);
    } else {
      chunks.unshift(...dependOn);
    }
  }

  return { chunks, imports };
};

// function getBackgroundFilename(
//   entryName: string,
//   config: NormalizedEnvironmentConfig,
//   isProd: boolean
// ): string {
//   const { filename } = config.output;

//   if (typeof filename.js === "string") {
//     return filename.js
//       .replaceAll("[name]", entryName)
//       .replaceAll(".js", "/background.js");
//   } else {
//     return `${entryName}/background${getHash(config, isProd)}.js`;
//   }
// }

// function getHash(config: NormalizedEnvironmentConfig, isProd: boolean): string {
//   if (typeof config.output?.filenameHash === "string") {
//     return config.output.filenameHash
//       ? `.[${config.output.filenameHash}]`
//       : EMPTY_HASH;
//   } else if (config.output?.filenameHash === false) {
//     return EMPTY_HASH;
//   } else if (isProd) {
//     return DEFAULT_FILENAME_HASH;
//   } else {
//     return EMPTY_HASH;
//   }
// }

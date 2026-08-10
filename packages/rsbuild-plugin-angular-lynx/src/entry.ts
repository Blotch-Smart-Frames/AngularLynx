// import type {
//   NormalizedEnvironmentConfig,
// } from "@rsbuild/core";

import path from 'node:path';
import type { ExposedAPI, RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import { RuntimeWrapperWebpackPlugin } from '@lynx-js/runtime-wrapper-webpack-plugin';
import {
  CSSPlugins,
  LynxEncodePlugin,
  LynxTemplatePlugin,
  WebEncodePlugin,
} from '@lynx-js/template-webpack-plugin';
import type { UndefinedOnPartialDeep } from 'type-fest';
import { AngularWebpackPlugin } from './angular-webpack-plugin.js';
import { LAYERS } from './layers.js';
import type { PluginAngularLynxOptions } from './utils/options.js';

const DEFAULT_DIST_PATH_INTERMEDIATE = '.rspeedy';
const PLUGIN_NAME_TEMPLATE = 'lynx:template';
const PLUGIN_NAME_RUNTIME_WRAPPER = 'lynx:runtime-wrapper';
const PLUGIN_NAME_ANGULAR = 'lynx:angular';

export const applyEntry = (
  api: RsbuildPluginAPI,
  options: Required<PluginAngularLynxOptions>,
): void => {
  const {
    customCSSInheritanceList,
    debugInfoOutside,
    defaultDisplayLinear,
    enableAccessibilityElement,
    enableCSSInheritance,
    enableCSSInvalidation,
    enableCSSSelector,
    enableNewGesture,
    enableRemoveCSSScope,
    removeDescendantSelectorScope,
    targetSdkVersion,
  } = options;

  const exposed = api.useExposed<ExposedAPI>(Symbol.for('rspeedy.api'));
  if (!exposed) {
    throw new Error('Failed to get rspeedy API from useExposed');
  }
  const { config } = exposed;

  api.modifyBundlerChain((chain, { environment, isDev }) => {
    const isLynx = environment.name === 'lynx';
    const isWeb = environment.name === 'web';
    // Mirror React Lynx's HMR/live-reload flag logic (rspeedy/plugin-react/src/entry.ts).
    // HMR requires both the hot dev server and the transport client running before user code.
    // Live-reload only needs the transport client (it triggers a full page reload via CDP).
    const { hmr, liveReload } = environment.config.dev ?? {};
    const enabledHMR = isDev && !isWeb && hmr !== false;
    const enabledLiveReload = isDev && !isWeb && liveReload !== false;

    // Dual-thread entry splitting: each user entry (e.g. "main") is duplicated
    // into two webpack entries with different layers:
    //   "main__main-thread" → layer "main", outputs main-thread.js (Lepus)
    //   "main"              → layer "background", outputs background-thread.js
    // Both entries compile the SAME source files. The layer determines which
    // SWC target (ES2019 vs ES2015), CSS handling, and __MAIN_THREAD__ flag
    // each bundle gets. LynxTemplatePlugin combines them into a single
    // .lynx.bundle file.
    const entries = chain.entryPoints.entries() ?? {};
    chain.entryPoints.clear();
    const mainThreadChunks: string[] = [];
    for (const [entryName, entryPoint] of Object.entries(entries)) {
      const { imports } = getChunks(entryName, entryPoint.values());

      const templateFilename =
        (typeof config.output?.filename === 'object'
          ? (config.output.filename.bundle ?? config.output.filename.template)
          : config.output?.filename) ?? '[name].[platform].bundle';

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
          import: imports,
          filename: mainThreadName,
        })
        .end();

      chain
        .entry(backgroundEntry)
        .add({
          layer: LAYERS.BACKGROUND,
          import: imports,
          filename: backgroundThreadName,
        })
        .when(enabledHMR, (entry) => {
          // Use prepend so the webpack HMR runtime executes before user code.
          // Adding after user code (with .add()) would mean module.hot is not yet
          // installed when components first run, breaking hot update acceptance.
          entry.prepend({
            layer: LAYERS.BACKGROUND,
            // This is aliased to the correct path by rspeedy's dev plugin
            import: '@rspack/core/hot/dev-server',
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
            filename: templateFilename
              .replaceAll('[name]', entryName)
              .replaceAll('[platform]', environment.name),
            intermediate: path.posix.join(
              DEFAULT_DIST_PATH_INTERMEDIATE,
              entryName,
            ),
            chunks: [mainThreadEntry, backgroundEntry],
            cssPlugins: [CSSPlugins.parserPlugins.removeFunctionWhiteSpace()],
            customCSSInheritanceList,
            debugInfoOutside,
            defaultDisplayLinear,
            enableAccessibilityElement,
            enableCSSInheritance,
            enableCSSInvalidation,
            enableCSSSelector,
            enableNewGesture,
            enableRemoveCSSScope,
            removeDescendantSelectorScope,
            targetSdkVersion,
            enableA11y: true,
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

import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * Webpack layer names for the dual-thread build. Each entry is split into two
 * webpack entries with different layers (entry.ts), and every module an entry
 * reaches stays in its layer. The layer determines which SWC target (ES2015 vs
 * ES2019), which `__MAIN_THREAD__` value and which thread-specific
 * configuration (CSS extraction vs ignore, AMD wrapping vs plain) applies to
 * the module.
 */
export const LAYERS = {
  BACKGROUND: 'background',
  MAIN_THREAD: 'main',
};

export const applyLayers = (api: RsbuildPluginAPI): void => {
  api.modifyBundlerChain((chain) => {
    // No `experiments.layers` opt-in: Rspack 2 made layers a stable,
    // always-on feature and removed the experiment flag.

    // One branch per layer, matched by the layer of the module that imports
    // it (`issuerLayer`), so a module joins its importer's layer as React
    // Lynx's rules do. These branches used to *set* the layer (`layer()`),
    // and since the background branch came first and matched every file, the
    // main-thread entry's modules all landed in the background layer too: the
    // two bundles were built from the same modules, and nothing told them
    // apart at compile time.
    //
    // The Lynx bytecode generator requires ES2019 for main-thread and ES2015
    // for background. `__MAIN_THREAD__` is replaced with the layer's value, so
    // the minifier drops each `if (__MAIN_THREAD__)` branch from the other
    // thread's bundle. The bundles still set `globalThis.__MAIN_THREAD__`
    // (AngularWebpackPlugin), for code that reads it from `globalThis`.
    // `simplify: false` limits SWC's optimizer to that replacement; the
    // minifier removes the dead code.
    for (const [layer, target, isMainThread] of [
      [LAYERS.BACKGROUND, 'es2015', false],
      [LAYERS.MAIN_THREAD, 'es2019', true],
    ] as const) {
      chain.module
        .rule('typescript')
        .oneOf(layer)
        .issuerLayer(layer)
        .test(/\.[cm]?[jt]sx?$/)
        .use('builtin:swc-loader')
        .loader('builtin:swc-loader')
        .options({
          jsc: {
            target,
            parser: {
              syntax: 'typescript',
            },
            transform: {
              optimizer: {
                simplify: false,
                globals: {
                  vars: { __MAIN_THREAD__: String(isMainThread) },
                },
              },
            },
          },
        })
        .end();
    }
  });
};

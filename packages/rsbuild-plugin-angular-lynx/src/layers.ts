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

/**
 * A module in another package: the last `node_modules` in its path isn't
 * followed by `@blotch/`. The last, because pnpm keeps packages in
 * `node_modules/.pnpm/<name>@<version>/node_modules/<name>`.
 */
export const THIRD_PARTY =
  /[\\/]node_modules[\\/](?!@blotch[\\/])(?:(?![\\/]node_modules[\\/]).)*$/;

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
      const swcOptions = (privateFieldsAsProperties: boolean) => ({
        jsc: {
          target,
          ...(privateFieldsAsProperties && {
            assumptions: { privateFieldsAsProperties: true },
          }),
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
      });
      // The app's own code and AngularLynx's packages compile their
      // `#private` fields to properties. Below ES2022, SWC compiles a class's
      // `#private` fields to one WeakMap per field, keyed by the instance.
      // PrimJS, Lynx's main-thread engine, never collects an object that's
      // in a cycle through those WeakMaps while something in the cycle holds
      // a native element: two such objects that point at each other, or one
      // whose field points at itself, stay alive for good. The same cycle
      // through ordinary properties is collected, and so is one through the
      // WeakMaps with no native element in it (measured on the iOS Simulator
      // with Lynx 4.1, issue #237). Every LynxElement is in such a cycle,
      // with its parent (`#children` and `#jsParent`), so no element, nor
      // the native element and UI it holds, was ever freed; a component that
      // keeps an element in a `#field` can be caught the same way.
      // `privateFieldsAsProperties` compiles them to non-enumerable
      // properties instead, as Babel's assumption of that name does, which
      // PrimJS collects. Both threads, so a class compiles the same way on
      // either.
      chain.module
        .rule('typescript')
        .oneOf(layer)
        .issuerLayer(layer)
        .test(/\.[cm]?[jt]sx?$/)
        .exclude.add(THIRD_PARTY)
        .end()
        .use('builtin:swc-loader')
        .loader('builtin:swc-loader')
        .options(swcOptions(true))
        .end();
      // Other packages keep the standard compile, WeakMaps and all: SWC's
      // properties mode turns a `#field in object` check into a call on the
      // field's key, a string, which throws, and their code isn't ours to
      // keep clear of it.
      chain.module
        .rule('typescript')
        .oneOf(`${layer}-third-party`)
        .issuerLayer(layer)
        .test(/\.[cm]?[jt]sx?$/)
        .use('builtin:swc-loader')
        .loader('builtin:swc-loader')
        .options(swcOptions(false))
        .end();
    }
  });
};

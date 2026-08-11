import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';

/**
 * Webpack layer names for the dual-thread build. Each entry is duplicated
 * into two webpack entries with different layers — the layer determines which
 * SWC target (ES2015 vs ES2019) and which thread-specific configuration
 * (CSS extraction vs ignore, AMD wrapping vs plain) applies to the module.
 */
export const LAYERS = {
  BACKGROUND: 'background',
  MAIN_THREAD: 'main',
};

export const applyLayers = (api: RsbuildPluginAPI): void => {
  api.modifyBundlerChain((chain) => {
    const experiments = chain.get(
      'experiments',
    ) as Rspack.Configuration['experiments'];

    chain.experiments({
      ...experiments,
      layers: true,
    });

    // SWC target differentiation per layer. The Lynx bytecode generator
    // requires ES2019 for main-thread and ES2015 for background.
    // Note: __MAIN_THREAD__ injection is handled by AngularWebpackPlugin
    // in processAssets — the loader-based approach was unreliable.
    chain.module
      .rule('typescript')
      .oneOf(LAYERS.BACKGROUND)
      .layer(LAYERS.BACKGROUND)
      .test(/\.[cm]?[jt]sx?$/)
      .use('builtin:swc-loader')
      .loader('builtin:swc-loader')
      .options({
        jsc: {
          target: 'es2015',
          parser: {
            syntax: 'typescript',
          },
        },
      })
      .end();

    chain.module
      .rule('typescript')
      .oneOf(LAYERS.MAIN_THREAD)
      .layer(LAYERS.MAIN_THREAD)
      .test(/\.[cm]?[jt]sx?$/)
      .use('builtin:swc-loader')
      .loader('builtin:swc-loader')
      .options({
        jsc: {
          target: 'es2019',
          parser: {
            syntax: 'typescript',
          },
        },
      })
      .end();
  });
};

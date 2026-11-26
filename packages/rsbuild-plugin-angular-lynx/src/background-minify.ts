import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { SwcJsMinimizerRspackPluginOptions } from '@rspack/core';

/** An entry's background script, as entry.ts names it. */
export const BACKGROUND_SCRIPT = /(?:^|\/)background-thread\.js$/;

/**
 * How many times the minifier goes over a background script. Ten reached the
 * smallest script for hello-world: more made no difference (issue #710).
 */
export const BACKGROUND_COMPRESS_PASSES = 10;

type MinimizerOptions = SwcJsMinimizerRspackPluginOptions;

/**
 * Minifies each background script with more compress passes than the rest
 * of the build.
 *
 * The background thread runs only the runtime's bridges, so nearly all of
 * the runtime the bundle holds goes unused there (see pure-initializers.ts and
 * pure-classes.ts). The runtime is a single module, so the minifier is what
 * drops it, and it drops a declaration only when nothing reads it any more as
 * it goes. One pass leaves every declaration that something later in the
 * script read, even once that reader has gone: the runtime's LynxCanvasBase
 * stayed for LynxDetachedCanvas and LynxOffscreenCanvas, which come after it
 * and went in the same pass, and with it the canvas surface and both
 * rendering contexts, about 100 kB of hello-world's background script. Each
 * pass takes off another layer of those, and ten took hello-world's from
 * 198 kB to 92 kB. The main-thread script uses most of what it holds, so it
 * keeps rsbuild's options and its build time.
 *
 * Each of rsbuild's JavaScript minimizers is left to the other files, and a
 * copy of it with the passes takes the background scripts.
 *
 * @param api - The plugin API.
 */
export const applyBackgroundMinify = (api: RsbuildPluginAPI): void => {
  api.modifyBundlerChain({
    // After rsbuild's own minimizers are registered (its `rsbuild:minimize`
    // plugin), and after any an app's config adds.
    order: 'post',
    handler: (chain, { CHAIN_ID, rspack }) => {
      const minimizers = chain.optimization.minimizers;
      for (const id of Object.keys(minimizers.entries() ?? {})) {
        if (
          id !== CHAIN_ID.MINIMIZER.JS &&
          !id.startsWith(`${CHAIN_ID.MINIMIZER.JS}-`)
        ) {
          continue;
        }
        const minimizer = chain.optimization.minimizer(id);
        const [options = {}] = (minimizer.get('args') ?? []) as [
          MinimizerOptions?,
        ];
        // A minimizer an app's config gave files of its own is left as it
        // is: which of those are background scripts is the app's to say. So
        // is one it replaced with another tool (Terser, esbuild), whose
        // options this can't copy and whose work an SWC copy wouldn't do.
        if (
          minimizer.get('plugin') !== rspack.SwcJsMinimizerRspackPlugin ||
          options.test !== undefined
        ) {
          continue;
        }
        minimizer.tap(() => [
          {
            ...options,
            exclude: [...listOf(options.exclude), BACKGROUND_SCRIPT],
          },
        ]);
        chain.optimization
          .minimizer(`${id}-background`)
          .use(rspack.SwcJsMinimizerRspackPlugin, [withPasses(options)]);
      }
    },
  });
};

/**
 * The minimizer's options for the background scripts: the same, for only
 * those files, with {@link BACKGROUND_COMPRESS_PASSES} unless they ask for
 * more.
 */
const withPasses = (options: MinimizerOptions): MinimizerOptions => {
  const compress = options.minimizerOptions?.compress;
  const passes = (typeof compress === 'object' && compress.passes) || 0;
  return {
    ...options,
    test: BACKGROUND_SCRIPT,
    minimizerOptions: {
      ...options.minimizerOptions,
      // `false` turns compression off, and passes with it.
      compress:
        compress === false
          ? false
          : {
              ...(typeof compress === 'object' ? compress : {}),
              passes: Math.max(BACKGROUND_COMPRESS_PASSES, passes),
            },
    },
  };
};

type AssetConditions = NonNullable<MinimizerOptions['exclude']>;

const listOf = (value: AssetConditions | undefined): (string | RegExp)[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

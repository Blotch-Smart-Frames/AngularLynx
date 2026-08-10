import type { Rspack } from '@rsbuild/core';

/**
 * Prepends `globalThis["__MAIN_THREAD__"]=<value>;` to every module in the layer.
 * Replaces the BannerPlugin approach — injections happen per-module during
 * compilation instead of per-chunk after bundling.
 */
const threadGlobalsLoader = function (
  this: Rspack.LoaderContext,
  source: string,
): string {
  const options = this.getOptions() as { isMainThread: boolean };
  return `globalThis["__MAIN_THREAD__"]=${options.isMainThread};\n${source}`;
};

export default threadGlobalsLoader;

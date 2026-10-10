import type { RsbuildPlugin } from '@lynx-js/rspeedy';
import { applyAngularRules } from './angular.js';
import { applyCSS } from './css.js';
import { applyEntry } from './entry.js';
import { applyGenerator } from './generator.js';
import { applyLayers } from './layers.js';
import { applyDevLogger } from './logger/dev-logger.js';
import { applySplitChunksRule } from './split-chunks.js';
import { applyTailwind } from './tailwind.js';
import {
  normalizeOptions,
  type PluginAngularLynxOptions,
} from './utils/options.js';

export const pluginAngularLynx = (
  options?: PluginAngularLynxOptions,
): RsbuildPlugin => {
  return {
    name: 'lynx:angular',
    pre: ['lynx:rsbuild:plugin-api'],
    setup: async (api) => {
      const normalizedOptions = normalizeOptions(options);
      applyCSS(api, normalizedOptions);
      applyTailwind(api);
      applyEntry(api, normalizedOptions);
      applyLayers(api);
      // applyAngularRules reads angular.json asynchronously and only then
      // registers its hooks (including the modifyRsbuildConfig that adds
      // polyfills, $localize init and global styles to `source.preEntry`).
      // Rsbuild awaits an async `setup` before applying modifyRsbuildConfig, so
      // the promise must be awaited — otherwise the hooks register too late and
      // are silently skipped. Rsbuild 1 happened to win this race; Rsbuild 2
      // (rspeedy 0.15+) does not, which dropped every global stylesheet.
      // It is started here and awaited last so the synchronous registrations
      // below keep their existing order.
      const angularRules = applyAngularRules(api, normalizedOptions);
      applyGenerator(api);
      applySplitChunksRule(api, normalizedOptions);
      applyDevLogger(api);
      await angularRules;
    },
  };
};

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
    setup: (api) => {
      const normalizedOptions = normalizeOptions(options);
      applyCSS(api, normalizedOptions);
      applyTailwind(api);
      applyEntry(api, normalizedOptions);
      applyLayers(api);
      applyAngularRules(api, normalizedOptions);
      applyGenerator(api);
      applySplitChunksRule(api, normalizedOptions);
      applyDevLogger(api);
    },
  };
};

import type { RsbuildPlugin } from '@lynx-js/rspeedy';
import { ANGULAR_CLI_CONTEXT_PLUGIN_NAME } from './angular-cli-context.js';
import { applyAngularRules } from './angular.js';
import { createBackgroundEntries } from './background-entry.js';
import { applyCSS } from './css.js';
import { applyEntry } from './entry.js';
import { applyGenerator } from './generator.js';
import { applyLayers } from './layers.js';
import { applyResolve } from './resolve.js';
import { applyDevLogger } from './logger/dev-logger.js';
import { applySplitChunksRule } from './split-chunks.js';
import { applyTailwind } from './tailwind.js';
import {
  deprecatedOptionsIn,
  normalizeOptions,
  type PluginAngularLynxOptions,
} from './utils/options.js';

export const pluginAngularLynx = (
  options?: PluginAngularLynxOptions,
): RsbuildPlugin => {
  return {
    name: 'lynx:angular',
    // The Angular CLI context plugin is only there under `ng build` /
    // `ng serve`; Rsbuild ignores a `pre` entry that isn't registered.
    pre: ['lynx:rsbuild:plugin-api', ANGULAR_CLI_CONTEXT_PLUGIN_NAME],
    setup: async (api) => {
      for (const name of deprecatedOptionsIn(options)) {
        api.logger.warn(
          `pluginAngularLynx(): the \`${name}\` option has no effect and will be removed in a future release. Remove it from your config.`,
        );
      }
      const normalizedOptions = normalizeOptions(options);
      // Shared by entry.ts, which points each background entry at a generated
      // file, and angular.ts, which writes the files after each Angular compile.
      const backgroundEntries = createBackgroundEntries({
        rootPath: api.context.rootPath,
      });
      applyCSS(api, normalizedOptions);
      applyTailwind(api);
      // The app's entry modules, which entry.ts finds and the Angular
      // transform makes take hot updates (see hot-updates.ts).
      const appEntries = new Set<string>();
      applyEntry(api, normalizedOptions, backgroundEntries, appEntries);
      applyLayers(api);
      applyResolve(api);
      // applyAngularRules reads angular.json asynchronously and only then
      // registers its hooks (including the modifyRsbuildConfig that adds
      // polyfills, $localize init and global styles to `source.preEntry`).
      // Rsbuild awaits an async `setup` before applying modifyRsbuildConfig, so
      // the promise must be awaited — otherwise the hooks register too late and
      // are silently skipped. Rsbuild 1 happened to win this race; Rsbuild 2
      // (rspeedy 0.15+) does not, which dropped every global stylesheet.
      // It is started here and awaited last so the synchronous registrations
      // below keep their existing order.
      const angularRules = applyAngularRules(
        api,
        normalizedOptions,
        backgroundEntries,
        appEntries,
      );
      applyGenerator(api);
      applySplitChunksRule(api, normalizedOptions);
      applyDevLogger(api);
      await angularRules;
    },
  };
};

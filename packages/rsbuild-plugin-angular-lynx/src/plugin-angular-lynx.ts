import type { RsbuildPlugin } from '@lynx-js/rspeedy';
import { ANGULAR_CLI_CONTEXT_PLUGIN_NAME } from './angular-cli-context.js';
import { applyAngularRules } from './angular.js';
import { createBackgroundEntries } from './background-entry.js';
import { applyCSS } from './css.js';
import { applyDisplay } from './display.js';
import { applyEntry } from './entry.js';
import { applyGenerator } from './generator.js';
import { applyLayers } from './layers.js';
import { applyNestedCalc } from './nested-calc.js';
import { applyResolve } from './resolve.js';
import { applySafeArea } from './safe-area.js';
import { applyDevLogger } from './logger/dev-logger.js';
import { applySplitChunksRule } from './split-chunks.js';
import { applyStrictEsm } from './strict-esm.js';
import { applyTailwind } from './tailwind.js';
import { applyTextInheritance } from './text-inheritance.js';
import { applyTypeSelectors } from './type-selectors.js';
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
      // After Tailwind, so it also sees the rules Tailwind writes.
      applyTypeSelectors(api);
      // Its PostCSS plugin visits declarations, which PostCSS does after
      // Tailwind writes them and before Tailwind 4's lowering at OnceExit,
      // wherever the plugin is in the list (see display.ts).
      applyDisplay(api);
      // The same: each env(safe-area-inset-*) reads the inset a generated
      // app's shell sends (see safe-area.ts).
      applySafeArea(api);
      // Writes each calc() nested in another as parentheses, which Lynx reads
      // (see nested-calc.ts). After applyTailwind, so it runs after Tailwind
      // 4's lowering at OnceExit.
      applyNestedCalc(api);
      // Copies each inheritable text style to a variable the HTML text tags
      // read (see text-inheritance.ts). After applyTailwind, so it runs after
      // Tailwind 4's lowering at OnceExit.
      applyTextInheritance(api);
      // The app's entry modules, which entry.ts finds and the Angular
      // transform makes take hot updates (see hot-updates.ts).
      const appEntries = new Set<string>();
      applyEntry(api, normalizedOptions, backgroundEntries, appEntries);
      applyLayers(api);
      applyResolve(api);
      applyStrictEsm(api);
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

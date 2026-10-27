import { createRequire } from 'node:module';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import { tailwindForLynx } from './tailwind-v4/index.js';
import { findUp } from './utils/angular/find-up.js';

const TAILWIND_CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

/**
 * Whether a PostCSS plugin is Tailwind 3, in either form a `postcss.config.js`
 * can list it: called (`tailwindcss({})`, which the object syntax produces) or
 * not (`tailwindcss`).
 */
const isTailwind = (plugin: unknown): boolean =>
  typeof plugin === 'function'
    ? plugin.name === 'tailwindcss'
    : (plugin as { postcssPlugin?: unknown } | null)?.postcssPlugin ===
      'tailwindcss';

/**
 * Whether a PostCSS plugin is Tailwind 4's, `@tailwindcss/postcss`.
 */
const isTailwind4 = (plugin: unknown): boolean =>
  (plugin as { postcssPlugin?: unknown } | null)?.postcssPlugin ===
  '@tailwindcss/postcss';

/**
 * Sets Tailwind CSS up for the app, either version:
 *
 * - **Tailwind 3** runs when the app has a `tailwind.config.*`, the way
 *   Angular CLI sets it up. Its config uses `@lynx-js/tailwind-preset`.
 * - **Tailwind 4** runs when the app's PostCSS config lists
 *   `@tailwindcss/postcss` (`.postcssrc.json`, which `ng add` writes as
 *   Angular CLI's own Tailwind setup does). Rsbuild loads that config itself.
 *
 * Either way, a PostCSS plugin added after Tailwind rewrites the CSS
 * Tailwind 4 writes into CSS Lynx reads (see tailwind-v4/index.ts). It only
 * touches the stylesheets Tailwind 4 compiled, so it adds nothing to a
 * Tailwind 3 build or a build without Tailwind.
 */
export const applyTailwind = (api: RsbuildPluginAPI): void => {
  // Auto-detect tailwind.config.* by walking up from cwd — the same strategy
  // Angular CLI uses for Tailwind 3.
  const configFile = findUp(TAILWIND_CONFIG_FILES, process.cwd());
  // Warned about once, though Rsbuild asks for the PostCSS options once per
  // environment.
  let warned = false;

  // Tailwind runs as a PostCSS plugin and generates the classes it finds in
  // the files its `content` globs match, as in Lynx's Tailwind guide and
  // Angular CLI's own Tailwind support. That takes in `.html` templates, which
  // Angular's compiler reads and the bundle never imports: the plugin used
  // before (rsbuild-plugin-tailwindcss) scanned the bundle's modules in place
  // of `content`, so it never saw them. Tailwind also reports the folders it
  // scans, so rspack rebuilds the CSS when a template changes under `ng serve`.
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: ({ postcssOptions }, { addPlugins }) => {
          const configured =
            typeof postcssOptions === 'object'
              ? (postcssOptions.plugins ?? [])
              : [];
          // An app that also set Tailwind up in a postcss.config.js, as Lynx's
          // guide does, keeps its own: a second Tailwind would only run again.
          if (configFile && !configured.some(isTailwind)) {
            // Resolved from the app, which installs Tailwind; this package
            // doesn't depend on it, so apps without Tailwind don't install it.
            const require = createRequire(configFile);
            const { version } = require('tailwindcss/package.json') as {
              version: string;
            };
            if (Number.parseInt(version, 10) < 4) {
              const tailwindcss = require('tailwindcss') as (options: {
                config: string;
              }) => unknown;
              addPlugins(tailwindcss({ config: configFile }));
            } else if (!configured.some(isTailwind4) && !warned) {
              // Tailwind 4 isn't a PostCSS plugin itself, and only reads a
              // JavaScript config through `@config` in a stylesheet.
              warned = true;
              api.logger.warn(
                `Found ${configFile}, but Tailwind CSS ${version} is installed, which doesn't run from a Tailwind config file. List @tailwindcss/postcss in a .postcssrc.json, or run \`ng generate @blotch/angular-lynx:add-tailwind\`.`,
              );
            }
          }
          // Added last, so it runs after Tailwind 4 wherever the PostCSS
          // config lists it.
          addPlugins(tailwindForLynx());
        },
      },
    }),
  );
};

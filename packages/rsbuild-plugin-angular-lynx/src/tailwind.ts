import { createRequire } from 'node:module';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import { findUp } from './utils/angular/find-up.js';

const TAILWIND_CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

/**
 * Whether a PostCSS plugin is Tailwind, in either form a `postcss.config.js`
 * can list it: called (`tailwindcss({})`, which the object syntax produces) or
 * not (`tailwindcss`).
 */
const isTailwind = (plugin: unknown): boolean =>
  typeof plugin === 'function'
    ? plugin.name === 'tailwindcss'
    : (plugin as { postcssPlugin?: unknown } | null)?.postcssPlugin ===
      'tailwindcss';

export const applyTailwind = (api: RsbuildPluginAPI): void => {
  // Auto-detect tailwind.config.* by walking up from cwd — the same strategy
  // Angular CLI uses. If no config is found, Tailwind is not activated and
  // this function has zero effect on the build.
  const configFile = findUp(TAILWIND_CONFIG_FILES, process.cwd());
  if (!configFile) return;

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
          // An app that also set Tailwind up in a postcss.config.js, as Lynx's
          // guide does, keeps its own: a second Tailwind would only run again.
          if (
            typeof postcssOptions === 'object' &&
            postcssOptions.plugins?.some(isTailwind)
          ) {
            return;
          }
          // Resolved from the app, which installs Tailwind; this package
          // doesn't depend on it, so apps without Tailwind don't install it.
          const tailwindcss = createRequire(configFile)('tailwindcss');
          addPlugins(tailwindcss({ config: configFile }));
        },
      },
    }),
  );
};

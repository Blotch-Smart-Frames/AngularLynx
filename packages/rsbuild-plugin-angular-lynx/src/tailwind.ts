import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss';
import { findUp } from './utils/angular/find-up.js';

const TAILWIND_CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

export const applyTailwind = (api: RsbuildPluginAPI): void => {
  // Auto-detect tailwind.config.* by walking up from cwd — the same strategy
  // Angular CLI uses. If no config is found, Tailwind is not activated and
  // this function has zero effect on the build.
  const configFile = findUp(TAILWIND_CONFIG_FILES, process.cwd());
  if (!configFile) return;

  // Delegate to rsbuild-plugin-tailwindcss with the detected config path.
  // Calling .setup(api) directly is valid — both plugins share the same
  // RsbuildPluginAPI instance and register hooks identically to a top-level plugin.
  pluginTailwindCSS({
    config: configFile,
    // Prevent Tailwind from scanning or transforming CSS in node_modules.
    exclude: [/[\\/]node_modules[\\/]/],
  }).setup(api);
};

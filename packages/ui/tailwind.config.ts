import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';
import { blotchPlugin } from './src/lib/theme/tailwind-plugin';

// This package has no Tailwind build step of its own — components are plain
// `.ts` files propagated to the examples by dolan. This config exists purely so
// oxfmt's Tailwind class sorter (`sortTailwindcss` in the root .oxfmtrc.json)
// resolves the SAME preset + plugin here that the examples resolve from their
// own tailwind.config.ts. Without it, oxfmt falls back to stock Tailwind's class
// order here while the examples sort with the preset order, so every
// `dolan:update:force` re-introduces a spurious class-order diff between this
// source-of-truth and its propagated copies. Keeping the config identical to the
// examples' makes the sort order match and the drift disappears.
const config: Config = {
  content: ['./src/**/*.ts'],
  presets: [preset],
  plugins: [blotchPlugin],
};

export default config;

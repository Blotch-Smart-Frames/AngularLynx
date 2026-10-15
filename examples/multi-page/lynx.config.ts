import { defineConfig } from '@blotch/angular-lynx-build';

export default defineConfig({
  // Multi-page via source.entry: each key becomes a separate .lynx.bundle.
  // Without it, `ng build` and `ng serve` would build only the build
  // target's `browser` entry.
  source: {
    entry: {
      main: './src/main.ts',
      settings: './src/pages/settings/main.ts',
    },
  },
});

import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {},
    lynx: {},
  },
  // Multi-page via source.entry: each key becomes a separate .lynx.bundle.
  source: {
    entry: {
      main: './src/main.ts',
      settings: './src/pages/settings/main.ts',
    },
  },
});

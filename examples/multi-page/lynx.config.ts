import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {
      output: { cleanDistPath: false },
    },
    lynx: {},
  },
  // Multi-page via source.entry: each key becomes a separate .lynx.bundle.
  source: {
    entry: {
      main: './src/main.ts',
      settings: './src/pages/settings/main.ts',
    },
  },
  plugins: [pluginAngularLynx()],
});

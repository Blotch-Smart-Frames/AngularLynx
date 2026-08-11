import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {
      output: { cleanDistPath: false },
    },
    lynx: {},
  },
  source: {
    entry: './src/main.ts',
  },
  plugins: [pluginAngularLynx({ enableSSR: true })],
});

import { pluginAngularLynx } from '@blotch/angular-lynx-build';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {},
    lynx: {},
  },
  source: {
    entry: './src/main.ts',
  },
  // Listed only to pass options; `ng build` and `ng serve` use this instance
  // instead of adding their own.
  plugins: [pluginAngularLynx({ enableSSR: true })],
});

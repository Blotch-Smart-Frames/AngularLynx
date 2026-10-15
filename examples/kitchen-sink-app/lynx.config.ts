import { pluginAngularLynx } from '@blotch/angular-lynx-build';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  // Build for both targets: `lynx` produces the native bundle, `web` the browser
  // preview bundle.
  environments: {
    web: {},
    lynx: {},
  },
  source: {
    entry: './src/main.ts',
  },
  plugins: [
    pluginQRCode({
      schema(url) {
        // We use `?fullscreen=true` to open the page in LynxExplorer in full screen mode
        return `${url}?fullscreen=true`;
      },
    }),
    // Listed only to pass options; `ng build` and `ng serve` use this
    // instance instead of adding their own.
    pluginAngularLynx({ enableSSR: true }),
  ],
});

import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  // Build for both targets: `lynx` produces the native bundle, `web` the browser
  // preview bundle. `cleanDistPath: false` on web keeps the lynx bundle in place
  // when the two builds run sequentially (see the dual-environment build script).
  environments: {
    web: {
      output: { cleanDistPath: false },
    },
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
    pluginAngularLynx({ enableSSR: true }),
  ],
});

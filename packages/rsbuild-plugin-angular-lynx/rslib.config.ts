import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2022',
      dts: true,
      // The package is ESM, so under `node16`/`nodenext` module resolution
      // TypeScript requires relative imports in the emitted .d.ts files to
      // carry their `.js` extension. Without it, a lynx.config.ts
      // type-checked with that resolution loses the plugin's types (found by
      // @arethetypeswrong/cli in the E2E package checks).
      redirect: { dts: { extension: true } },
    },
  ],
  source: {
    entry: {
      'loaders/ignore-css-loader': './src/loaders/ignore-css-loader.ts',
      'loaders/thread-globals-loader': './src/loaders/thread-globals-loader.ts',
      polyfills: './src/polyfills.js',
      index: './src/index.ts',
    },
  },
  output: {
    // typescript must not be bundled into the ESM output — TypeScript's CJS code
    // uses __filename which is unavailable in ES module scope. It is loaded at
    // runtime from the installed package instead.
    externals: { typescript: 'typescript' },
    // Stylesheets the plugin adds to apps' bundles, copied as they are: they
    // go through the app's own CSS pipeline, not this library's.
    copy: [{ from: './src/styles', to: 'styles' }],
  },
});

import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2022',
      dts: true,
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
  },
});

import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {},
    lynx: {},
  },
  source: {
    entry: './src/main.ts',
  },
});

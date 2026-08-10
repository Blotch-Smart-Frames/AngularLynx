import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const copyUiPlugin = (): Plugin => {
  return {
    name: 'copy-ui',
    configResolved() {
      cpSync(
        resolve(__dirname, '../ui/src/lib'),
        resolve(__dirname, 'dist/ui'),
        {
          recursive: true,
        },
      );
    },
  };
};

export default defineConfig({
  plugins: [copyUiPlugin()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: [],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

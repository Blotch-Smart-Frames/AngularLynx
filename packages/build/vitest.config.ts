import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The builders compile next to their sources and import each other
    // without extensions (they're CommonJS). Vite tries `.js` before `.ts`,
    // so after a build the tests would run the compiled output, stale as
    // soon as a source changes.
    extensions: ['.ts', '.js', '.json'],
  },
  test: {
    include: ['builders/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['builders/**/*.ts', 'src/**/*.ts'],
      exclude: ['**/*.test.ts', 'builders/**/schema.ts', 'src/index.ts'],
    },
  },
});

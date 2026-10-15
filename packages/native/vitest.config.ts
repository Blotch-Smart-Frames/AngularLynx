import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // scripts/ holds maintainer tools (the iOS project generator), tested but
    // not shipped.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['scripts/render-template-project.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});

import { defineConfig } from 'vitest/config';

import { iosTemplateProject } from './scripts/generate-ios-project.ts';

export default defineConfig({
  // Renders templates/ios/App.xcodeproj for both `vite build` and Vitest.
  plugins: [iosTemplateProject()],
  build: {
    // tsc has already written dist/. This build only runs the plugins, so it
    // outputs no format and must not empty dist/.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: [],
    },
  },
  test: {
    // scripts/ holds maintainer tools (the iOS project generator), tested but
    // not shipped.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});

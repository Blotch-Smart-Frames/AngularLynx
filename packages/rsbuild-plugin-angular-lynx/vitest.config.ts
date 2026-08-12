import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: false,
    __PROFILE__: false,
    __ENABLE_SSR__: false,
  },
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/*.types.ts',
        'src/index.ts', // 1-line public re-export barrel
        // Integration-only wrapper around `@angular/build` internals
        // (`createAngularCompilation`, `JavaScriptTransformer`) and `@lynx-js/rspeedy`
        // plugin API hooks. Its side effects (worker pool, tsconfig read, fs
        // scoped-css cache) are only meaningful inside a live rspeedy build; a
        // faithful in-process test would only exercise the mock. The individual
        // pure helpers it composes (build-schema-source-file-cache, component-
        // styles-cache, lynx-diagnostics, transform-module, worklet-transform,
        // utils/angular/*) are all covered.
        'src/angular.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

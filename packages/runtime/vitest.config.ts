import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8 uses OXC (not esbuild) as the TypeScript transformer. Without this,
  // Angular's @Injectable / @Directive / @Component decorators trigger
  // "SyntaxError: Invalid or unexpected token" at module parse time in Node.js,
  // which doesn't support decorator syntax natively.
  //
  // Angular still uses legacy TypeScript decorators (pre-TC39 stage 3 spec),
  // so OXC must be told to emit the legacy decorator transform rather than
  // the standard TC39 decorator output.
  oxc: {
    decorator: {
      legacy: true,
    },
  },
  define: {
    __DEV__: false,
    __PROFILE__: false,
    __ENABLE_SSR__: false,
    __WEB__: false,
  },
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      // V8 is the built-in provider (@vitest/coverage-v8, installed at the repo
      // root). `all` defaults to true when `include` is set, so EVERY source
      // file is instrumented even if no spec imports it — that is what makes the
      // 100% gate meaningful rather than "100% of whatever happened to run".
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'], // text=local, html=browse, lcov=Codecov
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/*.types.ts',
        'src/lib/types/**', // ambient global Lynx API type declarations, no runtime code
        'src/lib/testing/**', // fake-native-global.ts is a test-only helper, never shipped
        'src/public-api.ts', // pure re-export barrel
      ],
    },
  },
});

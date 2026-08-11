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
  },
});

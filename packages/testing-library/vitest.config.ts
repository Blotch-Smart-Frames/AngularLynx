import { defineConfig } from 'vitest/config';
import path from 'node:path';

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
    // Angular compiler checks __DEV__ in some paths; match what the plugin sets.
    __DEV__: JSON.stringify(true),
    // AngularLynx runs on the main thread in tests: LynxDocument uses PAPI.
    __MAIN_THREAD__: JSON.stringify(true),
    // These specs alias @blotch/angular-lynx to the runtime SOURCE (see the
    // alias below), so they load runtime.ts directly — which references the same
    // compile-time defines the rsbuild plugin injects at build time. The bundler
    // normally replaces them; here Vitest must, or module load throws
    // "ReferenceError: __WEB__ is not defined". Keep this set in sync with the
    // runtime package's own vitest.config.ts. We emulate the native main thread,
    // so all three are false (not web, no profiling, no SSR).
    __WEB__: JSON.stringify(false),
    __PROFILE__: JSON.stringify(false),
    __ENABLE_SSR__: JSON.stringify(false),
  },
  test: {
    // jsdom provides the DOM APIs Angular platform-browser expects.
    // LynxTestingEnv is installed on top of jsdom in src/setup.ts.
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(import.meta.dirname, 'src/setup.ts')],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // `include` is package-relative, so the runtime source pulled in via the
      // `@blotch/angular-lynx` alias below (which lives outside this src/) is not
      // counted here — coverage stays scoped to the testing-library's own files.
      // index.ts (auto-cleanup) and setup.ts are real code covered by their own
      // specs, so they are deliberately NOT excluded.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
    onConsoleLog(log) {
      if (log.includes('Angular is running in development mode')) return false;
    },
    alias: [
      {
        find: '@blotch/angular-lynx',
        replacement: path.resolve(
          import.meta.dirname,
          '../runtime/src/public-api.ts',
        ),
      },
    ],
  },
});

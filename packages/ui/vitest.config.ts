import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  define: {
    // Specs alias @blotch/angular-lynx to the runtime SOURCE (see alias below),
    // so they load runtime.ts, which references the compile-time defines the
    // rsbuild plugin normally injects. Vitest must define them here too or module
    // load throws "ReferenceError: __WEB__ is not defined". Keep in sync with
    // examples/kitchen-sink-app/vitest.config.ts. Tests emulate the native main
    // thread: not web, no profiling, no SSR.
    __DEV__: JSON.stringify(true),
    __MAIN_THREAD__: JSON.stringify(true),
    __WEB__: JSON.stringify(false),
    __PROFILE__: JSON.stringify(false),
    __ENABLE_SSR__: JSON.stringify(false),
  },
  // Vite 8 switched from esbuild to OXC as the TypeScript transformer. Angular's
  // @Component / @Directive / @Injectable decorators need the legacy decorator
  // transform so Angular's JIT compiler can read the metadata at runtime.
  oxc: {
    decorator: {
      legacy: true,
    },
  },
  test: {
    // render() drives components through Angular's JIT pipeline against JSDOM,
    // so component specs need the browser-like environment and the
    // testing-library setup (PAPI polyfills + main-thread switch).
    environment: 'jsdom',
    setupFiles: [
      path.resolve(
        import.meta.dirname,
        '../testing-library/src/setup.ts',
      ),
    ],
    include: ['src/**/*.test.ts'],
    alias: [
      // The aliases resolve @blotch/* imports to package SOURCE (not built dist),
      // so no build step is needed to run these specs.
      {
        find: '@blotch/angular-lynx-testing-library',
        replacement: path.resolve(
          import.meta.dirname,
          '../testing-library/src/index.ts',
        ),
      },
      {
        find: '@blotch/angular-lynx',
        replacement: path.resolve(
          import.meta.dirname,
          '../runtime/src/public-api.ts',
        ),
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/**/index.ts', // per-component re-export barrels
        'src/test-utils/**', // test-only fixture helpers
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

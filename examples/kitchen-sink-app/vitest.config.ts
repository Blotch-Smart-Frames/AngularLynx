import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  define: {
    __DEV__: JSON.stringify(true),
    __MAIN_THREAD__: JSON.stringify(true),
  },
  // Vite 8 switched from esbuild to OXC as the TypeScript transformer. Angular's
  // @Component / @Directive / @Injectable decorators need the legacy decorator
  // transform so Angular's JIT compiler can read the metadata at runtime.
  // (The old esbuild.tsconfigRaw.experimentalDecorators approach no longer applies.)
  oxc: {
    decorator: {
      legacy: true,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: [
      path.resolve(
        import.meta.dirname,
        '../../packages/testing-library/src/setup.ts',
      ),
    ],
    include: ['src/**/*.spec.ts'],
    alias: [
      // Stub binary assets so PNG/image imports in components don't crash the runner.
      // The regex must match the FULL import path (^.*) so that String.replace()
      // substitutes the entire specifier, not just the extension suffix.
      {
        find: /^.*\.(png|jpg|jpeg|gif|svg|webp)$/,
        replacement: path.resolve(
          import.meta.dirname,
          'src/__mocks__/asset-mock.ts',
        ),
      },
      {
        find: '@blotch/angular-lynx',
        replacement: path.resolve(
          import.meta.dirname,
          '../../packages/runtime/src/public-api.ts',
        ),
      },
      {
        find: '@blotch/angular-lynx-testing-library',
        replacement: path.resolve(
          import.meta.dirname,
          '../../packages/testing-library/src/index.ts',
        ),
      },
    ],
  },
});

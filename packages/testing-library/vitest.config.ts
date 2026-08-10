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
  },
  test: {
    // jsdom provides the DOM APIs Angular platform-browser expects.
    // LynxTestingEnv is installed on top of jsdom in src/setup.ts.
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(import.meta.dirname, 'src/setup.ts')],
    include: ['src/**/*.test.ts'],
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

import { defineConfig } from '@blotch/angular-lynx-build';

// The benchmark's build-time settings, read from the environment when the app
// is built and written into the bundle as constants (src/env.d.ts declares
// them), as the React Native app inlines its EXPO_PUBLIC_* variables:
//
// - FIXTURE_ORIGIN: the fixture server (benchmarks/fixtures/server.mjs).
//   localhost reaches the Mac from the iOS Simulator; a phone build passes
//   the Mac's LAN address, e.g. http://192.168.1.231:8787.
// - BENCH_SCREEN: a benchmark screen to open on instead of the tabs, e.g.
//   `mount?kind=view&count=1500`. Instruments launches an app without a URL,
//   so the harness builds a variant that starts there. Empty for the app.
// - BENCH_NO_MINIFY: set, the scripts aren't minified, so a profile of the
//   main thread (harness/node-mount.mjs --profile) names their functions.
//
// An AngularLynx app needs no rspeedy config: `ng build` takes the entry and
// everything else from angular.json, and merges this in. It's .mts because
// the package, as `ng new` made it, isn't "type": "module".
export default defineConfig({
  source: {
    define: {
      FIXTURE_ORIGIN: JSON.stringify(process.env['FIXTURE_ORIGIN'] || 'http://localhost:8787'),
      BENCH_SCREEN: JSON.stringify(process.env['BENCH_SCREEN'] ?? ''),
    },
  },
  ...(process.env['BENCH_NO_MINIFY'] ? { output: { minify: false } } : {}),
});

// The first module `ng test` loads, as a polyfill: before Angular's TestBed,
// the testing library's setup, and any test that imports @blotch/angular-lynx.
//
// The runtime reads these compile-time flags, which the rsbuild plugin
// defines for each thread when it bundles the app. Angular's unit-test build
// leaves packages unbundled, so a `define` couldn't reach the runtime's code;
// globals do. Tests run the way the native main thread does: in development,
// not on the web, without profiling or SSR.
//
// Plain JavaScript, so it isn't compiled to CommonJS with the builders:
// Angular bundles polyfills as ES modules.
Object.assign(globalThis, {
  __DEV__: true,
  __MAIN_THREAD__: true,
  __WEB__: false,
  __PROFILE__: false,
  __ENABLE_SSR__: false,
});

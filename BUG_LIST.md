# Bug List

Known bugs that still need fixing. Add new entries at the top. Remove an entry (or mark it fixed with the commit) once it's resolved.

## `experimental_isLazyBundle` can't load a route's bundle on the main thread

**Found while fixing** "Lazy routes fail in production builds" (fixed: lazy routes and `@defer` blocks are now inlined into the main bundle on every environment by default, and the runtime polyfills `URL`, whose absence made Angular's Router skip every navigation on device).

With `pluginAngularLynx({ experimental_isLazyBundle: true })`, each `loadComponent` route becomes its own lazy bundle. Until #84 those bundles held only background-thread code: the `typescript` rule in `packages/rsbuild-plugin-angular-lynx/src/layers.ts` set the layer with a `oneOf` whose first branch matched every module, so both entries shared one async chunk. The rule now matches on `issuerLayer`, as React Lynx's do, and a lazy bundle carries the main-thread code of its route (its background functions are in the initial background bundle).

What's left: AngularLynx renders and routes on the main thread, where QueryComponent can only load a bundle synchronously, so a route's first navigation can't wait for its bundle to download. Real code splitting needs main-thread loading through FetchBundle (engine 3.9+).

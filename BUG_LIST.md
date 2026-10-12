# Bug List

Known bugs that still need fixing. Add new entries at the top. Remove an entry (or mark it fixed with the commit) once it's resolved.

## `experimental_isLazyBundle` emits lazy bundles without main-thread code

**Found while fixing** "Lazy routes fail in production builds" (fixed: lazy routes and `@defer` blocks are now inlined into the main bundle on every environment by default, and the runtime polyfills `URL`, whose absence made Angular's Router skip every navigation on device).

With `pluginAngularLynx({ experimental_isLazyBundle: true })`, each `loadComponent` route still becomes its own lazy bundle, but that bundle only holds background-thread code. The `typescript` rule in `packages/rsbuild-plugin-angular-lynx/src/layers.ts` sets the layer with a `oneOf` whose first branch (`background`) has no `issuerLayer` condition, so it matches every module: the main-thread entry's modules land in the `background` layer too, both entries share one async chunk, and nothing marks it as main-thread code. Lynx for Web evaluates a lazy bundle's main-thread root when it loads one, so lazy routes fail there with `SyntaxError: Unexpected token '}'`.

Fixing the layers alone isn't enough: AngularLynx renders and routes on the main thread, where QueryComponent can only load a bundle synchronously, so a route's first navigation can't wait for its bundle to download. Real code splitting needs per-layer module rules (as React Lynx's `issuerLayer` rules do) and main-thread loading through FetchBundle (engine 3.9+).

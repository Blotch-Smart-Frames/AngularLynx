# Bug List

Known bugs that still need fixing. Add new entries at the top. Remove an entry (or mark it fixed with the commit) once it's resolved.

## Lazy routes fail in production builds (web and native)

**Found by:** E2E Layer 3 (`packages/e2e/playwright/render.test.ts`) and Layer 6 (`packages/e2e/native/lazy-route.yaml`). Both are marked as known failures until this is fixed.

Navigating to a `loadComponent` route in a production build (`rspeedy build`) never renders the route:

- **Web** (`main.web.bundle`): `<lynx-view>` reports `SyntaxError: Unexpected token '}'` from `lepus.js`. The lazy bundle's main-thread code section (`lepusCode.root`) is `{}`: no main-thread chunk is emitted for the lazy route, and web-core's `queryComponent` evaluates that root on the main thread. Every lazy bundle in the repo has the same empty root (kitchen-sink, defer).
- **iOS** (Lynx Explorer 4.1.0, `main.lynx.bundle`): tapping the link does nothing, and Explorer never requests the lazy bundle from the server (the E2E request log shows only `main.lynx.bundle`).
- **Both environments write the lazy chunk to the same file.** With `environments: { lynx, web }`, `dist/lazy-bundle/` holds one `src_app_lazy-route.ts.<hash>.bundle`, so whichever environment finishes last overwrites the other's. The examples' sequential `--environment lynx && --environment web` builds have the same collision.

Where to look: `AngularWebpackPlugin` in `packages/rsbuild-plugin-angular-lynx/src/angular-webpack-plugin.ts` (the `beforeEncode` hook that wraps `lepusCode.root` only when one exists; `lynx_aci` chunk URLs), the lazy bundle output filename per environment, and how React Lynx emits and resolves lazy bundles in production.

## The testing library doesn't work with Vitest 5 or jsdom 30

**Found by:** E2E Layer 2 (`npm test` after `ng generate @blotch/angular-lynx:add-testing`).

`ng new` (Angular 22) now adds `vitest@^5` and `jsdom@^30`. With them, the testing library fails before any test runs: `@lynx-js/testing-environment` throws `Cannot set property document of [object Window] which has only a getter` under jsdom 30, and Vitest 5 additionally fails with `__WEB__ is not defined` and `dom.window.close is not a function` at teardown. `add-testing` therefore replaces them with `vitest@^4` and `jsdom@^25`, silently downgrading the project. Supporting the versions `ng new` ships would remove the downgrade.

## `rspeedy build` exits 0 on TypeScript and template errors

**Found by:** E2E Layer 2 (a test file compiled into the app produced `TS2307` while the build still succeeded).

`compileAngular` in `packages/rsbuild-plugin-angular-lynx/src/angular.ts` prints Angular's diagnostics with `console.log({ errors, warnings })` and carries on, so a production build with type errors exits 0 and ships. `ng build` fails in this case. The E2E harness now fails the run when build output contains `TSxxxx:`/`NGxxxx:` diagnostics, and type-checks with `ngc`, but users' own CI would still pass a broken build.

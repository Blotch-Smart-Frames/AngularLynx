# @blotch/rsbuild-plugin-angular-lynx — RSpeedy/Rsbuild Plugin for Angular + Lynx

Bridges Angular's build system with the Lynx runtime. Configures webpack/rspack to compile Angular apps into Lynx's dual-thread bundles.

## Plugin Entry

`pluginAngularLynx(options?)` (in `plugin-angular-lynx.ts`) returns an `RsbuildPlugin` named `"lynx:angular"`. Setup calls 6 functions in order:

1. `applyCSS` — CSS handling configuration
2. `applyEntry` — Splits each entry into `main-thread` + `background-thread` bundles, applies Lynx webpack plugins
3. `applyLayers` — Enables webpack layers experiment; `"main"` (ES2019) and `"background"` (ES2015)
4. `applyAngularRules` — Angular compilation via `@angular/build` internals (`JavaScriptTransformer`, `createAngularCompilation`); reads `angular.json`, transforms TS→JS with Angular AOT, injects component style imports
5. `applyGenerator` — Output filename generation rules
6. `applySplitChunksRule` — Chunk splitting configuration

## Threading Model

Each entry is duplicated into two webpack entries with different layers:

- `{name}__main-thread` → layer `"main"`, target ES2019, gets `globalThis["__MAIN_THREAD__"]=true` banner
- `{name}` (background) → layer `"background"`, target ES2015, gets `globalThis["__MAIN_THREAD__"]=false` banner

Both halves contain the whole app, but Angular boots on the main thread only: the runtime's `bootstrapApplication()` returns early on the background thread, which runs module-level code. `cross-thread-transform.ts` ties a module's two copies together: it gives module-level `backgroundFn()`, `createMainThreadRef()` and `new MainThreadRef()` calls an ID from a hash of the file path and the call's position (so it matches whatever order the threads run modules in), and rewrites each `import()` in the app's own files so the background thread runs the same lazy import as the main thread (the runtime's `lazy-bundle/mirrored-imports.ts`).

## Lynx Webpack Plugins (applied in `applyEntry`)

- `LynxTemplatePlugin` — Generates Lynx template bundles from main+background chunks
- `RuntimeWrapperWebpackPlugin` — Wraps background JS (not main-thread) with Lynx runtime
- `LynxEncodePlugin` — Encodes output for Lynx runtime (lynx environment only)
- `AngularWebpackPlugin` — Thread banners, env vars (`__DEV__`, `__MAIN_THREAD__`), async chunk wrapping via `module.exports` injection, `lynxProcessEvalResult` runtime module

## Hot Updates (development builds)

The dev server's connection and webpack's hot update client run on the background thread, but the app runs on the main thread, which can't fetch anything. So `entry.ts` adds two clients (`src/client/`) that apply each update on both threads:

- `hmr-background.js` (wiring) / `background-hot-updates.ts` — replaces `@rspack/core/hot/dev-server`: applies the update on the background thread, asks the main thread to apply its half, fetches files for it, and reloads the page (`Page.reload` through Lynx DevTool) if either thread fails
- `hmr-main-thread.js` / `main-thread-hot-updates.ts` — gives the main thread a `lynx.requireModuleAsync()` that loads through the background thread and runs the chunk with `new Function`, then runs `module.hot.check()` when asked
- `css-hot-update.cjs` / `css-hot-update.ts` — swapped in for css-extract's `runtime/hotModuleReplacement.cjs`: applies stylesheet edits on the main thread with `lynx.getDevtool().replaceStyleSheetByIdWithBase64()`

The `.js`/`.cjs` wiring files are copied into `dist/client/` as they are, because the library build would compile away `import.meta.webpackHot` and `__webpack_hash__`. `angular-webpack-plugin.ts` keeps the main thread's hot update chunks out of the runtime wrapper and the thread-flag banner.

`hot-updates.ts` makes modules take updates (via `buildTransformedCode`): an app entry self-accepts (re-running it re-bootstraps the app), and a component module calls the runtime's `ɵhmrAccept`, which swaps templates and styles in place when the source signature (the file without its templates and styles) is unchanged, and otherwise passes the update on. The background thread's modules pass theirs on to the generated background entry, which self-accepts. The web environment has no hot updates.

## Angular Integration (`angular.ts`)

- Reads workspace config via `getAngularWorkspace()` / `getProjectByCwd()`
- `fileReplacements` take two steps, as in Angular's own builders: `compilation.initialize()` gets them, so the compiler host resolves imports of each `replace` file to its `with` file, and `file-replacements.ts` adds a `NormalModuleReplacementPlugin` per replacement, so rspack builds the `with` file wherever the compiled code imports the `replace` one
- Uses `@angular/build` internal APIs: `JavaScriptTransformer` (JS transform), `createAngularCompilation` (TS compilation with AOT). Import them from `utils/angular/build-internals.ts`, never from `@angular/build/src/...` directly: those paths aren't in `@angular/build`'s `exports`, so bare imports fail in users' apps (the old postinstall patch that worked around this no longer runs under npm 11)
- `onBeforeEnvironmentCompile`: initializes Angular compilation, emits affected files to cache, runs diagnostics. Runs on every watch rebuild too. `angular-rebuild-coordinator.ts` feeds the compiler's `modifiedFiles` to `compilation.update()`, serializes the `web`/`lynx` hooks onto the one shared compilation, and adds files whose Angular output changed back to `modifiedFiles` so rspack rebuilds them
- `api.transform`: serves compiled TS from cache, transforms JS via `JavaScriptTransformer`, prepends component stylesheet imports, registers external templates/stylesheets as watched dependencies, then runs the worklet transform and the cross-thread transform (lazy imports only in Angular-compiled files)

## Key Files

```
src/
  plugin-angular-lynx.ts               # Main plugin entry, orchestrates setup
  entry.ts                             # Entry splitting, Lynx plugin application
  layers.ts                            # Layer definitions (LAYERS.MAIN_THREAD, LAYERS.BACKGROUND)
  angular.ts                           # Angular compilation and transform pipeline
  angular-rebuild-coordinator.ts       # Keeps the Angular compilation in sync with watch rebuilds
  angular-webpack-plugin.ts            # Webpack plugin: banners, defines, async chunk wrapping
  cross-thread-transform.ts            # Cross-thread IDs for module-level backgroundFn/MainThreadRef, mirrored lazy imports
  hot-updates.ts                       # Hot update accept code for entries and component modules
  client/                              # Hot update clients the dev bundles run (see Hot Updates)
  budgets-plugin.ts                    # Checks angular.json budgets on the lynx environment's bundles and component styles
  file-replacements.ts                 # Swaps angular.json fileReplacements into the bundle (the compiler host swaps them in the program)
  polyfills.js                         # The first preEntry module: browser globals Angular expects (AbortController, Node, document…)
  es-builtins.js                       # ES2021–ES2026 built-ins the engines lack, imported by polyfills.js; a plain script so tests run it in a vm realm
  css.ts                               # CSS handling
  generator.ts                         # Output filename rules
  split-chunks.ts                      # Chunk splitting config
  lynx-process-eval-result-runtime-module.ts  # Runtime module for eval result processing
  loaders/ignore-css-loader.ts         # CSS ignore loader
  utils/
    options.ts                         # Plugin options normalization
    angular/
      read-workspace.ts                # Reads angular.json, finds project
      options.ts                       # Reads Angular build options from workspace
      budgets.ts                       # Budget size math and messages, ported from @angular/build's bundle calculator
      angular-config.ts                # Applies Angular config to Rsbuild
      build-internals.ts               # Loads @angular/build internals by file path (they're not in its `exports`)
      env.ts                           # maxWorkers, useTypeChecking flags
      component-style-bundler.ts       # Component style handling
      find-up.ts                       # File search utility
      normalize-cache.ts               # Cache normalization
```

## Build

```sh
npm run build -w packages/rsbuild-plugin-angular-lynx   # rslib build
```

Exports: `pluginAngularLynx` (main), polyfills, `loaders/ignore-css-loader`

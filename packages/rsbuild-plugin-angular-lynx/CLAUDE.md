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

## Lynx Webpack Plugins (applied in `applyEntry`)

- `LynxTemplatePlugin` — Generates Lynx template bundles from main+background chunks
- `RuntimeWrapperWebpackPlugin` — Wraps background JS (not main-thread) with Lynx runtime
- `LynxEncodePlugin` — Encodes output for Lynx runtime (lynx environment only)
- `AngularWebpackPlugin` — Thread banners, env vars (`__DEV__`, `__MAIN_THREAD__`), async chunk wrapping via `module.exports` injection, `lynxProcessEvalResult` runtime module

## Angular Integration (`angular.ts`)

- Reads workspace config via `getAngularWorkspace()` / `getProjectByCwd()`
- Uses `@angular/build` internal APIs: `JavaScriptTransformer` (JS transform), `createAngularCompilation` (TS compilation with AOT)
- `onBeforeEnvironmentCompile`: initializes Angular compilation, emits affected files to cache, runs diagnostics
- `api.transform`: serves compiled TS from cache, transforms JS via `JavaScriptTransformer`, prepends component stylesheet imports

## Key Files

```
src/
  plugin-angular-lynx.ts               # Main plugin entry, orchestrates setup
  entry.ts                             # Entry splitting, Lynx plugin application
  layers.ts                            # Layer definitions (LAYERS.MAIN_THREAD, LAYERS.BACKGROUND)
  angular.ts                           # Angular compilation and transform pipeline
  angular-webpack-plugin.ts            # Webpack plugin: banners, defines, async chunk wrapping
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
      angular-config.ts                # Applies Angular config to Rsbuild
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

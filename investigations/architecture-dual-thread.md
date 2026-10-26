# Lynx Dual-Thread Architecture

## Overview

Lynx uses a **dual-thread model**: every app has two JavaScript runtimes executing concurrently. Angular-Lynx runs the Angular app on the main thread only. The background thread's half of the bundle holds the runtime's bridges to background-only APIs and the modules that define `backgroundFn()`s and `MainThreadRef`s, nothing else. Shared code branches on `__MAIN_THREAD__`, which the build replaces with each half's value.

---

## The Two Threads

|                         | Main Thread (historically "Lepus")                        | Background Thread                                              |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| **Lynx's purpose**      | Rendering, pixel pipeline, gesture handling               | App logic, state, effects, network                             |
| **What AngularLynx runs** | The Angular app                                         | The runtime's bridges and the modules that define `backgroundFn()`s |
| **JS Engine**           | PrimJS (QuickJS-based, runs bytecode)                     | PrimJS (Android) / JavaScriptCore (iOS)                        |
| **ES Target**           | ES2019                                                    | ES2015                                                         |
| **DOM API**             | `__Create*`, `__SetAttribute`, etc. (direct native calls) | None                                                           |
| **Lynx API**            | Subset — non-rendering APIs only                          | Full (`fetch`, `NativeModules`, `lynx.getJSModule()`, etc.)    |
| **Bundle format**       | Bytecode (~4× faster load than text)                      | AMD-wrapped JavaScript                                         |

"Lepus" is legacy naming for the main thread JS runtime. PrimJS is the current engine.

---

## Bundle Structure

Each app entry point produces **two JS bundles**, packed into a single `.lynx.bundle` binary:

```
app entry
├── {name}__main-thread → main-thread.js  (bytecode: the whole app)
│   starts from the app's entry (main.ts)
│   webpack layer: "main", ES2019 SWC target, __MAIN_THREAD__ = true
│   the app's CSS is extracted from this half
│
└── {name} → background-thread.js         (AMD-wrapped JS: the runtime and the background functions)
    starts from a generated entry (background-entry.ts)
    webpack layer: "background", ES2015 SWC target, __MAIN_THREAD__ = false
```

This split is done in `packages/rsbuild-plugin-angular-lynx/src/entry.ts`: it creates two webpack entries per source entry, each tagged with a webpack `layer`. Every module stays in the layer of the module that imports it (`issuerLayer` rules in `layers.ts`), and SWC replaces `__MAIN_THREAD__` with the layer's value, so the minifier drops the other thread's branches. Both halves also get the `source.preEntry` polyfills.

The background entry is a file the plugin writes before each compile (`node_modules/.cache/angular-lynx/background-entries/<environment>/<entry>.js`). It imports the runtime, calls `ɵstartBackgroundThread()`, and imports every module that calls `backgroundFn()`, `createMainThreadRef()` or `new MainThreadRef()` at module level: the app's own, found in Angular's compiled output, and those of installed packages that depend on `@blotch/angular-lynx`. Before issue #84 the background half started from `main.ts` too, and held the whole app (1158 kB of the kitchen-sink app's 1160 kB main-thread half) for those few modules.

Three things keep the background half small:

- **Pure classes.** The background layer compiles to ES2015, so SWC lowers private and static class fields. A bundled library's class expression (`var X = class { #a }`) then becomes `var X = (_a = new WeakMap(), class {…})`, an assignment the bundler must keep, with every import the class uses. The runtime's classes all use `#private` fields, so this kept Angular's renderer and change detection. `pure-classes.ts` wraps such classes in `/*#__PURE__*/` IIFEs before SWC sees them, as Angular's own build does for classes with Angular static members, and the background layer also runs the app's modules through Angular's optimizer, which wraps its components.
- **ES module builds.** The Lynx build engine resolves every request with the conditions `lynx`, `import`, `require`, `browser`. rxjs's `exports` list `require` before `es2015`/`default`, so an `import` of rxjs resolved to its CommonJS build, all of rxjs, on both threads. `resolve.ts` resolves `import`s without `require` (and with `module`).
- **No spreads in exported arrays.** A minifier keeps an array literal with a spread even when nothing uses it, since the spread runs the array's iterator. `LYNX_ELEMENTS` spread `LYNX_FORM_ACCESSORS`, which kept every element directive and Angular with them.

By default the plugin turns off `asyncChunks`, so lazy routes and `@defer` blocks are in the initial chunks, and `import()` only runs their modules. With `experimental_isLazyBundle`, each lazy chunk becomes a lazy bundle with the main-thread code its route needs; the background functions in its modules are in the initial background half.

The final `.lynx.bundle` is a binary template format containing both sections.

---

## Boot Sequence

1. Main thread loads `main-thread.js` bytecode
2. Lynx native calls `globalThis.renderPage(initData)` → stores the InitData as `lynx.__initData`, signals page is ready
3. Angular on the **main thread** awaits this callback before bootstrapping (`runtime.ts`)
4. Background thread loads `background-thread.js` independently, copies the InitData from `lynx.getApp()._params` into `lynx.__initData`, installs its bridges and registers module-level `backgroundFn()`s. It doesn't load `main.ts`, so it never calls `bootstrapApplication()` (which would return a promise that never settles there).

Until issue #81, the background thread bootstrapped a second copy of the app too, on an in-memory `LynxBackgroundDocument` that nothing read. #1 copied React Lynx's split and meant to sync the trees later, which was never built. The copy made every constructor, `ngOnInit` and `effect()` run twice: a `runOnMainThread()` call in `ngOnInit` reached the main thread from both copies, for example.

---

## Inter-Thread Communication (IPC)

Threads communicate via Lynx's native message queue (async, JSON-serializable):

```
main thread → background:  main dispatches on lynx.getJSContext(),   background listens on lynx.getCoreContext()
background  → main thread: background dispatches on lynx.getCoreContext(), main listens on lynx.getJSContext()
```

Angular-Lynx uses this IPC for:

- **`runOnBackground()`** (`global-callbacks.ts`): main-thread code calls a `backgroundFn()`. There's no call the other way: Angular runs on the main thread, so `LynxMainThread.runOnMainThread()` runs its function in place.
- **`callOnBackground()`** (`background-call.ts`): services call background-only Lynx APIs: `addFont`, `accessibilityAnnounce`, exposure, session storage subscriptions, resource prefetching, `NativeModules` and JS modules. A function argument crosses as a `{ __angularLynxCallback: id }` marker, and the background thread's stand-in for it calls it back on the main thread. `getNativeModule()` and `getJSModule()` return proxies whose methods relay.
- **`LynxLogger`**: relays log entries from the main thread (no `fetch`) to a listener the background thread installs at module load.
- **Global exposure** (`exposure/global-exposure-bridge.ts`): forwards GlobalEventEmitter batches to the main thread.

**Early messages.** On native Lynx, a message the main thread sends before the background bundle has run isn't lost: `BTSRuntime::OnReceiveMessageEvent` (`core/shell/runtime/bts/bts_runtime.cc`) queues it in `cached_tasks_` until the runtime is ready, which is after `LoadApp` has evaluated the bundle and its listeners are in place. So a `runOnBackground()` call from a first-screen constructor arrives.

**IDs.** The background thread finds a function or `MainThreadRef` by ID. Counters only match if both threads run the same calls in the same order, which they don't: the background thread loads only some modules, in a different order, and the main thread runs Angular code. So the build plugin (`cross-thread-transform.ts`) gives each module-level `backgroundFn()`, `createMainThreadRef()` and `new MainThreadRef()` an ID from a hash of its file path and its position.

**Key constraint**: data crossing threads must be JSON-serializable. Variables captured by main-thread functions are snapshot-frozen at render time, not reactively updated.

---

## How Angular-Lynx Bridges the Threads

`provideRenderer()` provides the `LYNX_DOCUMENT` token:

```
provideRenderer()
  └── LYNX_DOCUMENT token
        ├── SSR hydrating → LynxHydrateDocument (reuses the snapshot's elements)
        └── otherwise     → LynxDocument        (delegates to __Create* / __Set* globals)
```

- **`LynxRenderer`**: every DOM operation (`createElement`, `setAttribute`, `appendChild`, etc.) calls a Lynx native global immediately.

---

## Global Callbacks Registered by the Runtime

`runtime.ts` registers these on `globalThis` so Lynx can call into Angular:

| Callback                  | Purpose                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `renderPage(data)`        | Stores the InitData as `lynx.__initData`, then signals the page is ready — unblocks main-thread bootstrap |
| `updatePage(data)`        | Merges a host InitData update into `lynx.__initData` and publishes it to `LynxInitData`                   |
| `updateGlobalProps(data)` | Merges a host GlobalData update into `lynx.__globalProps` and publishes it to `LynxGlobalData`            |
| `processData()`           | Data-processing hook. Returns the data unchanged unless `registerDataProcessors()` replaces it            |
| `runWorklet()`            | Executes a main-thread worklet function with parameters                                                   |

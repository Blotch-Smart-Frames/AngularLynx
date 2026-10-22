---
name: lynx-architecture
description: Reference for the Lynx dual-thread model and how AngularLynx maps onto it. Use when reasoning about main vs background thread, bundle structure, IPC, __MAIN_THREAD__ branches, or renderer design.
metadata:
  internal: true
---

# Lynx Architecture Reference

Reference for the Lynx dual-thread model and how Angular-Lynx maps onto it. Use this when reasoning about threading, bundle structure, IPC, or renderer design.

## The Two Threads

|                         | Main Thread                                            | Background Thread                                              |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| **Lynx's purpose**      | Rendering, pixel pipeline, gestures                    | App logic, state, effects, network                             |
| **What AngularLynx runs** | The whole Angular app: templates, handlers, services | Module-level code: `backgroundFn()`s and the runtime's bridges |
| **JS Engine**           | PrimJS (bytecode)                                      | PrimJS (Android) / JavaScriptCore (iOS)                        |
| **ES Target**           | ES2019                                                 | ES2015                                                         |
| **DOM API**             | `__Create*` / `__Set*` native globals                  | None                                                           |
| **Lynx APIs**           | Subset (non-rendering only)                            | Full (`fetch`, `NativeModules`, `lynx.getJSModule()`)          |

`__MAIN_THREAD__` is a global the plugin sets at the top of each bundle half (`globalThis["__MAIN_THREAD__"]=…`), not a define, so both halves keep both branches. "Lepus" is legacy naming for the main thread runtime (now PrimJS).

Angular runs on the main thread only. The background thread evaluates the same bundle, but `bootstrapApplication()` returns there without booting (issue #81). Before that, it booted a second copy of the app that rendered into an unread in-memory tree, so every constructor, `ngOnInit` and `effect()` ran twice.

## Bundle Structure

Each entry → two bundles in one `.lynx.bundle` binary:

```
{name}__main-thread → main-thread.js   (bytecode, webpack layer "main", ES2019)
{name}             → background-thread.js  (AMD JS, webpack layer "background", ES2015)
```

Split in: `packages/rsbuild-plugin-angular-lynx/src/entry.ts`  
By default `asyncChunks` is off, so lazy routes are in the initial chunk and `import()` only runs the module.

## Boot Sequence

1. Main thread loads `main-thread.js` bytecode
2. Lynx calls `globalThis.renderPage(initData)` → stores it as `lynx.__initData`, unblocks main-thread bootstrap
3. Background thread loads `background-thread.js`, copies the InitData from `lynx.getApp()._params`, installs its bridges and registers module-level `backgroundFn()`s. `bootstrapApplication()` returns a promise that never settles.

See: `packages/runtime/src/lib/runtime.ts`

## Inter-Thread Communication

Async message queue, data must be JSON-serializable:

```
main → background:  lynx.getJSContext().dispatchEvent(eventName, data)
background → main:  lynx.getCoreContext().dispatchEvent(eventName, data)
```

Each thread listens on the other's context. Channels:

- `runOnBackground()` / `backgroundFn()` — `global-callbacks.ts`. The main thread calls background functions; there's no call the other way, so `LynxMainThread.runOnMainThread()` runs in place.
- `callOnBackground()` — `background-call.ts`. Background-only Lynx APIs for the services: fonts, accessibility, exposure, session storage, resource prefetch, `NativeModules` and JS modules. Function arguments cross as `{ __angularLynxCallback: id }` markers and are called back on the main thread.
- `LynxLogger` — relays log entries to a listener installed at module load on the background thread.
- Exposure — `exposure/global-exposure-bridge.ts` forwards GlobalEventEmitter batches to the main thread.
- Lazy imports — `lazy-bundle/mirrored-imports.ts`. The plugin rewrites each `import()` in the app (`cross-thread-transform.ts`) so the background thread runs the same import when the main thread does.

The background thread finds functions and refs by ID. The plugin gives each module-level `backgroundFn()`, `createMainThreadRef()` and `new MainThreadRef()` an ID from its file and position, so the IDs don't depend on evaluation order.

## Angular Renderer Bridge

`provideRenderer()` provides `LYNX_DOCUMENT`: `LynxDocument`, which calls `__Create*` / `__Set*` globals directly, or `LynxHydrateDocument` while SSR hydrates.

Key files:

- `packages/runtime/src/lib/renderer/providers.ts` — `provideRenderer()`
- `packages/runtime/src/lib/lynx-document/` — `LynxDocument`
- `packages/runtime/src/lib/lynx-element/` — `LynxElement`
- `packages/runtime/src/lib/runtime.ts` — `bootstrapApplication()`
- `packages/runtime/src/lib/testing/in-memory-document.ts` — in-memory test double for renderer unit tests

## Full Investigation

See `investigations/architecture-dual-thread.md` for the complete reference.

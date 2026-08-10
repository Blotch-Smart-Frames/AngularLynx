# Lynx Architecture Reference

Reference for the Lynx dual-thread model and how Angular-Lynx maps onto it. Use this when reasoning about threading, bundle structure, IPC, or renderer design.

## The Two Threads

|               | Main Thread                           | Background Thread                             |
| ------------- | ------------------------------------- | --------------------------------------------- |
| **Purpose**   | Rendering, pixel pipeline, gestures   | App logic, state, effects, network            |
| **JS Engine** | PrimJS (bytecode)                     | PrimJS (Android) / JavaScriptCore (iOS)       |
| **ES Target** | ES2019                                | ES2015                                        |
| **DOM API**   | `__Create*` / `__Set*` native globals | Virtual in-memory element tree                |
| **Lynx APIs** | Subset (non-rendering only)           | Full (`fetch`, timers, `lynx.getNativeApp()`) |

`__MAIN_THREAD__` is a compile-time boolean define — tree-shakes thread-specific branches. "Lepus" is legacy naming for the main thread runtime (now PrimJS).

## Bundle Structure

Each entry → two bundles in one `.lynx.bundle` binary:

```
{name}__main-thread → main-thread.js   (bytecode, webpack layer "main", ES2019)
{name}             → background-thread.js  (AMD JS, webpack layer "background", ES2015)
```

Split in: `packages/rsbuild-plugin-angular-lynx/src/entry.ts`  
Lazy chunks follow the same pattern (each chunk gets both variants).

## Boot Sequence

1. Main thread loads `main-thread.js` bytecode
2. Lynx calls `globalThis.renderPage()` → unblocks main-thread bootstrap
3. Background thread loads `background-thread.js` and bootstraps immediately

See: `packages/runtime/src/lib/runtime.ts:200`

## Inter-Thread Communication

Async message queue, data must be JSON-serializable:

```
main → background:  lynx.getJSContext().dispatchEvent(eventName, data)
background → main:  lynx.getCoreContext().addEventListener(eventName, handler)
```

Used in `packages/runtime/src/lib/lynx-logger/lynx-logger.service.ts` to relay main-thread logs to background for `fetch`. React Lynx surfaces this as `runOnMainThread()` / `runOnBackground()`.

## Angular Renderer Bridge

`provideRenderer()` picks the document implementation via `LYNX_DOCUMENT` token:

- `__MAIN_THREAD__ = true` → `LynxDocument` — calls `__Create*` / `__Set*` globals directly
- `__MAIN_THREAD__ = false` → `LynxBackgroundDocument` — builds virtual `LynxBackgroundElement` tree

Both implement `Renderer2`, so component code is thread-agnostic.

Key files:

- `packages/runtime/src/lib/renderer/providers.ts` — `provideRenderer()`
- `packages/runtime/src/lib/lynx-document/` — `LynxDocument` + `LynxBackgroundDocument`
- `packages/runtime/src/lib/lynx-element/` — `LynxElement` + `LynxBackgroundElement`
- `packages/runtime/src/lib/runtime.ts` — `bootstrapApplication()`, global callbacks

## Full Investigation

See `investigations/architecture-dual-thread.md` for the complete reference.

# Lynx Dual-Thread Architecture

## Overview

Lynx uses a **dual-thread model**: every app has two JavaScript runtimes executing concurrently. Angular-Lynx runs the same Angular application code on both threads, using the compile-time `__MAIN_THREAD__` boolean to tree-shake thread-specific branches.

---

## The Two Threads

|                   | Main Thread (historically "Lepus")                        | Background Thread                                   |
| ----------------- | --------------------------------------------------------- | --------------------------------------------------- |
| **Purpose**       | Rendering, pixel pipeline, gesture handling               | App logic, state, effects, network                  |
| **JS Engine**     | PrimJS (QuickJS-based, runs bytecode)                     | PrimJS (Android) / JavaScriptCore (iOS)             |
| **ES Target**     | ES2019                                                    | ES2015                                              |
| **DOM API**       | `__Create*`, `__SetAttribute`, etc. (direct native calls) | Virtual in-memory element tree                      |
| **Lynx API**      | Subset — non-rendering APIs only                          | Full (`fetch`, timers, `lynx.getNativeApp()`, etc.) |
| **Bundle format** | Bytecode (~4× faster load than text)                      | AMD-wrapped JavaScript                              |

"Lepus" is legacy naming for the main thread JS runtime. PrimJS is the current engine.

---

## Bundle Structure

Each app entry point produces **two JS bundles**, packed into a single `.lynx.bundle` binary:

```
app entry
├── {name}__main-thread → main-thread.js  (bytecode, small — ~5-10% of total)
│   webpack layer: "main", ES2019 SWC target
│   globalThis.__MAIN_THREAD__ = true
│
└── {name} → background-thread.js         (AMD-wrapped JS, large — ~90-95% of total)
    webpack layer: "background", ES2015 SWC target
    globalThis.__MAIN_THREAD__ = false
```

This split is done in `packages/rsbuild-plugin-angular-lynx/src/entry.ts`: it creates two webpack entries per source entry, each tagged with a webpack `layer`. Lazy-loaded routes (code-split chunks) follow the same pattern — each chunk also produces a main-thread and background-thread variant.

The final `.lynx.bundle` is a binary template format containing both sections. Async chunks reference sections by name (e.g. `./App.js__main-thread` and `./App.js` for background).

---

## Boot Sequence

1. Main thread loads `main-thread.js` bytecode
2. Lynx native calls `globalThis.renderPage()` → signals page is ready
3. Angular on the **main thread** awaits this callback before bootstrapping (`runtime.ts:200`)
4. Background thread loads `background-thread.js` independently and bootstraps immediately

Both threads bootstrap the full Angular application. `__MAIN_THREAD__` being a compile-time define means each bundle only contains the code for its own thread.

---

## Inter-Thread Communication (IPC)

Threads communicate via Lynx's native message queue (async, JSON-serializable):

```
main thread → background:  lynx.getJSContext().dispatchEvent(eventName, data)
background  → main thread: lynx.getCoreContext().addEventListener(eventName, handler)
```

This IPC is used in `lynx-logger.service.ts` to relay log events from the main thread (no `fetch`) to the background thread (has `fetch`). React Lynx exposes this as the `runOnMainThread()` / `runOnBackground()` API — Angular-Lynx uses the raw IPC directly.

**Key constraint**: data crossing threads must be JSON-serializable. Variables captured by main-thread functions are snapshot-frozen at render time, not reactively updated.

---

## How Angular-Lynx Bridges the Threads

`provideRenderer()` selects the right document implementation based on `__MAIN_THREAD__`:

```
provideRenderer()
  └── LYNX_DOCUMENT token
        ├── __MAIN_THREAD__ = true  → LynxDocument        (delegates to __Create* / __Set* globals)
        └── __MAIN_THREAD__ = false → LynxBackgroundDocument (in-memory linked-list tree)
```

- **Main thread** `LynxRenderer`: every DOM operation (`createElement`, `setAttribute`, `appendChild`, etc.) calls a Lynx native global immediately.
- **Background thread** `LynxRenderer`: builds a virtual tree of `LynxBackgroundElement` nodes. The main thread reconciles this into native elements.

Both implement the same `Renderer2` interface, so Angular component code is unaware of which thread it's on.

---

## Global Callbacks Registered by the Runtime

`runtime.ts` registers these on `globalThis` so Lynx can call into Angular:

| Callback        | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `renderPage()`  | Signals the page is ready — unblocks main-thread bootstrap |
| `updatePage()`  | Incremental update hook (no-op currently)                  |
| `processData()` | Data-processing hook (no-op currently)                     |
| `runWorklet()`  | Executes a main-thread worklet function with parameters    |

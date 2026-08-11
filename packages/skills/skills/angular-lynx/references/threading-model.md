# Threading Model

## Dual-Thread Architecture

Lynx runs on two threads:

|                       | Main Thread                               | Background Thread              |
| --------------------- | ----------------------------------------- | ------------------------------ |
| **Purpose**           | Native UI rendering                       | JS execution, Angular app      |
| **JS Engine**         | PrimJS (ES2019)                           | PrimJS (ES2015)                |
| **DOM access**        | `__CreateElement`, `__SetAttribute`, etc. | Virtual tree (no native calls) |
| **`fetch()`**         | Not available                             | Available                      |
| **Angular runs here** | No                                        | Yes (in most configurations)   |

## `__MAIN_THREAD__` Global

The rsbuild plugin injects a banner into each bundle:

- Main-thread bundle: `globalThis["__MAIN_THREAD__"] = true`
- Background bundle: `globalThis["__MAIN_THREAD__"] = false`

The runtime uses this to create the correct document implementation:

- Main thread → `LynxDocument` (calls native `__Create*` functions)
- Background thread → `LynxBackgroundDocument` (in-memory virtual tree)

## Why This Matters

### Event Handlers Run in Worklets

When a user taps a button, the event handler executes in a synchronous native call frame (worklet) on whatever thread processes events. During this frame, **mutating the element tree is forbidden** — it corrupts internal state and crashes.

This is why all DOM-mutating operations must be deferred with `setTimeout(() => { ... }, 0)` — it moves execution to the next macrotask, after the worklet returns.

### Timer APIs Come from `lynx` Global

`setTimeout`, `setInterval`, `requestAnimationFrame` are not on `globalThis` — they live on the `lynx` object. The runtime polyfills them at startup:

```typescript
globalThis.setTimeout = lynx.setTimeout.bind(lynx);
globalThis.clearTimeout = lynx.clearTimeout.bind(lynx);
globalThis.setInterval = lynx.setInterval.bind(lynx);
// etc.
```

### IPC Between Threads

Main thread and background thread communicate via Lynx's event system:

```typescript
// Main thread → Background thread
lynx
  .getJSContext()
  .dispatchEvent({ type: 'my-event', data: JSON.stringify(payload) });

// Background thread listens
lynx.getCoreContext().addEventListener('my-event', (event) => {
  const data = JSON.parse(event.data);
});
```

The `LynxLogger` uses this pattern to relay logs from main-thread event handlers to the background thread where `fetch` is available.

## ECMAScript Support

- **Main thread (ES2019)**: `Array.flat()`, `Object.fromEntries()`, optional catch binding. No optional chaining (`?.`), no nullish coalescing (`??`).
- **Background thread (ES2015)**: `let`/`const`, arrow functions, classes, template literals, `Promise`, destructuring. Nothing newer.

The build pipeline transpiles your code to the appropriate target for each bundle, but be aware that:

- `Array.prototype.at()`, `structuredClone()` need polyfills
- `AbortController`/`AbortSignal` are polyfilled by the runtime
- `queueMicrotask` is polyfilled as `Promise.resolve().then(fn)`

## Missing Browser Globals

These do not exist in Lynx and are shimmed by the runtime:

| Global                                     | Shim                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| `window`                                   | `globalThis`                                                    |
| `document`                                 | `{ defaultView: globalThis, querySelector: () => null }`        |
| `addEventListener` / `removeEventListener` | No-ops on globalThis                                            |
| `AbortController`                          | Minimal polyfill                                                |
| `queueMicrotask`                           | `Promise.resolve().then(fn)`                                    |
| `URL` constructor                          | Not available (manual string parsing in `LynxPlatformLocation`) |
| `localStorage`                             | Use `lynx.setSessionStorage` / `lynx.getSessionStorage`         |

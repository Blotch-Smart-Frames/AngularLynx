# Threading Model

## Dual-Thread Architecture

Lynx runs on two threads:

|                       | Main Thread                               | Background Thread                                        |
| --------------------- | ----------------------------------------- | -------------------------------------------------------- |
| **Purpose**           | Native UI rendering, event handlers       | Background-only APIs                                     |
| **JS Engine**         | PrimJS (ES2019)                           | PrimJS on Android, JavaScriptCore on iOS (ES2015)        |
| **DOM access**        | `__CreateElement`, `__SetAttribute`, etc. | None                                                     |
| **`fetch()`, `NativeModules`** | Not available                    | Available                                                |
| **Angular runs here** | Yes: the whole app                        | No. Only your files' top-level code, such as `backgroundFn()`s |

## `__MAIN_THREAD__` Global

The rsbuild plugin injects a banner into each bundle:

- Main-thread bundle: `globalThis["__MAIN_THREAD__"] = true`
- Background bundle: `globalThis["__MAIN_THREAD__"] = false`

`bootstrapApplication()` starts Angular only when it's `true`. On the background thread it returns a promise that never settles, so constructors, `ngOnInit` and effects run once.

## Why This Matters

### Event Handlers Run in Worklets

When a user taps a button, the event handler executes in a synchronous native call frame (worklet) on the main thread. During this frame, **mutating the element tree is forbidden** — it corrupts internal state and crashes.

This is why all DOM-mutating operations must be deferred with `setTimeout(() => { ... }, 0)` — it moves execution to the next macrotask, after the worklet returns.

### Background-Only APIs

Reach them from your app in one of two ways:

- **AngularLynx services relay for you:** `LynxNativeModule`, `LynxResourcePrefetch`, `LynxFont.addFont()`, `LynxAccessibility.announce()` and `LynxLogger` send their calls to the background thread. Results and callbacks come back as JSON.
- **Your own code:** define a `backgroundFn()` at the top level of a file, and call it with the `runOnBackground()` global. The background thread runs your files, but not your components, so a `backgroundFn()` created inside a class or function never registers there.

```typescript
import { backgroundFn } from '@blotch/angular-lynx';

const loadPosts = backgroundFn(async () => {
  const response = await fetch('https://example.com/posts.json');
  return response.json();
});

// In a component, on the main thread:
// runOnBackground(loadPosts).then((posts) => this.posts.set(posts));
```

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

The `LynxLogger` uses this pattern to relay logs from the main thread, where your app runs, to the background thread, where `fetch` is available.

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

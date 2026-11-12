# Threading Model

## Dual-Thread Architecture

Lynx runs on two threads:

|                       | Main Thread                                     | Background Thread                                                                 |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| **Purpose**           | Native UI rendering, event handlers             | Background-only APIs                                                              |
| **JS Engine**         | PrimJS (ES2019)                                 | PrimJS on Android, JavaScriptCore on iOS (ES2015)                                 |
| **DOM access**        | `__CreateElement`, `__SetAttribute`, etc.       | None                                                                              |
| **`fetch()`**         | Relayed to the background thread by the runtime | Available                                                                         |
| **`NativeModules`**   | Not available                                   | Available                                                                         |
| **Angular runs here** | Yes: the whole app                              | No. Only the files that define `backgroundFn()`s or `MainThreadRef`s at top level |

## `__MAIN_THREAD__` Global

The rsbuild plugin replaces `__MAIN_THREAD__` with each bundle's value when it compiles, and also sets it on `globalThis`:

- Main-thread bundle: `__MAIN_THREAD__ === true`
- Background bundle: `__MAIN_THREAD__ === false`

The background bundle doesn't start from `main.ts`: the build generates its entry, which imports the runtime and the files that define a `backgroundFn()`, `createMainThreadRef()` or `new MainThreadRef()` at top level. Angular and your components aren't in it, so constructors, `ngOnInit` and effects run once.

## Why This Matters

### Event Handlers Run Inside the Native Event

When a user taps a button, the event handler executes in a synchronous native call frame on the main thread. Changing the element tree there is safe: measured on Lynx 4.1 (iOS, Android, web), handlers that navigate, start `animate()`, or create, remove and flush elements don't crash. An older version of this guide said to defer those with `setTimeout`; that isn't needed.

### Background-Only APIs

Reach them from your app in one of two ways:

- **AngularLynx services relay for you:** `LynxNativeModule`, `LynxResourcePrefetch`, `LynxFont.addFont()`, `LynxAccessibility.announce()` and `LynxLogger` send their calls to the background thread. Results and callbacks come back as JSON.
- **`fetch()`, `XMLHttpRequest`, `HttpClient` and `httpResource` relay too:** the runtime's main-thread `fetch` sends each request to the background thread's. See [http-requests.md](http-requests.md).
- **Your own code:** define a `backgroundFn()` at the top level of a file, and call it with the `runOnBackground()` global. The background thread loads only the files that define one at top level (and their imports), so a `backgroundFn()` created inside a class or function never registers there.

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

- The build adds the newer built-in methods up to ES2026 (`.at()`, `toSorted()`, `Object.groupBy()`, `Promise.withResolvers()`, the Set methods, iterator helpers and the rest) before the app starts, on both threads, and `String.prototype.normalize()`, which three.js's loaders call on every URL. That `normalize()` returns ASCII exactly and other text as given: it doesn't decompose or compose accented letters. Still missing: `structuredClone()`, the RegExp `d`/`v` flags and `Error`'s `cause` option, and `Intl` unless the build's `intl` option adds it (see "No `Intl`" in [lynx-gotchas.md](lynx-gotchas.md))
- On the main thread, `for await` over a sync iterable of promises yields the promises themselves, not their values: await each one yourself, or use `Promise.all()`
- `#private` fields in your code (and AngularLynx's) compile to non-enumerable properties named `__private_<n>_<name>`, not to the WeakMaps ES2019 would use: PrimJS never frees objects that reach each other through those WeakMaps while one of them holds a native element. So `#field in obj` throws (`_field.has is not a function`): check with `instanceof` or a public property instead. `Object.getOwnPropertyNames()` lists private fields; `Object.keys()`, `JSON.stringify()` and spreading don't. Other packages' private fields compile as usual
- A `WeakMap` you write yourself does the same on the main thread: while the map lives (in a module or a root service, for the app's life), PrimJS never lets go of an entry whose value leads back to its key through a native element, so the key, the value and every element they reach stay. Keep per-object state on the object (a property or a `#private` field), or drop what the value holds once the object is destroyed. A `WeakMap` keyed by `LynxStackPage` whose value holds the page's components or elements keeps every page of every stack the app has had
- `AbortController`/`AbortSignal` are polyfilled by the runtime
- `queueMicrotask` is polyfilled as `Promise.resolve().then(fn)`

## Missing Browser Globals

These do not exist in Lynx and are shimmed by the runtime:

| Global                                     | Shim                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `window`                                   | `globalThis`                                                                                                     |
| `document`                                 | Every element's `ownerDocument` and `DOCUMENT`: listenable, with `defaultView` and `body`; queries return `null` |
| `addEventListener` / `removeEventListener` | The window's listeners on the main thread (touches, `resize`); no-ops on the background thread                   |
| `innerWidth` / `innerHeight`               | The LynxView's size                                                                                              |
| `Event` / `CustomEvent`                    | Minimal classes, for `dispatchEvent()`                                                                           |
| `AbortController`                          | Minimal polyfill                                                                                                 |
| `queueMicrotask`                           | `Promise.resolve().then(fn)`                                                                                     |
| `atob` / `btoa`                            | Both threads; bad input throws an `InvalidCharacterError`                                                        |
| `DOMException`                             | Both threads, with `name`, `message` and the legacy `code`                                                       |
| `URL` constructor                          | Not available (manual string parsing in `LynxPlatformLocation`)                                                  |
| `localStorage`                             | `LynxLocalStorage`, or `LynxSecureStorage` for secrets                                                           |
| `navigator.clipboard`                      | `LynxClipboard`                                                                                                  |
| `window.open` / `location.href = url`      | `LynxLinking.openURL()`, or `openInApp()` for a browser sheet                                                    |
| `navigator.share()`                        | `LynxShare.share()`, with files as `{ blob, name }`                                                              |

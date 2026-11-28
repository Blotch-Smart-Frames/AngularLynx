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

## The Phone's UI Thread

Lynx runs the main thread's JavaScript, its layout and its animator on its engine thread, and the host app picks which thread that is. The apps `ng build --platform ios|android` makes give it a thread of its own (Lynx's `MostOnTASM`), off the UI thread iOS and Android draw and scroll on. Lynx Explorer runs it on the UI thread (Lynx's default, `AllOnUI`).

- **A busy app doesn't freeze what the platform runs itself** in a built app: a flicked `<scroll-view>` keeps scrolling, and text fields and web views keep taking touches, while Angular builds a screen or runs a long handler. In Lynx Explorer they freeze with it, so judge a heavy screen's feel in a build.
- **What Lynx draws from the element tree still waits for Angular**: the next screen, a changed style, and Lynx's animations (CSS transitions, `@keyframes`, `element.animate()`), which tick on the same thread. Keep handlers short, and move heavy work to a `backgroundFn()`.
- **Changes reach the screen after the flush crosses to the UI thread**, a step later than in Explorer. UI methods (`invoke()`) go with the flush, after the element's UI is made.

## `__MAIN_THREAD__` Global

The rsbuild plugin replaces `__MAIN_THREAD__` with each bundle's value when it compiles, and also sets it on `globalThis`:

- Main-thread bundle: `__MAIN_THREAD__ === true`
- Background bundle: `__MAIN_THREAD__ === false`

The background bundle doesn't start from `main.ts`: the build generates its entry, which imports the runtime and the files that define a `backgroundFn()`, `createMainThreadRef()` or `new MainThreadRef()` at top level. Angular and your components aren't in it, so constructors, `ngOnInit` and effects run once. Every top-level statement of those files (and their imports) runs there too, unless the `backgroundTreeShaking` build option is `"aggressive"`: then a module-level declaration whose value nothing on the background thread reads is dropped from its script, initializer and all, so don't rely on a declaration's side effect there (see [build-configuration.md](build-configuration.md)).

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

- The build adds the newer built-in methods up to ES2026 (`.at()`, `toSorted()`, `Object.groupBy()`, `Promise.withResolvers()`, the Set methods, iterator helpers and the rest), and `String.prototype.normalize()`, which three.js's loaders call on every URL. It imports each at the top of every file (libraries' included) that names it, on both threads, so it's defined before that file's code runs: as a method (`a.toSorted()`, `const { hasOwn } = Object`) or in a string that could be the name it's called by (`a['toSorted']`, `const m = 'toSorted'`). A name put together at runtime (`'to' + 'Sorted'`), or kept as data in an array literal or as an object's value (`{ decode: 'fromHex' }`), isn't seen, and the call throws "not a function" on Lynx while the web preview works: write the name out in that file. That `normalize()` returns ASCII exactly and other text as given: it doesn't decompose or compose accented letters. Still missing: `structuredClone()`, the RegExp `d`/`v` flags and `Error`'s `cause` option, and `Intl` unless the build's `intl` option adds it (see "No `Intl`" in [lynx-gotchas.md](lynx-gotchas.md))
- On the main thread, `for await` over a sync iterable of promises yields the promises themselves, not their values: await each one yourself, or use `Promise.all()`
- `#private` fields in your code (and AngularLynx's) compile to non-enumerable properties named `__private_<n>_<name>`, not to the WeakMaps ES2019 would use: PrimJS never frees objects that reach each other through those WeakMaps while one of them holds a native element. So `#field in obj` throws (`_field.has is not a function`): check with `instanceof` or a public property instead. `Object.getOwnPropertyNames()` lists private fields; `Object.keys()`, `JSON.stringify()` and spreading don't. A private method is defined once, not on each instance, when it's only ever called on `this` in its own class (AngularLynx's own are all defined once), so it isn't listed either; one called on another object (`other.#m()`) still is. Other packages' private fields compile as usual
- A `WeakMap` you write yourself does the same on the main thread: while the map lives (in a module or a root service, for the app's life), PrimJS never lets go of an entry whose value leads back to its key through a native element, so the key, the value and every element they reach stay. Keep per-object state on the object (a property or a `#private` field), or drop what the value holds once the object is destroyed. A `WeakMap` keyed by `LynxStackPage` whose value holds the page's components or elements keeps every page of every stack the app has had
- `AbortController`/`AbortSignal` are polyfilled by the build
- `queueMicrotask` is polyfilled by the build: `Promise.resolve().then(fn)` on the main thread, which reports an error `fn` throws the way the web does (thrown again from a `setTimeout`), and `lynx.queueMicrotask` on the background thread
- A UI method's answer comes back as a native call, and Lynx runs every pending promise callback when one ends. With the build's pending UI method calls, that's after the element's flush (inside the flush in Lynx Explorer); a host on a Lynx older than 4.1 answers inside the call, `getBoundingClientRect()`'s `boundingClientRect` included, so a constructor or template that measures an element can run callbacks queued earlier in the same synchronous pass, in the middle of it (the web preview doesn't). Don't decide in a deferred callback something that depends on that pass being over, such as "did the router activate this outlet again", without checking `router.currentNavigation()` and waiting for `NavigationEnd` while it's set

## Missing Browser Globals

These do not exist in Lynx and are shimmed by the runtime:

| Global                                       | Shim                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `window`                                     | `globalThis`                                                                                                                                                                                                 |
| `document`                                   | Every element's `ownerDocument` and `DOCUMENT`: listenable, with `defaultView` and `body`; queries return `null`                                                                                             |
| `addEventListener` / `removeEventListener`   | The window's listeners on the main thread (touches, `resize`); no-ops on the background thread                                                                                                               |
| `innerWidth` / `innerHeight`                 | The LynxView's size                                                                                                                                                                                          |
| `Event` / `CustomEvent`                      | Minimal classes, for `dispatchEvent()`                                                                                                                                                                       |
| `AbortController`                            | Minimal polyfill                                                                                                                                                                                             |
| `queueMicrotask`                             | `Promise.resolve().then(fn)` on the main thread, `lynx.queueMicrotask` on the background thread                                                                                                              |
| `performance.now()` / `timeOrigin`           | Main thread only, in fractions of a millisecond from the engine's microsecond clock (not monotonic: a change to the device's time moves it); the background thread has none, so time with `Date.now()` there |
| `atob` / `btoa`                              | Both threads; bad input throws an `InvalidCharacterError`                                                                                                                                                    |
| `DOMException`                               | Both threads, with `name`, `message` and the legacy `code`                                                                                                                                                   |
| `URL` constructor                            | Not available (manual string parsing in `LynxPlatformLocation`)                                                                                                                                              |
| `localStorage`                               | `LynxLocalStorage`, or `LynxSecureStorage` for secrets                                                                                                                                                       |
| `navigator.clipboard`                        | `LynxClipboard`                                                                                                                                                                                              |
| `navigator.vibrate()`                        | `LynxHaptics`                                                                                                                                                                                                |
| `navigator.credentials` (WebAuthn, passkeys) | None. For a local check that the person is there, not a credential a server verifies, `LynxBiometrics`                                                                                                       |
| `window.open` / `location.href = url`        | `LynxLinking.openURL()`, or `openInApp()` for a browser sheet                                                                                                                                                |
| `navigator.share()`                          | `LynxShare.share()`, with files as `{ blob, name }`                                                                                                                                                          |
| `<input type="file">`, downloads             | `LynxFilePicker.pick()` and `save()`                                                                                                                                                                         |
| `BarcodeDetector`                            | `LynxBarcodeScanner.scan()`, with `permissions.camera`                                                                                                                                                       |

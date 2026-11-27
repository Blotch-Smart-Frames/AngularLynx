/**
 * Environment polyfills for running Angular on the Lynx runtime.
 *
 * Lynx's PrimJS/Lepus context is not a browser: it has no DOM, no `window`, and
 * exposes timer/scheduling primitives on the `lynx` global rather than
 * `globalThis`. Angular (and its Router/forms/i18n/`@defer` machinery) assumes a
 * browser-shaped environment, so this module fills the gaps before bootstrap.
 *
 * Every shim is guarded by a `typeof … === 'undefined'`/`!== 'function'` check
 * so it is a no-op wherever the real API already exists (the web preview, jsdom,
 * or a browser main thread). Extracted from runtime.ts as one cohesive unit;
 * imported for its side effects only. Ordering matters (timers before
 * requestIdleCallback), so keep these blocks in sequence.
 *
 * The main-thread-only blocks test `__MAIN_THREAD__` itself, not
 * isMainThread(): the build defines it, so rspack drops each block, and the
 * classes only it reaches, from the background thread's bundle. Behind a
 * call it kept them all, and the minifier, which later inlines the call and
 * drops the block, left Blob, ReadableStream and TextDecoder in that
 * thread's script (issue #717). The `typeof` check is for unit tests, which
 * load this module without the define.
 */

import { installCanvasGlobals } from './canvas/dom-globals';
import {
  globalEvents,
  installGlobalDocument,
  installGlobalWindow,
} from './global-events';
import { installElementGlobal } from './lynx-element/element-global';
import { installBase64Globals } from './network';
import { installObjectURLs } from './network/blob-urls';
import { installUrl } from './url';

// Web-only: fail loud and clear when the page is not a secure context.
//
// cspell:disable-next-line
// @lynx-js/web-core's engine chunk (kwift.*.js) calls crypto.randomUUID()
// while registering handlers during startup, inside the background Web Worker
// it spawns (new Worker(new URL('../background/index.js', import.meta.url))).
// crypto.randomUUID() — like SharedArrayBuffer, which web-core also needs for
// synchronous native-module calls — is a SECURE-CONTEXT-ONLY Web API: the
// `crypto` object still exists (so crypto.getRandomValues works) but
// crypto.randomUUID is simply absent. Opening the preview over an insecure
// origin — e.g. the "Network" http://<LAN-IP>:<port> URL the dev server prints
// alongside "Local" — therefore makes web-core throw a cryptic
// "crypto.randomUUID is not a function" deep inside Lynx's own engine code,
// which we neither ship nor can patch, and which runs before any of our code in
// web-core's worker (so it cannot be polyfilled). The only fix is to load from
// a secure context. localhost and 127.0.0.1 always qualify; any HTTPS origin
// does too. Surface that here instead of leaving the developer with the
// third-party stack trace. __WEB__ is a compile-time define (false on native),
// so this block is dead-code-eliminated from native bundles — native unchanged.
if (__WEB__ && globalThis.isSecureContext === false) {
  console.error(
    '[angular-lynx] The web preview is not running in a secure context, so ' +
      'crypto.randomUUID() and SharedArrayBuffer are unavailable and ' +
      '@lynx-js/web-core will crash on startup ("crypto.randomUUID is not a ' +
      'function"). Open the preview from a secure origin: use the "Local" ' +
      'http://localhost:<port> URL, not the "Network" http://<LAN-IP>:<port> ' +
      'URL (or serve over HTTPS).',
  );
}

// AbortController, AbortSignal and Node (whose constants Angular's i18n
// runtime reads) aren't installed here: the build plugin's polyfills.js, the
// first module of each thread's script, installs them. This module once kept
// a copy of each for apps built without the plugin, but there are none: the
// runtime reads the plugin's compile-time defines (`__WEB__` above), and
// `ng test` sets them as globals in a DOM that has both. So the copies never
// installed anything, and every app's scripts carried them twice (#765).

// Lynx's main thread (PrimJS) has no `URL` or `URLSearchParams`. Since 22.2,
// Angular's Router serializes every URL through `new URL(url, 'http://fake')`
// to reject protocol-relative URLs, and treats the ReferenceError as such a
// URL, so every URL serialized to `/`. Each navigation then looked like a
// navigation to the current URL and was skipped (NavigationSkipped): no route
// could be opened on device, lazy or not. HttpClient and NgOptimizedImage's
// loaders use `URL` as well.
installUrl(globalThis);

// Neither of Lynx's threads has atob, btoa or DOMException, which libraries
// written for browsers call directly: Firebase Firestore encodes and decodes
// its stream tokens with them. Both threads get them, since an app's
// background functions can run such code too (issue #206). Nothing here hides
// a runtime's own: the background bundle's wrapper function takes no
// parameter by these names (unlike `fetch`), so globalThis tells the truth.
installBase64Globals(globalThis as unknown as Record<string, unknown>);

// Lynx's main thread has no URL.createObjectURL(), which three.js's glTF
// loader and an <image> showing a picked photo use. The background thread
// keeps its own globals.
//
// Nor has it fetch, XMLHttpRequest, IntersectionObserver, TextEncoder,
// TextDecoder, ReadableStream or Blob, which aren't installed here either:
// the build plugin calls each one's enable function (ɵenableFetch() and the
// like) in each module that names it, so an app that never uses one leaves it
// out of its main-thread script, which PrimJS reads whole as it loads it
// (#719, #760; network/enable.ts).
if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
  installObjectURLs(globalThis as unknown as Record<string, unknown>);
}

// Angular core uses queueMicrotask for effect scheduling and change detection.
// React Lynx polyfills this from lynx.queueMicrotask (see motion/src/polyfill/shim.ts).
if (typeof globalThis.queueMicrotask !== 'function') {
  if (typeof lynx !== 'undefined' && (lynx as any).queueMicrotask) {
    (globalThis as any).queueMicrotask = (lynx as any).queueMicrotask;
  } else {
    const resolved = Promise.resolve();
    (globalThis as any).queueMicrotask = (fn: () => void) => {
      resolved.then(fn).catch((err: unknown) => {
        setTimeout(() => {
          throw err;
        }, 0);
      });
    };
  }
}

// The main thread's `document` is the one LynxElements' `ownerDocument` and
// Angular's DOCUMENT are, which `document:` and `window:` listeners listen on
// (see global-events). It replaces the plugin's placeholder (polyfills.js).
// The web preview and jsdom keep their own: there `document` is a DOM one.
if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
  installGlobalDocument(globalThis, globalEvents());
} else if (typeof document === 'undefined') {
  (globalThis as any).document = {
    defaultView: globalThis,
    // getBaseHrefFromDOM() calls document.querySelector('base').
    // Return null so Angular falls back to APP_BASE_HREF (provided in provideRenderer).
    querySelector: () => null,
  };
}

try {
  if (typeof window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
} catch {
  // On Lynx for Web, globalThis is the main thread's iframe window, whose
  // `window` is a getter, so the assignment above throws. And the bundle
  // runs inside web-core's wrapper, `(function(){ … let window=void 0;
  // <bundle> })` (MTS_CODE_WRAPPER_PREFIX in its decode.worker.js), so
  // `window` meant that `let`, and code that reads `window.innerWidth`
  // threw. Assigning it makes `window` globalThis there too, as it is on iOS
  // and Android.
  if (__WEB__) window = globalThis as typeof window;
}

// Angular's DefaultValueAccessor (from @angular/forms) is instantiated on every
// <input [formControl]> / <textarea [formControl]> element — even when our custom
// LynxInputValueAccessor is the *selected* accessor, DefaultValueAccessor still
// gets created because its selector matches. Its constructor calls _isAndroid()
// → getDOM().getUserAgent() → BrowserDomAdapter.getUserAgent(), which reads
// window.navigator.userAgent. Lynx has no navigator global, so this throws a
// TypeError that crashes the component mid-creation, blanks the page, and
// corrupts the Router state (making subsequent routes also blank).
// In a Web Worker (e.g. @lynx-js/go-web preview), `navigator` is a read-only
// getter on WorkerGlobalScope — assignment throws. Only polyfill when it's
// truly missing (native Lynx background thread).
try {
  if (typeof navigator === 'undefined') {
    (globalThis as any).navigator = { userAgent: '' };
  }
} catch {
  // navigator exists as a read-only property (Web Worker) — no polyfill needed
}

// The window's listeners, `innerWidth` and `innerHeight` (see
// global-events/window.ts): `window:` listeners, and the screen's events.
// The background thread runs no Angular, and keeps no-op listener methods
// for code that calls them: BrowserPlatformLocation's onPopState and
// onHashChange call window.addEventListener.
if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
  installGlobalWindow(globalThis, globalEvents());
} else {
  if (typeof globalThis.addEventListener !== 'function') {
    (globalThis as any).addEventListener = () => {};
  }
  if (typeof globalThis.removeEventListener !== 'function') {
    (globalThis as any).removeEventListener = () => {};
  }
}

// Lynx provides timer/scheduling APIs on the `lynx` global, not on `globalThis`.
// Angular's zoneless ChangeDetectionScheduler uses setTimeout to schedule CD
// after markForCheck(). Without these polyfills, CD never fires after the initial
// synchronous render, so dynamic content (RouterOutlet, signal updates) never appears.
// React Lynx does the same polyfill — see @lynx-js/react worklet-runtime/api/lynxApi.ts.
if (
  typeof globalThis.setTimeout !== 'function' &&
  typeof lynx !== 'undefined'
) {
  const _lynx = lynx as any;
  (globalThis as any).setTimeout = _lynx.setTimeout;
  (globalThis as any).setInterval = _lynx.setInterval;
  (globalThis as any).clearTimeout = _lynx.clearTimeout;
  (globalThis as any).clearInterval =
    _lynx.clearInterval ?? _lynx.clearTimeInterval;
  if (_lynx.requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = _lynx.requestAnimationFrame;
  }
  if (_lynx.cancelAnimationFrame) {
    (globalThis as any).cancelAnimationFrame = _lynx.cancelAnimationFrame;
  }
}

// A browser's cancelAnimationFrame() ignores a handle it doesn't know, and
// code leans on that: three.js stops a renderer's animation loop with
// `cancelAnimationFrame(requestId)` whether or not the loop ever started, so
// with `null` when it didn't, which is every `renderer.dispose()` angular-three
// makes as a canvas goes. Lynx's native cancelAnimationFrame throws on anything
// but a number ("param 0 should be Number"), so every canvas's teardown failed
// part way. Only a number reaches it here, whichever one is installed.
const nativeCancelAnimationFrame = (globalThis as any).cancelAnimationFrame as
  | ((handle: number) => void)
  | undefined;
if (typeof nativeCancelAnimationFrame === 'function') {
  (globalThis as any).cancelAnimationFrame = (handle: unknown): void => {
    if (typeof handle === 'number') {
      nativeCancelAnimationFrame.call(globalThis, handle);
    }
  };
}

// A browser's clearTimeout() and clearInterval() do nothing for `undefined` or
// `null`, and code leans on that: a component clears the timer it may not
// have started yet (`clearTimeout(this.#timer)`) before starting one. Lynx's
// main-thread ones throw for anything but a number ("ClearTimeout param 0
// should be Number", renderer_functions.cc in Lynx core), so the timer after
// it was never started (issue #303's copy button stayed on "Copied"). Only
// those two are skipped: Node's timers, which the testing library runs on,
// hand out objects, and those still reach its clearTimeout.
for (const name of ['clearTimeout', 'clearInterval'] as const) {
  const nativeClear = (globalThis as any)[name] as
    | ((handle: unknown) => void)
    | undefined;
  if (typeof nativeClear === 'function') {
    (globalThis as any)[name] = (handle?: unknown): void => {
      if (handle !== undefined && handle !== null) {
        nativeClear.call(globalThis, handle);
      }
    };
  }
}

// Angular's `@defer (on idle)` trigger schedules work through its internal
// RequestIdleCallbackService. On any platform that lacks `requestIdleCallback`
// Angular falls back to `cb => setTimeout(cb)` and then, inside IdleScheduler,
// reads `deadline.timeRemaining()` on whatever object the scheduled callback was
// invoked with. Browsers invoke it with a real IdleDeadline; Lynx does NOT —
// its native `setTimeout` calls the callback with an *empty object* (the Lepus
// runtime dispatches timed tasks with `Dictionary::Create()` — see
// core/runtime/lepus/tasks/lepus_callback_manager.cc `SetTimeTask`). So
// `deadline.timeRemaining` is `undefined`, and Angular's `deadline.timeRemaining()`
// call throws "TypeError: not a function", crashing the main-thread frame the
// instant an `@defer (on idle)` block renders. This is main-thread-only: the web
// build has a genuine requestIdleCallback and never reaches the fallback, which is
// why the same demo works in the browser preview but dies on-device.
//
// Fix: supply a matched requestIdleCallback/cancelIdleCallback pair that hands the
// callback a correctly-shaped IdleDeadline. We define BOTH (never just one) because
// Angular reuses the single `typeof requestIdleCallback !== 'undefined'` guard to
// pick cancelIdleCallback too — a lone requestIdleCallback would make it bind an
// undefined cancelIdleCallback. Defined after the timer polyfill above so
// setTimeout/clearTimeout are already resolvable on both threads.
if (
  typeof (globalThis as any).requestIdleCallback !== 'function' ||
  typeof (globalThis as any).cancelIdleCallback !== 'function'
) {
  (globalThis as any).requestIdleCallback = (
    callback: (deadline: {
      didTimeout: boolean;
      timeRemaining: () => number;
    }) => void,
  ): number =>
    // A fresh idle period reports ~50ms remaining in browsers; returning a
    // positive value lets Angular's IdleScheduler drain its whole queue in one
    // pass rather than treating the period as already exhausted (which would make
    // it re-schedule endlessly). setTimeout(_, 0) mirrors the zoneless CD
    // scheduler's own use of a macrotask elsewhere in this file.
    setTimeout(
      () => callback({ didTimeout: false, timeRemaining: () => 50 }),
      0,
    ) as unknown as number;
  (globalThis as any).cancelIdleCallback = (id: number): void =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

// What three.js and angular-three need of the browser to draw in a <canvas>
// (canvas/dom-globals.ts): performance.now(), images, ResizeObserver and the
// like. Last, since it adds to the `document` and `window` stand-ins above.
// The main thread only: Angular, and the scene, run there.
if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
  // A template's elements are `instanceof Element`, which Angular's @defer
  // triggers check before listening to one (issue #459).
  installElementGlobal(globalThis as unknown as Record<string, any>);
  installCanvasGlobals(globalThis as unknown as Record<string, any>);
}

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
 */

// Web-only: fail loud and clear when the page is not a secure context.
//
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

// Angular Router v21+ uses AbortController in its navigation pipeline.
// The rsbuild plugin's polyfills.js provides this as preEntry, but this
// defensive polyfill covers consumers not using the plugin.
if (typeof AbortController === 'undefined') {
  class LynxAbortSignal {
    aborted = false;
    reason: unknown = undefined;
    _listeners: ((event: { type: string }) => void)[] = [];
    addEventListener(
      type: string,
      listener: (event: { type: string }) => void,
    ) {
      if (type === 'abort') this._listeners.push(listener);
    }
    removeEventListener(
      type: string,
      listener: (event: { type: string }) => void,
    ) {
      if (type === 'abort') {
        this._listeners = this._listeners.filter((l) => l !== listener);
      }
    }
    dispatchEvent(event: { type: string }) {
      if (event.type === 'abort') {
        for (const listener of this._listeners.slice()) {
          listener(event);
        }
      }
      return true;
    }
    throwIfAborted() {
      if (this.aborted) throw this.reason;
    }
  }
  (globalThis as any).AbortSignal = LynxAbortSignal;
  (globalThis as any).AbortController = class LynxAbortController {
    signal = new LynxAbortSignal();
    abort(reason?: unknown) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      if (reason === undefined) {
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        reason = err;
      }
      this.signal.reason = reason;
      this.signal.dispatchEvent({ type: 'abort' });
    }
  };
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

// Angular's i18n runtime (applyCreateOpCodes / applyMutableOpCodes in
// @angular/core) branches on the DOM `Node` interface's node-type constants
// (Node.COMMENT_NODE / Node.TEXT_NODE / Node.ELEMENT_NODE) to decide whether an
// i18n opcode creates a comment, text, or element node. Any component with an
// `i18n` attribute or a `$localize` string emits these opcodes at bootstrap;
// Lynx's PrimJS has no DOM, so `Node` is undefined and the first opcode throws
// "Node is not defined", aborting bootstrap. The rsbuild plugin's polyfills.js
// provides this as preEntry — this defensive copy covers consumers not using
// the plugin. Must be a class (not a plain object): Angular does `x instanceof
// Node` in a few dev/debug paths, which throws on a non-callable right-hand
// side; as a class it correctly returns false for Lynx elements while the
// static constants (all the opcode dispatcher reads) resolve to spec values.
// The shim alone is the complete fix: once `Node` resolves the opcodes dispatch
// to renderer.createComment() / createText(), which the renderer already
// implements (they also back @if/@for anchors and {{ }} interpolation). The
// `typeof Node === 'undefined'` guard makes it a no-op on the web, where `Node`
// is the real DOM global.
if (typeof Node === 'undefined') {
  try {
    class LynxNode {}
    Object.assign(LynxNode, {
      ELEMENT_NODE: 1,
      ATTRIBUTE_NODE: 2,
      TEXT_NODE: 3,
      CDATA_SECTION_NODE: 4,
      PROCESSING_INSTRUCTION_NODE: 7,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9,
      DOCUMENT_TYPE_NODE: 10,
      DOCUMENT_FRAGMENT_NODE: 11,
      DOCUMENT_POSITION_DISCONNECTED: 1,
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_FOLLOWING: 4,
      DOCUMENT_POSITION_CONTAINS: 8,
      DOCUMENT_POSITION_CONTAINED_BY: 16,
      DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
    });
    (globalThis as any).Node = LynxNode;
  } catch {
    // Read-only where Node is a non-configurable global (web main thread) —
    // Node already exists there, nothing to do.
  }
}

if (typeof document === 'undefined') {
  (globalThis as any).document = {
    // BrowserPlatformLocation uses document.defaultView to get the window
    // for addEventListener('popstate'/'hashchange'). Point to our window mock.
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
  // Read-only in web environment (lynx-view shadows window=void 0 but
  // globalThis.window is a non-configurable getter on the Window object)
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

// BrowserPlatformLocation.onPopState/onHashChange call window.addEventListener.
// Lynx runtime doesn't have this API, so stub it out as a no-op.
if (typeof globalThis.addEventListener !== 'function') {
  (globalThis as any).addEventListener = () => {};
}
if (typeof globalThis.removeEventListener !== 'function') {
  (globalThis as any).removeEventListener = () => {};
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

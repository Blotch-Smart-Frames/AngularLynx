// cspell:words kwift
import type { ApplicationConfig, ApplicationRef, Type } from '@angular/core';
import { bootstrapApplication as ngBootstrapApplication } from '@angular/platform-browser';
import { firstValueFrom, Subject } from 'rxjs';
import { MainThreadElement } from './main-thread/main-thread-element';
import { __pageElementRef } from './lynx-document';
import { markFirstRenderComplete } from './lynx-render-lifecycle';
import { buildElementQueueFromOpcodes } from './ssr/build-element-queue';
import { OpcodeRecorder } from './ssr/opcodes';
import { serializeElementTree } from './ssr/serialize-tree';

// On-device diagnostic: capture the last unhandled error/rejection so Angular
// components can render it via <text>. There is no console on the Lynx device.
// LynxErrorHandler covers Angular-managed errors; these handlers catch crashes
// that escape Angular (native glue code, promise rejections outside zones, etc.).
(globalThis as any).__lynxLastError = '';

const reportToNative = (err: Error): void => {
  if (typeof _ReportError === 'function') {
    _ReportError(err, { errorCode: 1101 });
  }
};

if (typeof (globalThis as any).onerror !== 'function') {
  (globalThis as any).onerror = (
    msg: string | Event,
    _src?: string,
    _line?: number,
    _col?: number,
    err?: Error,
  ) => {
    const e = err ?? new Error(String(msg));
    (globalThis as any).__lynxLastError =
      `${e.name}: ${e.message}\n${e.stack ?? ''}`;
    reportToNative(e);
  };
}
if (typeof (globalThis as any).onunhandledrejection !== 'function') {
  (globalThis as any).onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event?.reason;
    const e =
      reason instanceof Error
        ? reason
        : new Error(`Unhandled rejection: ${String(reason)}`);
    (globalThis as any).__lynxLastError =
      `${e.name}: ${e.message}\n${e.stack ?? ''}`;
    reportToNative(e);
  };
}

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

/**
 * Lynx lifecycle callbacks. The engine calls these globals at specific points:
 * - renderPage: called once when the page is ready to render. On the main thread,
 *   bootstrapApplication() awaits this before calling Angular's bootstrap.
 * - updatePage: called when the host app sends updated data. No-op for now —
 *   Angular's change detection handles reactivity via LynxInitData/LynxGlobalData.
 * - processData: called before data delivery for transformation. Overridden by
 *   registerDataProcessors() if the app needs custom data processing.
 */
// @ts-expect-error
globalThis.renderPage = () => {
  pageReady.next();
};

// @ts-expect-error
globalThis.updatePage = () => {};
// @ts-expect-error
globalThis.processData = () => {};

// SSR (Instant First-Frame Rendering) callbacks — called by the Lynx engine
// to snapshot the element tree after the first render (encode) and to
// reconnect Angular to pre-existing native elements on subsequent loads (hydrate).
if (__ENABLE_SSR__) {
  (globalThis as any).ssrEncode = (): string => {
    if (!__pageElementRef) {
      throw new Error(
        'ssrEncode called before Angular rendered the page element',
      );
    }
    const recorder = new OpcodeRecorder();
    serializeElementTree(__pageElementRef, recorder);
    return JSON.stringify({ __opcodes: recorder.opcodes });
  };

  (globalThis as any).ssrHydrate = (info: string): void => {
    const nativePage = __GetPageElement();
    if (!nativePage) {
      throw new Error('SSR hydration failed: no page element from snapshot');
    }
    const refsMap = __GetTemplateParts(nativePage);
    const { __opcodes } = JSON.parse(info) as { __opcodes: unknown[] };
    const elementQueue = buildElementQueueFromOpcodes(__opcodes, refsMap);

    // Set hydration state for LynxHydrateDocument to consume during
    // Angular's bootstrap. Cleared automatically once hydration completes.
    (globalThis as any).__LYNX_IS_HYDRATING__ = true;
    (globalThis as any).__LYNX_HYDRATE_PAGE__ = nativePage;
    (globalThis as any).__LYNX_HYDRATE_QUEUE__ = elementQueue;
  };
}

/**
 * Worklet registry — mainThreadFn() registers functions here on the main thread;
 * the native engine invokes them via runWorklet when MTS events fire.
 */
const __workletMap: Record<string, Function> = {};
const __mainThreadRefMap: Record<number, { current: unknown }> = {};

/**
 * Pending runOnMainThread Promises keyed by resolveId.
 */
const __pendingResolvers: Record<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
> = {};
let __nextResolveId = 0;

globalThis.registerWorklet = (
  _type: string,
  id: string,
  fn: Function,
): void => {
  __workletMap[id] = fn;
};

globalThis.__workletRefMap = __mainThreadRefMap;

/**
 * Recursively transforms raw Lynx event params into usable objects:
 * - Objects with `elementRefptr` become MainThreadElement wrappers
 * - Objects with `_wvid` resolve to their MainThreadRef instances
 */
const transformParams = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(transformParams);
  const obj = value as Record<string, unknown>;
  if ('elementRefptr' in obj) {
    return new MainThreadElement(obj['elementRefptr'] as any);
  }
  if ('_wvid' in obj) {
    return __mainThreadRefMap[obj['_wvid'] as number] ?? obj;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = transformParams(obj[key]);
  }
  return result;
};

// @ts-expect-error
globalThis.runWorklet = (ctx: unknown, params: unknown[]) => {
  // Legacy path: direct function callbacks (existing event handlers registered
  // via __AddEvent with a raw function value).
  if (typeof ctx === 'function') {
    return ctx(...params);
  }
  // Direct main-thread function handle: `{ _fn }`. Fiber-arch gesture callbacks
  // MUST be objects, not raw functions — the native binding stores a callable
  // callback in GestureCallback.lepus_function_, but the fiber-arch dispatch
  // (touch_event_handler.cc TriggerFiberElementWorklet) only reads
  // lepus_object_, so a function callback is silently dropped and the gesture
  // never fires. The LynxGestureDetector directive therefore wraps each callback
  // as `{ _fn }` (an object → lands in lepus_object_); we unwrap it here. Params
  // are forwarded as-is (like the raw-function path) — the native engine already
  // passes plain event objects.
  if (
    ctx &&
    typeof ctx === 'object' &&
    typeof (ctx as any)._fn === 'function'
  ) {
    return (ctx as any)._fn(...params);
  }
  // Worklet context path: look up by _wkltId
  if (ctx && typeof ctx === 'object' && '_wkltId' in ctx) {
    const fn = __workletMap[(ctx as { _wkltId: string })._wkltId];
    if (fn) {
      const transformed = params.map(transformParams);
      return fn(...transformed);
    }
    if (__DEV__) {
      console.warn(
        `[angular-lynx] Worklet not found: ${(ctx as { _wkltId: string })._wkltId}`,
      );
    }
  }
};

// Cross-thread RPC system. Lynx's JSContext event system is bidirectional:
//   Main → Background: 'Lynx.Worklet.runOnBackground' (request) + 'Lynx.Worklet.BgFunctionCallRet' (response)
//   Background → Main: 'Lynx.Worklet.runWorkletCtx' (request) + 'Lynx.Worklet.FunctionCallRet' (response)
// Each thread registers listeners for incoming requests AND for return values
// from its own outgoing calls. resolveId ties each response to its Promise.
if (__MAIN_THREAD__) {
  try {
    if (typeof lynx !== 'undefined' && (lynx as any).getJSContext) {
      (lynx as any)
        .getJSContext()
        .addEventListener(
          'Lynx.Worklet.runWorkletCtx',
          (event: { data: string }) => {
            const { worklet, params, resolveId } = JSON.parse(event.data);
            const fn = __workletMap[worklet._wkltId];
            let returnValue: unknown;
            let error: string | undefined;
            try {
              returnValue = fn?.(...params);
            } catch (e) {
              error = String(e);
            }
            (lynx as any).getJSContext().dispatchEvent({
              type: 'Lynx.Worklet.FunctionCallRet',
              data: JSON.stringify({ resolveId, returnValue, error }),
            });
          },
        );

      // Listen for return values from background-thread function calls
      (lynx as any)
        .getJSContext()
        .addEventListener(
          'Lynx.Worklet.BgFunctionCallRet',
          (event: { data: string }) => {
            const { resolveId, returnValue, error } = JSON.parse(event.data);
            const resolver = __pendingResolvers[resolveId];
            if (resolver) {
              delete __pendingResolvers[resolveId];
              if (error) {
                resolver.reject(new Error(error));
              } else {
                resolver.resolve(returnValue);
              }
            }
          },
        );
    }
  } catch {
    // lynx.getJSContext() may not be available in all environments
  }

  /**
   * Global runOnBackground — callable from main-thread worklet functions.
   * Dispatches a function call to the background thread and returns a Promise.
   */
  (globalThis as any).runOnBackground = (
    handle: { _wkltId: string },
    ...args: unknown[]
  ): Promise<unknown> => {
    const resolveId = __nextResolveId++;
    return new Promise((resolve, reject) => {
      __pendingResolvers[resolveId] = { resolve, reject };
      try {
        (lynx as any).getJSContext().dispatchEvent({
          type: 'Lynx.Worklet.runOnBackground',
          data: JSON.stringify({
            worklet: { _wkltId: handle._wkltId },
            params: args,
            resolveId,
          }),
        });
      } catch (e) {
        delete __pendingResolvers[resolveId];
        reject(e);
      }
    });
  };
}

// Cross-thread RPC: background thread listens for return values from main thread
// AND for runOnBackground execution requests from main thread
if (!__MAIN_THREAD__) {
  try {
    if (typeof lynx !== 'undefined' && (lynx as any).getJSContext) {
      (lynx as any)
        .getJSContext()
        .addEventListener(
          'Lynx.Worklet.FunctionCallRet',
          (event: { data: string }) => {
            const { resolveId, returnValue, error } = JSON.parse(event.data);
            const resolver = __pendingResolvers[resolveId];
            if (resolver) {
              delete __pendingResolvers[resolveId];
              if (error) {
                resolver.reject(new Error(error));
              } else {
                resolver.resolve(returnValue);
              }
            }
          },
        );

      // Listen for runOnBackground requests from main thread
      (lynx as any)
        .getJSContext()
        .addEventListener(
          'Lynx.Worklet.runOnBackground',
          (event: { data: string }) => {
            const { worklet, params, resolveId } = JSON.parse(event.data);
            const fn = __workletMap[worklet._wkltId];
            let returnValue: unknown;
            let error: string | undefined;
            try {
              returnValue = fn?.(...params);
            } catch (e) {
              error = String(e);
            }
            (lynx as any).getJSContext().dispatchEvent({
              type: 'Lynx.Worklet.BgFunctionCallRet',
              data: JSON.stringify({ resolveId, returnValue, error }),
            });
          },
        );
    }
  } catch {
    // lynx.getJSContext() may not be available in all environments
  }
}

/**
 * Exposed for LynxMainThread service (main-thread.ts) to dispatch cross-thread
 * calls. Can't use import because runtime.ts is evaluated at module load time
 * (side effects) while LynxMainThread is DI-instantiated. Globals bridge the gap.
 */
globalThis.__lynxMtsPendingResolvers = __pendingResolvers;
globalThis.__lynxMtsNextResolveId = () => __nextResolveId++;

/**
 * Synchronously invoke a registered worklet by its _wkltId with raw,
 * already-in-process args. Used by LynxMainThread.runOnMainThread() when it is
 * called from code that is ALREADY running on the main thread — e.g. an Angular
 * `(bind*)`/`(catch*)` event handler, which the renderer registers as a
 * main-thread worklet and Lynx therefore invokes on the Lepus thread. In that
 * situation there is no background→main thread hop to perform, so we run the
 * target worklet in-place instead of dispatching a cross-thread RPC that would
 * have no counterpart to answer it. Mirrors the cross-thread runWorkletCtx
 * listener above, which likewise calls the registered fn with unmodified params.
 * Exposed as a global (rather than imported) because runtime.ts's __workletMap
 * is a module-load side-effect while LynxMainThread is DI-instantiated later.
 */
globalThis.__lynxRunMainThreadWorklet = (
  wkltId: string,
  args: unknown[],
): unknown => {
  const fn = __workletMap[wkltId];
  if (!fn) {
    throw new Error(`[angular-lynx] Main-thread worklet not found: ${wkltId}`);
  }
  return fn(...args);
};

const pageReady = new Subject<void>();

/**
 * Bootstrap Angular application on the Lynx runtime. Waits for the main thread to
 * signal it's ready before initializing the framework, then registers global
 * callbacks for page updates and worklet invocations.
 */
export const bootstrapApplication = async (
  rootComponent: Type<unknown>,
  options?: ApplicationConfig,
): Promise<ApplicationRef> => {
  // HMR re-bootstrap: destroy previous app so Angular's platform accepts a new one.
  // When webpack hot-updates a module and the entry re-evaluates, this function
  // is called again. We destroy the old app (which removes its Lynx elements)
  // and create a fresh one with the updated component definitions.
  const prev = (globalThis as any).__LYNX_ANGULAR_APP_REF__ as
    | ApplicationRef
    | undefined;
  if (prev) {
    prev.destroy();
    (globalThis as any).__LYNX_ANGULAR_APP_REF__ = undefined;
    // Clear worklet registry so re-evaluated modules re-register with fresh IDs
    for (const key of Object.keys(__workletMap)) {
      delete __workletMap[key];
    }
  }

  // On first boot (main thread), wait for Lynx's renderPage callback.
  // On re-bootstrap (HMR), the page is already ready — skip the wait.
  if (__MAIN_THREAD__ && !prev) {
    await firstValueFrom(pageReady);
  }

  const appRef = await ngBootstrapApplication(rootComponent, options);
  // Signal that the initial render is done. This is the point where control
  // has returned from Angular's whole bootstrap, so it's safe to run work that
  // must NOT happen while nested inside native's first renderPage() call —
  // specifically a <list>'s first update-list-info + layout flush, which
  // re-enters componentAtIndex (see lynx-render-lifecycle.ts). Any such update
  // queued during bootstrap was parked by _processUpdate()'s isFirstRenderPending()
  // guard; this call drains it onto a fresh setTimeout macrotask. Placed on the
  // line right after bootstrap resolves (not later) so the flag flips before the
  // first post-bootstrap change-detection cycle's end() hook runs.
  markFirstRenderComplete();
  (globalThis as any).__LYNX_ANGULAR_APP_REF__ = appRef;

  // Clear hydration state so subsequent change detection cycles flush normally.
  const wasHydrating =
    __ENABLE_SSR__ && (globalThis as any).__LYNX_IS_HYDRATING__;
  if (wasHydrating) {
    (globalThis as any).__LYNX_IS_HYDRATING__ = false;
    (globalThis as any).__LYNX_HYDRATE_PAGE__ = undefined;
    (globalThis as any).__LYNX_HYDRATE_QUEUE__ = undefined;
  }

  // Web-only: force the first element-tree flush after bootstrap.
  //
  // LynxRendererFactory2.end() deliberately SKIPS __FlushElementTree() on the
  // very first render (isFirstRenderPending) because the NATIVE engine performs
  // its own implicit flush once renderPage() returns. @lynx-js/web-core has no
  // such implicit flush, and its <lynx-view> reveal + page attach happen INSIDE
  // __FlushElementTree (web-core createElementAPI: rootDom.appendChild(page) +
  // host.style.display = 'flex'). Without an explicit flush the page is never
  // attached and the view stays display:none — so every app renders blank on
  // web until some later change-detection cycle (a tap/signal) happens to flush.
  //
  // Deferred to a macrotask so it runs after web-core's renderPage frame has
  // unwound — the same safe context the <list> first-update flush uses (see
  // lynx-render-lifecycle.ts). __WEB__ is a compile-time define (false on
  // native), so this whole block is dead-code-eliminated from native bundles:
  // native behavior is unchanged. Skipped during SSR hydration, where the
  // snapshot tree already exists and web-core shows the view via its [ssr] CSS
  // attribute (mirrors end()'s hydration guard).
  if (__WEB__ && __MAIN_THREAD__ && !wasHydrating) {
    setTimeout(() => __FlushElementTree(), 0);
  }

  return appRef;
};

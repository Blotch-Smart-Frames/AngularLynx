import { Subject } from 'rxjs';
import { ssrEncode, ssrHydrate } from './ssr/ssr-callbacks';
import {
  __mainThreadRefMap,
  __pendingResolvers,
  __workletMap,
  nextResolveId,
  transformParams,
} from './worklet-bridge';

/**
 * Global callbacks the Lynx engine (and our own DI-instantiated services) invoke
 * by name. Grouped here — separate from bootstrapApplication and the environment
 * polyfills — because they share the worklet registry from worklet-bridge.ts and
 * are all installed as module-load side effects: the engine may call any of them
 * before Angular's bootstrap resolves. Imported for its side effects; only
 * `pageReady` is re-exported (bootstrapApplication awaits it).
 */

/**
 * Resolves when the Lynx engine signals the page is ready to render.
 * `renderPage` (below) fires it; bootstrapApplication awaits it on the main
 * thread before handing control to Angular.
 */
export const pageReady = new Subject<void>();

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
// to snapshot the element tree after the first render (encode) and to reconnect
// Angular to pre-existing native elements on subsequent loads (hydrate). The
// callback bodies live in ssr/ssr-callbacks.ts (unit-tested there); this only
// wires them onto the engine globals when SSR is enabled.
if (__ENABLE_SSR__) {
  (globalThis as any).ssrEncode = ssrEncode;
  (globalThis as any).ssrHydrate = ssrHydrate;
}

globalThis.registerWorklet = (
  _type: string,
  id: string,
  fn: Function,
): void => {
  __workletMap[id] = fn;
};

globalThis.__workletRefMap = __mainThreadRefMap;

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
    const resolveId = nextResolveId();
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
 * calls. Can't use import because these globals bridge module-load side effects
 * (this file) with a DI-instantiated consumer (LynxMainThread).
 */
globalThis.__lynxMtsPendingResolvers = __pendingResolvers;
globalThis.__lynxMtsNextResolveId = nextResolveId;

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
 * Exposed as a global (rather than imported) because the __workletMap is a
 * module-load side-effect while LynxMainThread is DI-instantiated later.
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

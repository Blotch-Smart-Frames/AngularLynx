import { Injectable } from '@angular/core';
import type { MainThreadFnHandle } from './main-thread-fn';

/**
 * Injectable service for calling main-thread (Lepus) functions. From the
 * background thread it uses Lynx's cross-thread RPC via JSContext events:
 *
 *   background calls runOnMainThread(handle, ...args)
 *   → dispatches 'Lynx.Worklet.runWorkletCtx' with { worklet, params, resolveId }
 *   → main thread's listener (in runtime.ts) invokes the registered worklet fn
 *   → dispatches 'Lynx.Worklet.FunctionCallRet' with { resolveId, returnValue }
 *   → background thread's listener resolves the Promise
 *
 * This enables background-thread Angular code (services, effects) to trigger
 * main-thread imperative operations (animate, measure, invoke UI methods)
 * with proper async/await ergonomics.
 *
 * It is also safe to call from code already running on the main thread. The
 * renderer registers Angular `(bind*)`/`(catch*)` event handlers as main-thread
 * worklets, so a handler like `(bindtap)="flash()"` executes on the Lepus thread
 * — and any runOnMainThread() call it makes originates there too. Rather than
 * fail (there is no other thread to be "called from"), we detect that case and
 * invoke the target worklet in-place, so the same call site works regardless of
 * which thread reaches it.
 */
@Injectable({ providedIn: 'root' })
export class LynxMainThread {
  runOnMainThread<TArgs extends unknown[], TReturn>(
    handle: MainThreadFnHandle<TArgs, TReturn>,
    ...args: TArgs
  ): Promise<TReturn> {
    if (__MAIN_THREAD__) {
      // Already on the main thread — run the worklet directly instead of an RPC
      // round trip to ourselves (which would never be answered). No JSON
      // serialization guard here: args stay in-process, so non-serializable
      // values (element handles, MainThreadRefs) are passed through intact.
      const invokeDirect = (globalThis as any).__lynxRunMainThreadWorklet as
        | ((wkltId: string, a: unknown[]) => TReturn)
        | undefined;
      if (!invokeDirect) {
        return Promise.reject(
          new Error(
            '[angular-lynx] runOnMainThread() called on the main thread before the runtime worklet registry was initialized',
          ),
        );
      }
      try {
        return Promise.resolve(invokeDirect(handle._wkltId, args));
      } catch (e) {
        return Promise.reject(e);
      }
    }

    // Cross-thread params are JSON-serialized via dispatchEvent — non-serializable
    // values (functions, circular refs) would silently become null/undefined on the
    // main thread, leading to hard-to-debug runtime errors.
    if (__DEV__) {
      try {
        JSON.stringify(args);
      } catch {
        throw new Error(
          '[angular-lynx] MTS arguments must be JSON-serializable',
        );
      }
    }

    const resolveId = (globalThis as any).__lynxMtsNextResolveId();
    const pendingResolvers = (globalThis as any).__lynxMtsPendingResolvers;

    return new Promise<TReturn>((resolve, reject) => {
      pendingResolvers[resolveId] = { resolve, reject };

      try {
        (lynx as any).getCoreContext().dispatchEvent({
          type: 'Lynx.Worklet.runWorkletCtx',
          data: JSON.stringify({
            worklet: { _wkltId: handle._wkltId },
            params: args,
            resolveId,
          }),
        });
      } catch (e) {
        delete pendingResolvers[resolveId];
        reject(e);
      }
    });
  }
}

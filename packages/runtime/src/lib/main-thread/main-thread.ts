import { Injectable } from '@angular/core';
import type { MainThreadFnHandle } from './main-thread-fn';

/**
 * Injectable service for calling main-thread (Lepus) functions from Angular
 * code, and getting their return values.
 *
 * Angular runs on the main thread only (see bootstrapApplication), so the
 * call never crosses threads: it invokes the registered worklet in place,
 * with the arguments as they are, and resolves with its result. Non-
 * serializable values (element handles, MainThreadRefs) pass through intact.
 *
 * It used to send the call across threads when it ran on the background
 * thread, for the copy of the app that booted there too. That copy is gone
 * (issue #81), and with it the background-to-main call channel.
 */
@Injectable({ providedIn: 'root' })
export class LynxMainThread {
  runOnMainThread<TArgs extends unknown[], TReturn>(
    handle: MainThreadFnHandle<TArgs, TReturn>,
    ...args: TArgs
  ): Promise<TReturn> {
    const invokeDirect = (globalThis as any).__lynxRunMainThreadWorklet as
      | ((wkltId: string, a: unknown[]) => TReturn)
      | undefined;
    if (!invokeDirect) {
      return Promise.reject(
        new Error(
          '[angular-lynx] runOnMainThread() called before the runtime worklet registry was initialized',
        ),
      );
    }
    try {
      return Promise.resolve(invokeDirect(handle._wkltId, args));
    } catch (e) {
      return Promise.reject(e);
    }
  }
}

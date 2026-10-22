import { DestroyRef, inject } from '@angular/core';
import { __workletMap } from '../worklet-bridge';

/**
 * Both thread bundles evaluate the same module graph in the same order,
 * so this counter produces matching IDs without a compiler plugin.
 */
let nextWorkletId = 0;

/**
 * Type definition for main-thread function handles used by {@link mainThreadFn}.
 */
export type MainThreadFnHandle<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = {
  readonly _wkltId: string;
  readonly _workletType: 'main-thread';
  readonly __isMainThreadFn: true;
  // Phantom types for call-site type checking — not used at runtime
  readonly __args?: TArgs;
  readonly __return?: TReturn;
};

/**
 * The DestroyRef of the component, directive or service being constructed, or
 * null outside an injection context, such as at module level. Angular has no
 * public check for an injection context, and `inject()` throws outside one.
 */
const constructorDestroyRef = (): DestroyRef | null => {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
};

export const mainThreadFn = <TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): MainThreadFnHandle<TArgs, TReturn> => {
  const id = '__angular_mts_' + nextWorkletId++;

  if (__MAIN_THREAD__) {
    globalThis.registerWorklet('main-thread', id, fn);
    // A class property with the 'main thread' directive becomes a
    // mainThreadFn() call in the constructor, so each instance registers its
    // own function. Releasing it with the instance keeps a component that's
    // created many times, such as a list row, from piling up registrations.
    constructorDestroyRef()?.onDestroy(() => {
      delete __workletMap[id];
    });
  }

  return {
    _wkltId: id,
    _workletType: 'main-thread',
    __isMainThreadFn: true,
  } as MainThreadFnHandle<TArgs, TReturn>;
};

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

export const mainThreadFn = <TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): MainThreadFnHandle<TArgs, TReturn> => {
  const id = '__angular_mts_' + nextWorkletId++;

  if (__MAIN_THREAD__) {
    globalThis.registerWorklet('main-thread', id, fn);
  }

  return {
    _wkltId: id,
    _workletType: 'main-thread',
    __isMainThreadFn: true,
  } as MainThreadFnHandle<TArgs, TReturn>;
};

/**
 * Reset counter on HMR — called from runtime.ts before modules re-evaluate.
 */
export const __resetWorkletCounter = (): void => {
  nextWorkletId = 0;
};

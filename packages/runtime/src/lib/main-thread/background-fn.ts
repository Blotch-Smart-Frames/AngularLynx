/**
 * Counter stays in sync across threads because the build plugin produces
 * two bundles (main + background) from the same source. Both evaluate the
 * same module graph in the same order, so the N-th backgroundFn() call
 * produces ID '__angular_bg_N' on both threads. The main thread can then
 * dispatch a call to a background function by its _wkltId string, and the
 * background thread resolves it to the correct registered function.
 */
let nextBgWorkletId = 0;

/**
 * Type definition for background function handles used by {@link backgroundFn}.
 */
export type BackgroundFnHandle<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = {
  readonly _wkltId: string;
  readonly _workletType: 'background';
  readonly __isBackgroundFn: true;
  readonly __args?: TArgs;
  readonly __return?: TReturn;
};

export const backgroundFn = <TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): BackgroundFnHandle<TArgs, TReturn> => {
  const id = '__angular_bg_' + nextBgWorkletId++;

  if (!__MAIN_THREAD__) {
    globalThis.registerWorklet('background', id, fn);
  }

  return {
    _wkltId: id,
    _workletType: 'background',
    __isBackgroundFn: true,
  } as BackgroundFnHandle<TArgs, TReturn>;
};

/**
 * Reset counter on HMR.
 */
export const __resetBgWorkletCounter = (): void => {
  nextBgWorkletId = 0;
};

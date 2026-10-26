/**
 * The main thread calls a background function by its `_wkltId`, and the
 * background thread finds the function it registered under the same ID. A
 * module that calls backgroundFn() at module level runs on both threads: the
 * background thread's entry imports every such module at startup
 * (background-entry.ts in the build plugin). The build gives each such call an
 * ID from its file and position (cross-thread-transform.ts there), which
 * matches on both threads whatever order their modules load in.
 *
 * A call the build doesn't tag, such as one inside a function, takes the next
 * '__angular_bg_N' instead. That only matches if both threads make the same
 * calls in the same order, and Angular code such as a constructor runs on the
 * main thread only, so its handle reaches no function.
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

/**
 * Registers `fn` on the background thread and returns a handle that
 * `runOnBackground()` calls it with from the main thread.
 *
 * @param fn - The function to run on the background thread.
 * @param id - Set by the build for a module-level call, so the handle has the
 *   same ID on both threads. Don't pass it yourself.
 * @returns The handle.
 */
export const backgroundFn = <TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  id?: string,
): BackgroundFnHandle<TArgs, TReturn> => {
  const workletId = id ?? '__angular_bg_' + nextBgWorkletId++;

  if (!__MAIN_THREAD__) {
    globalThis.registerWorklet('background', workletId, fn);
  }

  return {
    _wkltId: workletId,
    _workletType: 'background',
    __isBackgroundFn: true,
  } as BackgroundFnHandle<TArgs, TReturn>;
};

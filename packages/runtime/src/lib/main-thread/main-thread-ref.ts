import { __mainThreadRefMap } from '../worklet-bridge';

/**
 * Cross-thread shared reference. Each thread has its own instance, found by
 * its _wvid in __mainThreadRefMap (also the `__workletRefMap` global).
 * When a MainThreadRef is passed as a param to runOnMainThread() or
 * runOnBackground(), JSON.stringify serializes it via toJSON() → { _wvid }.
 * The receiving thread's cross-thread listener (global-callbacks.ts) swaps the
 * marker for its own instance from the map, so the function gets the ref it
 * would also reach through its closure.
 *
 * A ref created at module level exists on both threads, since both bundles run
 * every module. The build gives each such call an ID from its file and
 * position (cross-thread-transform.ts in the build plugin), so it matches on
 * both threads whatever order their modules run in. A ref created anywhere
 * else, such as in a component, exists only on the main thread, where Angular
 * runs, and takes the next number instead.
 */
let nextRefId = 0;

export class MainThreadRef<T> {
  readonly _wvid: number | string;
  #_value: T;

  /**
   * @param initValue - The ref's starting value.
   * @param id - Set by the build for a ref created at module level, so the
   *   ref has the same ID on both threads. Don't pass it yourself.
   */
  constructor(initValue: T, id?: string) {
    this._wvid = id ?? nextRefId++;
    this.#_value = initValue;

    // Both threads register: a ref passed to the other thread arrives as a
    // { _wvid } marker that the receiving thread resolves here.
    __mainThreadRefMap[this._wvid] = this;
  }

  get current(): T {
    return this.#_value;
  }

  set current(value: T) {
    this.#_value = value;
  }

  /**
   * Serialization hook for cross-thread transfer. JSON.stringify calls this
   * when the ref is passed as a param to dispatchEvent (MTS/background RPC).
   * The receiving thread resolves { _wvid } back to its own registered
   * MainThreadRef instance.
   */
  toJSON(): { _wvid: number | string } {
    return { _wvid: this._wvid };
  }
}

/**
 * Creates a {@link MainThreadRef}.
 *
 * @param initValue - The ref's starting value.
 * @param id - Set by the build for a ref created at module level. Don't pass
 *   it yourself.
 * @returns The new ref.
 */
export const createMainThreadRef = <T>(
  initValue: T,
  id?: string,
): MainThreadRef<T> => new MainThreadRef(initValue, id);

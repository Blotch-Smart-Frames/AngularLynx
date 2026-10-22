import { __mainThreadRefMap } from '../worklet-bridge';

/**
 * Cross-thread shared reference. Each thread has its own instance, found by
 * its _wvid in __mainThreadRefMap (also the `__workletRefMap` global).
 * When a MainThreadRef is passed as a param to runOnMainThread() or
 * runOnBackground(), JSON.stringify serializes it via toJSON() → { _wvid: N }.
 * The receiving thread's cross-thread listener (global-callbacks.ts) swaps the
 * marker for its own instance from the map, so the function gets the ref it
 * would also reach through its closure.
 * Counter stays in sync across threads because both bundles evaluate the
 * same module graph in the same order (same mechanism as mainThreadFn/backgroundFn).
 */
let nextRefId = 0;

export class MainThreadRef<T> {
  readonly _wvid: number;
  #_value: T;

  constructor(initValue: T) {
    this._wvid = nextRefId++;
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
  toJSON(): { _wvid: number } {
    return { _wvid: this._wvid };
  }
}

export const createMainThreadRef = <T>(initValue: T): MainThreadRef<T> =>
  new MainThreadRef(initValue);

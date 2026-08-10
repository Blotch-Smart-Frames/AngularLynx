/**
 * Cross-thread shared reference. The background thread holds the JS object;
 * the main thread accesses it by _wvid lookup in __workletRefMap.
 * When a MainThreadRef is passed as a param to runOnMainThread(), JSON.stringify
 * serializes it via toJSON() → { _wvid: N }. On the main thread, runtime.ts's
 * transformParams() reconstitutes the reference from __workletRefMap[_wvid].
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

    // Only register on the main thread — that's where lookups happen.
    // Background thread keeps its own instance but never registers it;
    // it uses the ref directly via .current.
    if (__MAIN_THREAD__) {
      (globalThis as any).__workletRefMap[this._wvid] = this;
    }
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
   * The receiving thread's transformParams() resolves { _wvid } back to the
   * registered MainThreadRef instance.
   */
  toJSON(): { _wvid: number } {
    return { _wvid: this._wvid };
  }
}

export const createMainThreadRef = <T>(initValue: T): MainThreadRef<T> =>
  new MainThreadRef(initValue);

/**
 * Reset counter on HMR.
 */
export const __resetRefCounter = (): void => {
  nextRefId = 0;
};

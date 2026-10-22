import { MainThreadElement } from './main-thread/main-thread-element';

/**
 * Worklet registry state + the pure param transform shared by every worklet
 * entry point.
 *
 * Kept in its own module (rather than inline in runtime.ts) so the worklet
 * registry is a single, importable source of truth: the global callbacks that
 * register/invoke worklets (global-callbacks.ts), the cross-thread RPC bridge,
 * and bootstrapApplication's HMR reset all reference these exact maps. Nothing
 * here touches `globalThis` — that keeps `transformParams` a pure function that
 * can be unit-tested directly, without booting the whole runtime.
 */

/**
 * Worklet registry — `mainThreadFn()`/`backgroundFn()` register functions here
 * on their owning thread; the native engine invokes them via `runWorklet` when
 * MTS events fire.
 */
export const __workletMap: Record<string, Function> = {};

/**
 * MainThreadRef store, keyed by `_wvid`. `transformParams` and `restoreRefs`
 * reconstitute a ref from this map when they see a `{ _wvid }` marker in
 * params, and MainThreadRef registers itself here on creation, on both threads.
 */
export const __mainThreadRefMap: Record<number | string, { current: unknown }> =
  {};

/**
 * Pending runOnBackground() Promises keyed by `resolveId`. The main thread's
 * listener settles an entry when the background thread's reply arrives.
 */
export const __pendingResolvers: Record<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
> = {};

// Monotonic id for correlating an outgoing RPC request with its response.
// A module-local `let` cannot be mutated through an ES import binding, so the
// counter is only ever advanced through `nextResolveId()`.
let __nextResolveId = 0;

/**
 * Returns the next unique resolve id, advancing the counter. Exposed as a
 * function (not the raw `let`) so callers in other modules share one
 * monotonic sequence.
 */
export const nextResolveId = (): number => __nextResolveId++;

/**
 * Rebuilds `value` with every `{ _wvid }` marker resolved to its MainThreadRef
 * and, when `elements` is set, every `{ elementRefptr }` wrapped as a
 * MainThreadElement.
 */
const transform = (value: unknown, elements: boolean): unknown => {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => transform(item, elements));
  }
  const obj = value as Record<string, unknown>;
  if (elements && 'elementRefptr' in obj) {
    return new MainThreadElement(obj['elementRefptr'] as any);
  }
  if ('_wvid' in obj) {
    return __mainThreadRefMap[obj['_wvid'] as number | string] ?? obj;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = transform(obj[key], elements);
  }
  return result;
};

/**
 * Recursively transforms raw Lynx event params into usable objects:
 * - Objects with `elementRefptr` become MainThreadElement wrappers
 * - Objects with `_wvid` resolve to their MainThreadRef instances
 *
 * Pure: reads `__mainThreadRefMap` but never mutates global state, so the whole
 * transform can be exercised in isolation.
 */
export const transformParams = (value: unknown): unknown =>
  transform(value, true);

/**
 * Resolves the `{ _wvid }` markers in the arguments the main thread sends a
 * background function to this thread's MainThreadRef, the copy the function
 * would also see through its closure. Element handles are left alone: a
 * MainThreadElement only works on the main thread.
 */
export const restoreRefs = (value: unknown): unknown => transform(value, false);

/**
 * Whether `value` is a promise, or any thenable an async function can return.
 */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null | undefined)?.then === 'function';

/**
 * The text a failed call sends back. The caller rejects with `new Error(text)`,
 * so an Error sends its message: `String(error)` would come out as
 * "Error: Error: offline".
 */
const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Runs a function the other thread called and sends it the result, as the
 * JSON `{ resolveId, returnValue }` or `{ resolveId, error }` its pending
 * Promise settles from.
 *
 * A returned promise is awaited first, so an async function (anything that
 * awaits `fetch`) delivers its result rather than a promise, which JSON turns
 * into `{}`, and its rejection reaches the caller instead of going unhandled.
 * React Lynx doesn't await here (run-on-background.ts sends `f(...params)` as
 * is), so this is one place not to copy it: fetching on the background thread
 * is the main reason to call it.
 * A synchronous result is sent right away, without a microtask in between.
 * A result JSON can't encode, such as a circular object, is sent as an error,
 * so the caller doesn't wait forever.
 */
export const answerCall = (
  resolveId: number,
  run: () => unknown,
  send: (data: string) => void,
): void => {
  const reply = (result: { returnValue?: unknown; error?: string }): void => {
    let data: string;
    try {
      data = JSON.stringify({ resolveId, ...result });
    } catch (e) {
      data = JSON.stringify({
        resolveId,
        error: `[angular-lynx] The return value can't be sent to the other thread: ${errorText(e)}`,
      });
    }
    send(data);
  };
  let returnValue: unknown;
  try {
    returnValue = run();
  } catch (e) {
    reply({ error: errorText(e) });
    return;
  }
  if (isThenable(returnValue)) {
    returnValue.then(
      (value) => reply({ returnValue: value }),
      (e: unknown) => reply({ error: errorText(e) }),
    );
  } else {
    reply({ returnValue });
  }
};

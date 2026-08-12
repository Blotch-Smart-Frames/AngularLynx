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
 * MainThreadRef store, keyed by `_wvid`. `transformParams` reconstitutes a ref
 * from this map when it sees a `{ _wvid }` marker in event params, and
 * MainThreadRef registers itself here on creation.
 */
export const __mainThreadRefMap: Record<number, { current: unknown }> = {};

/**
 * Pending cross-thread RPC Promises keyed by `resolveId`. Both the main- and
 * background-thread RPC listeners settle entries here when a return value
 * arrives, and LynxMainThread parks its resolvers here while a call is in
 * flight.
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
 * function (not the raw `let`) so callers in other modules — and the
 * `__lynxMtsNextResolveId` global — share one monotonic sequence.
 */
export const nextResolveId = (): number => __nextResolveId++;

/**
 * Recursively transforms raw Lynx event params into usable objects:
 * - Objects with `elementRefptr` become MainThreadElement wrappers
 * - Objects with `_wvid` resolve to their MainThreadRef instances
 *
 * Pure: reads `__mainThreadRefMap` but never mutates global state, so the whole
 * transform can be exercised in isolation.
 */
export const transformParams = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(transformParams);
  const obj = value as Record<string, unknown>;
  if ('elementRefptr' in obj) {
    return new MainThreadElement(obj['elementRefptr'] as any);
  }
  if ('_wvid' in obj) {
    return __mainThreadRefMap[obj['_wvid'] as number] ?? obj;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = transformParams(obj[key]);
  }
  return result;
};

/**
 * Profiling counters collected by the renderer during a session.
 * Only populated when the app is built with `__PROFILE__` enabled —
 * in production, instrumentation is dead-code-eliminated and all values stay 0.
 */
export type DevToolsStats = {
  // Number of Angular change detection cycles run since boot (or last reset).
  cdCycles: number;
  // Total Lynx elements created via __Create* calls since boot.
  elementCreated: number;
  // Total Lynx elements removed via __RemoveElement since boot.
  elementRemoved: number;
  // Number of times the renderer flushed a batch of element operations.
  flushCount: number;
  // Wall-clock duration of the most recent change detection cycle, in ms.
  lastCdDurationMs: number;
};

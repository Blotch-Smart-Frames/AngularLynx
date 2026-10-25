/**
 * Profiling counters collected by the renderer during a session.
 * Only populated in development builds, where `__PROFILE__` is true — in
 * production, instrumentation is dead-code-eliminated and all values stay 0.
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
  // Wall-clock duration of the most recent change detection cycle, in ms,
  // including the flush that sends its changes to Lynx.
  lastCdDurationMs: number;
};

/**
 * Options for `LynxPerformance.profileStart()` and `profileMark()`. The same
 * shape as Lynx's own `TraceOption`; `performance.ts` passes it to Lynx as
 * one, so the compiler keeps the two in step.
 */
export type LynxTraceOptions = {
  // Links this trace to the others with the same ID, from profileFlowId().
  // Lynx ignores it when flowIds is set.
  flowId?: number;
  // Links this trace to several flows at once.
  flowIds?: number[];
  // Values recorded with the trace. Strings only: Lynx drops any other value.
  args?: Record<string, string>;
};

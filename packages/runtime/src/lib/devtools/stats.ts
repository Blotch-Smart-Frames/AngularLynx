import type { DevToolsStats } from './devtools.types';

/**
 * Module-level counters for hot-path instrumentation.
 * Plain object avoids DI/signal overhead on every element operation.
 * Only incremented when __PROFILE__ is true (dead-code-eliminated otherwise).
 */
export const devStats: DevToolsStats & { reset(): void } = {
  cdCycles: 0,
  elementCreated: 0,
  elementRemoved: 0,
  flushCount: 0,
  lastCdDurationMs: 0,

  reset(): void {
    this.cdCycles = 0;
    this.elementCreated = 0;
    this.elementRemoved = 0;
    this.flushCount = 0;
    this.lastCdDurationMs = 0;
  },
};

/**
 * The current time in ms. Native Lynx has no `performance` global on either
 * thread; the web preview has one, and it times below a millisecond.
 * `Date.now()` is everywhere.
 */
const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

// One start time per change-detection cycle in progress. A stack rather than a
// single value because cycles nest: a `detectChanges()` call during a tick
// runs its own begin()/end() pair inside the tick's, and the tick's duration
// must not start at the inner one's start.
const cdStartTimes: number[] = [];

/**
 * Starts timing a change-detection cycle. The renderer factory calls it from
 * `begin()`, and `endCdTiming()` from `end()`.
 */
export const startCdTiming = (): void => {
  cdStartTimes.push(now());
};

/**
 * Stops timing the innermost change-detection cycle in progress, and records
 * its duration in `devStats.lastCdDurationMs`.
 */
export const endCdTiming = (): void => {
  const start = cdStartTimes.pop();
  if (start !== undefined) {
    devStats.lastCdDurationMs = now() - start;
  }
};

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

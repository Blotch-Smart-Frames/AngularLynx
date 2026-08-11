import { Injectable, signal, computed } from '@angular/core';
import type { DevToolsStats } from './devtools.types';
import { devStats } from './stats';

/**
 * High-level DevTools service exposing performance stats as Angular signals.
 *
 * Stats are only meaningful when the app is built with `__PROFILE__` enabled.
 * In production builds, counters are never incremented (the instrumentation
 * code is dead-code-eliminated), so all values remain zero.
 *
 * @usageNotes
 * ```typescript
 * const devtools = inject(LynxDevTools);
 *
 * // Read stats reactively in a template
 * <text>CD cycles: {{ devtools.stats().cdCycles }}</text>
 *
 * // Take a one-shot snapshot
 * const snap = devtools.snapshot();
 * console.log('Elements created:', snap.elementCreated);
 *
 * // Reset counters
 * devtools.reset();
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxDevTools {
  // `#tick` is a "refresh trigger" signal. Reading it inside the `stats`
  // computed creates a reactive dependency: when `refresh()` increments it,
  // Angular invalidates the computed and re-runs it, picking up fresh values
  // from the plain `devStats` object. Without this, `stats` would be computed
  // once and never update (plain objects aren't reactive).
  readonly #tick = signal(0);

  /**
   * Reactive stats snapshot. Re-reads from `devStats` each time
   * `refresh()` is called, or automatically after `reset()`.
   */
  readonly stats = computed<DevToolsStats>(() => {
    this.#tick();
    return {
      cdCycles: devStats.cdCycles,
      elementCreated: devStats.elementCreated,
      elementRemoved: devStats.elementRemoved,
      flushCount: devStats.flushCount,
      lastCdDurationMs: devStats.lastCdDurationMs,
    };
  });

  /**
   * Take a non-reactive snapshot of current counters.
   */
  snapshot(): DevToolsStats {
    return {
      cdCycles: devStats.cdCycles,
      elementCreated: devStats.elementCreated,
      elementRemoved: devStats.elementRemoved,
      flushCount: devStats.flushCount,
      lastCdDurationMs: devStats.lastCdDurationMs,
    };
  }

  /**
   * Bump the signal so `stats()` re-evaluates with latest counter values.
   */
  refresh(): void {
    this.#tick.update((n) => n + 1);
  }

  /**
   * Zero all counters and update the reactive signal.
   */
  reset(): void {
    devStats.reset();
    this.#tick.update((n) => n + 1);
  }
}

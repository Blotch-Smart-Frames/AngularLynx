import { Injectable } from '@angular/core';
import type { CommonPerformance } from '@lynx-js/types';
import type { LynxTraceOptions } from './devtools.types';

/**
 * Wraps Lynx's native performance tracing APIs (`lynx.performance`).
 *
 * All methods are no-ops when `lynx.performance` is unavailable (e.g. in tests
 * or non-Lynx environments) or when profiling is not actively recording.
 *
 * Unlike the `LynxDevTools` counters, the calls aren't gated by `__PROFILE__`,
 * so they stay in production builds. A trace is worth recording from the build
 * you ship, without development mode's extra work in it. They cost little
 * there: release builds of the Lynx engine compile tracing out, so each call
 * returns at once.
 *
 * @usageNotes
 * ```typescript
 * const perf = inject(LynxPerformance);
 *
 * perf.profileStart('MyComponent::render', { args: { itemCount: '42' } });
 * // ... do work ...
 * perf.profileEnd();
 *
 * perf.profileMark('dataLoaded', { args: { source: 'cache' } });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxPerformance {
  // Partial: each method is checked before it's called, in case an engine
  // lacks it.
  #perf: Partial<CommonPerformance> | null = this.#resolve();

  #resolve(): Partial<CommonPerformance> | null {
    if (typeof lynx !== 'undefined' && (lynx as any).performance) {
      return (lynx as any).performance;
    }
    return null;
  }

  /**
   * Whether profiling is actively recording traces.
   * Returns false when `lynx.performance` is unavailable.
   */
  isRecording(): boolean {
    return this.#perf?.isProfileRecording?.() ?? false;
  }

  /**
   * Begin a named trace. Must be paired with `profileEnd()`.
   * Traces nest — multiple `profileStart` calls create a stack.
   */
  profileStart(name: string, options?: LynxTraceOptions): void {
    this.#perf?.profileStart?.(name, options);
  }

  /**
   * End the current trace (top of the trace stack).
   */
  profileEnd(): void {
    this.#perf?.profileEnd?.();
  }

  /**
   * Emit a discrete mark event in the trace timeline.
   */
  profileMark(name: string, options?: LynxTraceOptions): void {
    this.#perf?.profileMark?.(name, options);
  }

  /**
   * Generate a unique flow ID for correlating multi-threaded traces.
   */
  profileFlowId(): number {
    return this.#perf?.profileFlowId?.() ?? 0;
  }
}

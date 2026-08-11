import { Injectable } from '@angular/core';

/**
 * Wraps Lynx's native performance tracing APIs (`lynx.performance`).
 *
 * All methods are no-ops when `lynx.performance` is unavailable (e.g. in tests
 * or non-Lynx environments) or when profiling is not actively recording.
 *
 * @usageNotes
 * ```typescript
 * const perf = inject(LynxPerformance);
 *
 * perf.profileStart('MyComponent::render', { itemCount: 42 });
 * // ... do work ...
 * perf.profileEnd();
 *
 * perf.profileMark('dataLoaded', { source: 'cache' });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxPerformance {
  #perf: LynxPerformanceAPI | null = this.#resolve();

  #resolve(): LynxPerformanceAPI | null {
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
  profileStart(
    name: string,
    options?: { flowId?: number; args?: Record<string, unknown> },
  ): void {
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
  profileMark(
    name: string,
    options?: { args?: Record<string, unknown> },
  ): void {
    this.#perf?.profileMark?.(name, options);
  }

  /**
   * Generate a unique flow ID for correlating multi-threaded traces.
   */
  profileFlowId(): number {
    return this.#perf?.profileFlowId?.() ?? 0;
  }
}

type LynxPerformanceAPI = {
  profileStart?(
    name: string,
    options?: {
      flowId?: number;
      flowIds?: number[];
      args?: Record<string, unknown>;
    },
  ): void;
  profileEnd?(): void;
  profileMark?(
    name: string,
    options?: { args?: Record<string, unknown> },
  ): void;
  profileFlowId?(): number;
  isProfileRecording?(): boolean;
};

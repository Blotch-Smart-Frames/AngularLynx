import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as LifecycleModule from './lynx-render-lifecycle';

/**
 * The first-render latch is module-level state that flips exactly once and never
 * resets, so each test imports a fresh module instance to control its starting
 * point deterministically.
 */
const load = async (): Promise<typeof LifecycleModule> => {
  vi.resetModules();
  return import('./lynx-render-lifecycle');
};

describe('lynx-render-lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the first render as pending on a fresh module', async () => {
    const m = await load();
    expect(m.isFirstRenderPending()).toBe(true);
  });

  it('queues callbacks while pending and drains them on a macrotask when complete', async () => {
    const m = await load();
    vi.useFakeTimers();

    const cb = vi.fn();
    m.runAfterFirstRender(cb);
    // Still pending — the callback is parked, not run.
    expect(cb).not.toHaveBeenCalled();

    m.markFirstRenderComplete();
    expect(m.isFirstRenderPending()).toBe(false);
    // Drained onto a setTimeout(0), so not yet run synchronously.
    expect(cb).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('runs callbacks immediately once the first render has completed', async () => {
    const m = await load();
    // No deferred work → markFirstRenderComplete just flips the latch.
    m.markFirstRenderComplete();

    const cb = vi.fn();
    m.runAfterFirstRender(cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('markFirstRenderComplete is a no-op when nothing was queued', async () => {
    const m = await load();
    expect(() => m.markFirstRenderComplete()).not.toThrow();
  });

  it('tracks the inside-change-detection flag', async () => {
    const m = await load();
    expect(m.isInsideChangeDetection()).toBe(false);
    m.setInsideChangeDetection(true);
    expect(m.isInsideChangeDetection()).toBe(true);
    m.setInsideChangeDetection(false);
    expect(m.isInsideChangeDetection()).toBe(false);
  });
});

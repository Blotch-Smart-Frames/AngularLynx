import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markFirstRenderComplete,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import { scheduleSettleFlush } from './lynx-element';

/**
 * scheduleSettleFlush() is the safety-net flush for native content created
 * OUTSIDE a begin()/end() change-detection cycle — the lazy-loaded-route case
 * where end() never runs to flush it (see the function's doc comment and the
 * mirroring guard in LynxListElement.#scheduleUpdate). These tests drive it
 * directly with a mocked __FlushElementTree.
 *
 * firstRenderPending is module-global and starts true; markFirstRenderComplete()
 * flips it once and never resets. Vitest isolates module state per FILE, so this
 * spec owns that latch: the first test asserts the pre-first-render no-op, then
 * flips it for the rest.
 */

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

describe('scheduleSettleFlush', () => {
  beforeEach(() => {
    (globalThis as any).__FlushElementTree = vi.fn();
    setInsideChangeDetection(false);
  });

  afterEach(async () => {
    // Drain any pending coalesced microtask so it can't leak into the next test.
    await flushMicrotasks();
  });

  it('does NOT flush while the first render is still pending', async () => {
    // Native performs its own implicit flush after renderPage during bootstrap.
    scheduleSettleFlush();
    await flushMicrotasks();
    expect((globalThis as any).__FlushElementTree).not.toHaveBeenCalled();
  });

  it('flushes once, on a microtask, for content created outside a CD cycle', async () => {
    // Everything below runs post-first-render.
    markFirstRenderComplete();

    scheduleSettleFlush();
    // Not synchronous — deferred to a microtask so all of the out-of-cycle
    // creation/attachment lands first.
    expect((globalThis as any).__FlushElementTree).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect((globalThis as any).__FlushElementTree).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple calls into a single flush', async () => {
    scheduleSettleFlush();
    scheduleSettleFlush();
    scheduleSettleFlush();

    await flushMicrotasks();
    expect((globalThis as any).__FlushElementTree).toHaveBeenCalledTimes(1);
  });

  it('does NOT schedule a flush while inside a CD cycle (end() will flush)', async () => {
    setInsideChangeDetection(true);
    scheduleSettleFlush();

    await flushMicrotasks();
    expect((globalThis as any).__FlushElementTree).not.toHaveBeenCalled();
  });

  it('skips the flush if a CD cycle begins before the microtask runs', async () => {
    // Content is created out-of-cycle (schedules the microtask), but a CD cycle
    // starts before it fires — that cycle's end() will flush, so the safety net
    // must stand down to avoid a redundant / re-entrant flush.
    scheduleSettleFlush();
    setInsideChangeDetection(true);

    await flushMicrotasks();
    expect((globalThis as any).__FlushElementTree).not.toHaveBeenCalled();
  });
});

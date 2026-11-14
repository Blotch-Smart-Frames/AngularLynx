// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterFrame } from './after-frame';

describe('afterFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs on the turn after the next frame', async () => {
    const callback = vi.fn();
    afterFrame(callback);
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).not.toHaveBeenCalled();
    // The fake clock draws a frame every 16ms from its start.
    await vi.advanceTimersByTimeAsync(20);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('waits for a frame with nothing else after it, four at most', async () => {
    // Each turn starts well after the last: the thread is never idle.
    const now = Date.now.bind(Date);
    let late = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      late += 10;
      return now() + late;
    });
    const callback = vi.fn();
    afterFrame(callback);
    await vi.advanceTimersByTimeAsync(16 * 3 - 4);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('runs nothing once canceled', async () => {
    const callback = vi.fn();
    afterFrame(callback)();
    await vi.advanceTimersByTimeAsync(100);
    expect(callback).not.toHaveBeenCalled();
  });

  it('runs on the next turn without frames, unless canceled', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const callback = vi.fn();
    afterFrame(callback);
    afterFrame(callback)();
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledOnce();
  });
});

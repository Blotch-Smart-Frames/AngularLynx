import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devStats, endCdTiming, startCdTiming } from './stats';

describe('change-detection timing', () => {
  let clock: number;

  beforeEach(() => {
    devStats.reset();
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    devStats.reset();
  });

  it('records the time from start to end in lastCdDurationMs', () => {
    clock = 100;
    startCdTiming();
    clock = 112.5;
    endCdTiming();

    expect(devStats.lastCdDurationMs).toBe(12.5);
  });

  it('times a nested cycle and the cycle around it separately', () => {
    clock = 10;
    startCdTiming();
    clock = 20;
    startCdTiming();
    clock = 25;
    endCdTiming();
    expect(devStats.lastCdDurationMs).toBe(5);

    clock = 40;
    endCdTiming();
    expect(devStats.lastCdDurationMs).toBe(30);
  });

  it('leaves the duration alone when no cycle is in progress', () => {
    devStats.lastCdDurationMs = 7;
    endCdTiming();

    expect(devStats.lastCdDurationMs).toBe(7);
  });

  it('uses Date.now() where there is no performance global', () => {
    // Native Lynx's main thread, where Angular runs, has no `performance`.
    vi.stubGlobal('performance', undefined);
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1000);
    startCdTiming();
    dateNow.mockReturnValue(1003);
    endCdTiming();

    expect(devStats.lastCdDurationMs).toBe(3);
  });

  it('uses Date.now() where performance has no now()', () => {
    vi.stubGlobal('performance', {});
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(50);
    startCdTiming();
    dateNow.mockReturnValue(52);
    endCdTiming();

    expect(devStats.lastCdDurationMs).toBe(2);
  });
});

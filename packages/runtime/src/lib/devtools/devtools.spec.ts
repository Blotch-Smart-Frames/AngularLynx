import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LynxDevTools } from './devtools';
import { devStats } from './stats';

describe('LynxDevTools', () => {
  beforeEach(() => {
    devStats.reset();
  });

  afterEach(() => {
    devStats.reset();
  });

  it('constructs without errors', () => {
    expect(() => new LynxDevTools()).not.toThrow();
  });

  describe('snapshot', () => {
    it('returns current counter values', () => {
      devStats.cdCycles = 5;
      devStats.elementCreated = 100;
      devStats.elementRemoved = 20;
      devStats.flushCount = 5;
      devStats.lastCdDurationMs = 3.14;

      const service = new LynxDevTools();
      const snap = service.snapshot();

      expect(snap.cdCycles).toBe(5);
      expect(snap.elementCreated).toBe(100);
      expect(snap.elementRemoved).toBe(20);
      expect(snap.flushCount).toBe(5);
      expect(snap.lastCdDurationMs).toBe(3.14);
    });

    it('returns a plain object (not a reference to devStats)', () => {
      const service = new LynxDevTools();
      const snap = service.snapshot();
      snap.cdCycles = 999;

      expect(devStats.cdCycles).toBe(0);
    });
  });

  describe('reset', () => {
    it('zeroes all counters', () => {
      devStats.cdCycles = 10;
      devStats.elementCreated = 50;
      devStats.elementRemoved = 5;
      devStats.flushCount = 10;
      devStats.lastCdDurationMs = 2.5;

      const service = new LynxDevTools();
      service.reset();

      expect(devStats.cdCycles).toBe(0);
      expect(devStats.elementCreated).toBe(0);
      expect(devStats.elementRemoved).toBe(0);
      expect(devStats.flushCount).toBe(0);
      expect(devStats.lastCdDurationMs).toBe(0);
    });
  });

  describe('refresh', () => {
    it('does not throw', () => {
      const service = new LynxDevTools();
      expect(() => service.refresh()).not.toThrow();
    });
  });
});

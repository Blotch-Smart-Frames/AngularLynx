import { describe, expect, it } from 'vitest';
import { VelocityTracker } from './velocity';

describe('VelocityTracker', () => {
  it('is still with fewer than two samples', () => {
    const tracker = new VelocityTracker();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
    tracker.add(0, 10, 0);
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('averages the last 100ms, in pixels a second', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0, 0);
    tracker.add(500, 0, 0);
    tracker.add(550, 20, -10);
    tracker.add(600, 50, -20);
    expect(tracker.velocity()).toEqual({ x: 500, y: -200 });
  });

  it('is still for samples at the same time', () => {
    const tracker = new VelocityTracker();
    tracker.add(5, 0, 0);
    tracker.add(5, 30, 0);
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('forgets a reset touch', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0, 0);
    tracker.add(50, 100, 0);
    tracker.reset();
    tracker.add(60, 0, 0);
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('starts over when the clock runs backwards', () => {
    // Samples from two clocks: measuring across them would give a velocity
    // from a made-up interval.
    const tracker = new VelocityTracker();
    tracker.add(1000, 0, 0);
    tracker.add(1050, 100, 0);
    tracker.add(40, 100, 0);
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
    tracker.add(90, 150, 0);
    expect(tracker.velocity()).toEqual({ x: 1000, y: 0 });
  });
});

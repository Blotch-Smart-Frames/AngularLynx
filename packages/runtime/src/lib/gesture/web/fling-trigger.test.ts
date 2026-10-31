import { describe, expect, it, vi } from 'vitest';
import {
  type FlingFrames,
  FlingTrigger,
  type FlingTriggerState,
} from './fling-trigger';

/**
 * A window whose frames run when the test says, `ms` apart.
 */
const fakeFrames = (devicePixelRatio = 2) => {
  let queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 1000;
  const frames: FlingFrames & {
    step: (ms?: number) => void;
    pending: () => number;
  } = {
    devicePixelRatio,
    performance: { now: () => now },
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      queue.set(++id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((frame: number) => {
      queue.delete(frame);
    }),
    step(ms = 16) {
      now += ms;
      const due = queue;
      queue = new Map();
      for (const callback of due.values()) callback(now);
    },
    pending: () => queue.size,
  };
  return frames;
};

/**
 * Records each frame's state and distance.
 */
const record = () => {
  const seen: { state: FlingTriggerState; x: number; y: number }[] = [];
  const trigger = new FlingTrigger((fling) =>
    seen.push({ state: fling.state, ...fling.distance }),
  );
  return { trigger, seen };
};

const runToEnd = (frames: ReturnType<typeof fakeFrames>) => {
  for (let i = 0; i < 2000 && frames.pending(); i++) frames.step();
};

describe('FlingTrigger', () => {
  it("doesn't fling a release slower than 50px/s in both axes", () => {
    const { trigger, seen } = record();
    const frames = fakeFrames();
    expect(trigger.start({ x: 49, y: -49 }, frames)).toBe(false);
    expect(frames.requestAnimationFrame).not.toHaveBeenCalled();
    expect(trigger.isFinished()).toBe(true);
    expect(seen).toEqual([]);
  });

  it('reports a start, then decelerating frames, then the end', () => {
    const { trigger, seen } = record();
    const frames = fakeFrames();
    expect(trigger.start({ x: 1000, y: 0 }, frames)).toBe(true);
    expect(trigger.isFinished()).toBe(false);

    frames.step();
    expect(seen.map(({ state }) => state)).toEqual(['start', 'update']);
    expect(seen[0].x).toBe(0);

    runToEnd(frames);
    expect(trigger.isFinished()).toBe(true);
    expect(trigger.state).toBe('end');
    const last = seen.at(-1)!;
    expect(last.state).toBe('end');
    // 0.998 a millisecond from 1000px/s goes about 500px.
    expect(last.x).toBeGreaterThan(490);
    expect(last.x).toBeLessThan(500);
    // It only ever moved along x, and slower each frame.
    expect(seen.every(({ y }) => y === 0)).toBe(true);
    const steps = seen
      .slice(1, -1)
      .map(({ x }, i, all) => x - (all[i - 1]?.x ?? 0));
    expect(steps[5]).toBeLessThan(steps[1]);
  });

  it('flings against the velocity, and in both axes', () => {
    const { trigger, seen } = record();
    const frames = fakeFrames(0);
    trigger.start({ x: -400, y: 800 }, frames);
    runToEnd(frames);
    const last = seen.at(-1)!;
    expect(last.x).toBeLessThan(0);
    expect(last.y).toBeGreaterThan(0);
  });

  it('flings no faster than 10000px/s', () => {
    const fast = record();
    const capped = record();
    const fastFrames = fakeFrames();
    const cappedFrames = fakeFrames();
    fast.trigger.start({ x: 1e6, y: 0 }, fastFrames);
    capped.trigger.start({ x: 10000, y: 0 }, cappedFrames);
    runToEnd(fastFrames);
    runToEnd(cappedFrames);
    expect(fast.seen.at(-1)).toEqual(capped.seen.at(-1));
  });

  it('stops when a frame stops it', () => {
    const frames = fakeFrames();
    let calls = 0;
    const atStart = new FlingTrigger((fling) => {
      calls++;
      fling.stop();
    });
    atStart.start({ x: 1000, y: 0 }, frames);
    frames.step();
    expect(calls).toBe(1);
    expect(frames.pending()).toBe(0);

    calls = 0;
    const atUpdate = new FlingTrigger((fling) => {
      calls++;
      if (fling.state === 'update') fling.stop();
    });
    atUpdate.start({ x: 1000, y: 0 }, frames);
    frames.step();
    expect(calls).toBe(2);
    expect(frames.pending()).toBe(0);
    expect(atUpdate.isFinished()).toBe(true);
  });

  it('cancels its next frame when stopped, and starts a new fling over', () => {
    const { trigger, seen } = record();
    const frames = fakeFrames();
    trigger.start({ x: 1000, y: 0 }, frames);
    frames.step();
    trigger.stop();
    expect(frames.cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(frames.pending()).toBe(0);

    seen.length = 0;
    trigger.start({ x: 0, y: 1000 }, frames);
    frames.step();
    expect(seen[0]).toEqual({ state: 'start', x: 0, y: 0 });
  });

  it('resets to rest', () => {
    const { trigger } = record();
    const frames = fakeFrames();
    trigger.reset();
    trigger.start({ x: 1000, y: 0 }, frames);
    frames.step();
    frames.step();
    trigger.reset();
    expect(trigger.state).toBe('end');
    expect(trigger.distance).toEqual({ x: 0, y: 0 });
    expect(trigger.lastDistance).toEqual({ x: 0, y: 0 });
    expect(trigger.isFinished()).toBe(true);
  });

  it('counts a frame stamped before the fling started as its first', () => {
    const { trigger, seen } = record();
    const frames = fakeFrames();
    trigger.start({ x: 1000, y: 0 }, frames);
    frames.step(-5);
    expect(seen).toHaveLength(2);
    expect(seen.every(({ x }) => x === 0)).toBe(true);
  });
});

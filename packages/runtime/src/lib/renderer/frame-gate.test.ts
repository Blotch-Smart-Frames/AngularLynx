import {
  createEnvironmentInjector,
  type EnvironmentInjector,
  Injector,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canGateFrames, frameGate } from './frame-gate';

/**
 * A scheduler that schedules and runs ticks the way Angular's zoneless
 * ChangeDetectionSchedulerImpl does, with what the frame gate reads: notify()
 * schedules a tick unless one is, and tick() cleans up after itself.
 */
const fakeScheduler = () => {
  const scheduler = {
    pendingRenderTaskId: null as number | null,
    cancelScheduledCallback: null as (() => void) | null,
    useMicrotaskScheduler: false,
    // The timer-and-frame races notify() started, and how many were canceled.
    races: 0,
    racesCanceled: 0,
    ticks: 0,
    notify(_source: number) {
      if (this.pendingRenderTaskId !== null) return;
      this.pendingRenderTaskId = 1;
      this.races++;
      this.cancelScheduledCallback = () => {
        scheduler.racesCanceled++;
      };
    },
    tick() {
      this.ticks++;
      this.cancelScheduledCallback?.();
      this.cancelScheduledCallback = null;
      this.pendingRenderTaskId = null;
    },
  };
  return scheduler;
};

const injectorWith = (scheduler: unknown): Injector =>
  Injector.create({
    providers: [{ provide: ChangeDetectionScheduler, useValue: scheduler }],
  });

describe('frameGate', () => {
  // The frames asked for, run by runFrame().
  let frames: Array<(time: number) => void>;
  const runFrame = (): void => {
    for (const frame of frames.splice(0)) frame(0);
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: (time: number) => void) => frames.push(callback)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves a tick scheduled after a flush onto the next frame', () => {
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));

    flushed();
    scheduler.notify(0);

    // Angular's timer and frame were canceled: its tick waits for ours.
    expect(scheduler.racesCanceled).toBe(1);
    expect(scheduler.ticks).toBe(0);
    // The app stays unstable until it runs.
    expect(scheduler.pendingRenderTaskId).toBe(1);

    runFrame();

    expect(scheduler.ticks).toBe(1);
    expect(scheduler.pendingRenderTaskId).toBeNull();
  });

  it('runs every change of the frame in that one tick', () => {
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));

    flushed();
    scheduler.notify(0);
    scheduler.notify(0);
    scheduler.notify(0);
    runFrame();

    expect(scheduler.races).toBe(1);
    expect(scheduler.ticks).toBe(1);
  });

  it('asks for one frame however many cycles flush before it', () => {
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));

    flushed();
    flushed();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("leaves a frame's first tick on Angular's timer", () => {
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));
    flushed();
    runFrame();

    // Nothing has flushed since that frame.
    scheduler.notify(0);

    expect(scheduler.racesCanceled).toBe(0);
    // The frame that ended the last one runs no tick.
    expect(scheduler.ticks).toBe(0);
  });

  it('keeps moving ticks a frame at a time through a burst', () => {
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));
    flushed();
    scheduler.notify(0);

    // The moved tick flushes in its frame, which starts the next one.
    runFrame();
    flushed();
    scheduler.notify(0);

    expect(scheduler.ticks).toBe(1);
    expect(scheduler.racesCanceled).toBe(2);
    runFrame();
    expect(scheduler.ticks).toBe(2);
  });

  it('leaves alone a tick already scheduled, or scheduled on a microtask', () => {
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));
    // Scheduled before the flush: it's the frame's own.
    scheduler.notify(0);
    flushed();
    scheduler.notify(0);
    expect(scheduler.racesCanceled).toBe(0);
    scheduler.tick();
    // Right after a tick, in its task, Angular ticks again from a microtask.
    scheduler.racesCanceled = 0;
    scheduler.useMicrotaskScheduler = true;
    scheduler.notify(0);

    expect(scheduler.racesCanceled).toBe(0);
  });

  it('runs nothing at the frame for a moved tick that already ran', () => {
    // runComingTick() runs the scheduled tick early, and Angular's cleanup
    // cancels what it scheduled: here, the frame's run.
    const scheduler = fakeScheduler();
    const flushed = frameGate(injectorWith(scheduler));
    flushed();
    scheduler.notify(0);
    scheduler.tick();

    runFrame();

    expect(scheduler.ticks).toBe(1);
  });

  describe("falls back to Angular's own timing", () => {
    it('without requestAnimationFrame', () => {
      vi.stubGlobal('requestAnimationFrame', undefined);
      const scheduler = fakeScheduler();
      const { notify } = scheduler;
      const flushed = frameGate(injectorWith(scheduler));

      flushed();
      scheduler.notify(0);

      expect(scheduler.notify).toBe(notify);
      expect(scheduler.racesCanceled).toBe(0);
    });

    it('without the fields it reads, as a later Angular might rename them', () => {
      for (const missing of [
        'notify',
        'tick',
        'pendingRenderTaskId',
        'cancelScheduledCallback',
        'useMicrotaskScheduler',
      ] as const) {
        const scheduler: Partial<ReturnType<typeof fakeScheduler>> =
          fakeScheduler();
        delete scheduler[missing];
        const flushed = frameGate(injectorWith(scheduler));

        flushed();
        scheduler.notify?.(0);

        expect(scheduler.racesCanceled).toBe(0);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
      }
    });

    it('without a scheduler, or with an app already destroyed', () => {
      expect(() => frameGate(injectorWith(null))()).not.toThrow();
      const injector = createEnvironmentInjector(
        [],
        Injector.create({ providers: [] }) as EnvironmentInjector,
      );
      const flushed = frameGate(injector);
      injector.destroy();

      expect(() => flushed()).not.toThrow();
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    });
  });

  it('tells a scheduler it can gate from one it cannot', () => {
    expect(canGateFrames(fakeScheduler())).toBe(true);
    expect(canGateFrames(null)).toBe(false);
    expect(canGateFrames('scheduler')).toBe(false);
    expect(
      canGateFrames({ ...fakeScheduler(), useMicrotaskScheduler: 0 }),
    ).toBe(false);
  });
});

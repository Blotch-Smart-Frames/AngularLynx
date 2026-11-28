// @vitest-environment jsdom
//
// The frame gate against Angular's own zoneless scheduler. The gate reads and
// replaces internals of ChangeDetectionSchedulerImpl (see frame-gate.ts), and
// falls back to Angular's timing if they're gone. These tests fail if a later
// Angular renames them, so an upgrade that would quietly lose the gate shows
// up in CI instead (issue #868).
import '@angular/compiler';
import {
  effect,
  provideZonelessChangeDetection,
  signal,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { scheduleSettleFlush } from '../lynx-element/lynx-element';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { InMemoryDocument } from '../testing/in-memory-document';
import { canGateFrames } from './frame-gate';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

describe("frame gate with Angular's scheduler", () => {
  // The frames asked for, run by runFrame().
  let frames: Array<(time: number) => void>;
  const runFrame = (): void => {
    for (const frame of frames.splice(0)) frame(0);
  };

  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    frames = [];
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: (time: number) => void) => frames.push(callback)),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('__FlushElementTree', vi.fn());
    markFirstRenderComplete();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LYNX_DOCUMENT, useValue: new InMemoryDocument() },
        LynxRendererFactory2,
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Ends a cycle that flushes, as one that wrote something does.
   */
  const flushCycle = (factory: LynxRendererFactory2): void => {
    factory.begin?.();
    scheduleSettleFlush();
    factory.end?.();
  };

  it('finds what it reads on the scheduler, under the same names', () => {
    expect(canGateFrames(TestBed.inject(ChangeDetectionScheduler))).toBe(true);
  });

  it('runs a tick scheduled after a flush on the next frame, not its timer', () => {
    const factory = TestBed.inject(LynxRendererFactory2);
    flushCycle(factory);
    expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(1);
    const count = signal(0);
    const seen: number[] = [];
    // A root effect schedules a tick to run it, like a response's signal.
    TestBed.runInInjectionContext(() =>
      effect(() => {
        seen.push(count());
      }),
    );

    vi.runAllTimers();
    expect(seen).toEqual([]);

    runFrame();
    expect(seen).toEqual([0]);
  });

  it('runs a tick scheduled after a settle flush on the next frame too', async () => {
    // While a list scrolls, the settle flush after the rows componentAtIndex
    // binds is often the frame's first flush.
    TestBed.inject(LynxRendererFactory2);
    scheduleSettleFlush();
    await Promise.resolve();
    expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(1);
    const seen: number[] = [];

    TestBed.runInInjectionContext(() =>
      effect(() => {
        seen.push(0);
      }),
    );
    vi.runAllTimers();
    expect(seen).toEqual([]);

    runFrame();
    expect(seen).toEqual([0]);
  });

  it("runs the frame's first tick on Angular's timer", () => {
    const factory = TestBed.inject(LynxRendererFactory2);
    flushCycle(factory);
    runFrame();
    const seen: number[] = [];

    TestBed.runInInjectionContext(() =>
      effect(() => {
        seen.push(0);
      }),
    );
    vi.runAllTimers();

    expect(seen).toEqual([0]);
  });
});

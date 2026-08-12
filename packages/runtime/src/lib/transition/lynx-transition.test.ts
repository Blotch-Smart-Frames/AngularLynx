// @vitest-environment jsdom
import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
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
import { LynxTransition } from './lynx-transition';

/**
 * Sets an Angular InputSignal's value using Angular's internal reactive node API.
 * Needed because JIT mode doesn't wire up signal inputs for template binding or setInput().
 */
const setInputSignal = (signalFn: any, value: any): void => {
  const symbols = Object.getOwnPropertySymbols(signalFn);
  const signalSymbol = symbols.find((s) => s.toString() === 'Symbol(SIGNAL)')!;
  const node = signalFn[signalSymbol];
  const proto = Object.getPrototypeOf(node);
  proto.applyValueToInputSignal(node, value);
};

describe('LynxTransition', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.useFakeTimers();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LynxTransition],
      providers: [provideZonelessChangeDetection()],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  /**
   * Creates the component and runs the initial effect (show=false → hidden).
   */
  const create = () => {
    const fixture = TestBed.createComponent(LynxTransition);
    fixture.detectChanges();
    return fixture;
  };

  /**
   * Triggers enter by setting show=true after initialization.
   */
  const triggerEnter = (fixture: any) => {
    setInputSignal(fixture.componentInstance.show, true);
    TestBed.flushEffects();
  };

  /**
   * Starts with show=true (initial render, no animation), then triggers leave.
   */
  const createShowing = () => {
    const fixture = TestBed.createComponent(LynxTransition);
    // Set show=true BEFORE first detectChanges so the initial effect
    // initializes with shouldRender=true (no animation).
    setInputSignal(fixture.componentInstance.show, true);
    fixture.detectChanges();
    return fixture;
  };

  const triggerLeave = (fixture: any) => {
    setInputSignal(fixture.componentInstance.show, false);
    TestBed.flushEffects();
  };

  describe('enter', () => {
    it('adds the enter keyframe class and clears any leave class', () => {
      const fixture = create();
      triggerEnter(fixture);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.classList.contains('v-enter')).toBe(true);
      expect(el.classList.contains('v-leave')).toBe(false);
    });

    it('mounts the content (shouldRender true)', () => {
      const fixture = create();
      triggerEnter(fixture);

      expect(fixture.componentInstance.shouldRender()).toBe(true);
    });

    it('keeps the enter class after the duration (holds resting state) and emits afterEnter', () => {
      const fixture = create();
      let emitted = false;
      fixture.componentInstance.afterEnter.subscribe(() => (emitted = true));

      triggerEnter(fixture);
      vi.advanceTimersByTime(300);

      const el = fixture.nativeElement as HTMLElement;
      // animation-fill-mode: both holds the final frame = the resting state, so
      // the class stays applied until the element leaves.
      expect(el.classList.contains('v-enter')).toBe(true);
      expect(emitted).toBe(true);
    });
  });

  describe('leave', () => {
    it('adds the leave keyframe class and clears any enter class', () => {
      const fixture = createShowing();
      triggerLeave(fixture);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.classList.contains('v-leave')).toBe(true);
      expect(el.classList.contains('v-enter')).toBe(false);
    });

    it('keeps content mounted during the leave, then unmounts after the duration', () => {
      const fixture = createShowing();
      triggerLeave(fixture);

      // Still mounted while the leave animation plays.
      expect(fixture.componentInstance.shouldRender()).toBe(true);

      vi.advanceTimersByTime(300);

      expect(fixture.componentInstance.shouldRender()).toBe(false);
    });

    it('emits afterLeave after the duration', () => {
      const fixture = createShowing();
      let emitted = false;
      fixture.componentInstance.afterLeave.subscribe(() => (emitted = true));

      triggerLeave(fixture);
      vi.advanceTimersByTime(300);

      expect(emitted).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('enter cancels an in-progress leave', () => {
      const fixture = createShowing();
      triggerLeave(fixture);
      triggerEnter(fixture);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.classList.contains('v-leave')).toBe(false);
      expect(el.classList.contains('v-enter')).toBe(true);
    });

    it('leave cancels an in-progress enter', () => {
      const fixture = create();
      triggerEnter(fixture);
      triggerLeave(fixture);

      const el = fixture.nativeElement as HTMLElement;
      expect(el.classList.contains('v-enter')).toBe(false);
      expect(el.classList.contains('v-leave')).toBe(true);
    });

    it('a canceled leave does not unmount the content', () => {
      const fixture = createShowing();
      triggerLeave(fixture);
      // Re-show before the leave timer fires — cancels the pending unmount.
      triggerEnter(fixture);
      vi.advanceTimersByTime(500);

      expect(fixture.componentInstance.shouldRender()).toBe(true);
    });
  });
});

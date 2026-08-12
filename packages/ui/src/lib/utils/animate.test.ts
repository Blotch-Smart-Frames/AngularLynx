// Exercises every helper in animate.ts against a mock element with a spy on
// `.animate()`/.setStyle(). The Lynx animate() API doesn't run in jsdom
// (nothing renders), but the helpers still need to be called so their keyframe
// / options wiring is covered. Assert on the arguments handed to the mock —
// each helper's keyframe shape and duration/easing defaults are the meaningful
// behavior to lock in.
import { describe, expect, it, vi } from 'vitest';
import {
  DURATION,
  EASING,
  SCALE,
  directionalSlideIn,
  fadeIn,
  fadeOut,
  overlayClose,
  overlayOpen,
  popIn,
  popOut,
  pressDown,
  pressRelease,
  pulse,
  revealIn,
  scaleIn,
  scaleOut,
  shake,
  slideIn,
  slideOut,
  springTranslateX,
} from './animate';

const makeEl = () => ({
  animate: vi.fn(() => ({ cancel: vi.fn() })),
  setStyle: vi.fn(),
});

describe('animate — constants', () => {
  it('exposes DURATION, EASING, SCALE lookup tables', () => {
    expect(DURATION.instant).toBe(100);
    expect(EASING.decelerate).toContain('cubic-bezier');
    expect(SCALE.popFrom).toBeCloseTo(0.6);
  });
});

describe('animate — primitive helpers on null/undefined', () => {
  it('every helper short-circuits when the element is null', () => {
    expect(fadeIn(null)).toBeUndefined();
    expect(fadeOut(null)).toBeUndefined();
    expect(scaleIn(null)).toBeUndefined();
    expect(scaleOut(null)).toBeUndefined();
    expect(slideIn(null, 'up')).toBeUndefined();
    expect(slideOut(null, 'up')).toBeUndefined();
    expect(popIn(null)).toBeUndefined();
    expect(popOut(null)).toBeUndefined();
    expect(pulse(null)).toBeUndefined();
    expect(shake(null)).toBeUndefined();
    expect(springTranslateX(null, 0, 10)).toBeUndefined();
    expect(revealIn(null)).toBeUndefined();
    expect(directionalSlideIn(null, 1)).toBeUndefined();
    // Press helpers: an element without setStyle also short-circuits.
    expect(pressDown(null)).toBeUndefined();
    expect(pressRelease(null)).toBeUndefined();
    expect(pressDown({})).toBeUndefined();
  });
});

describe('animate — primitive helpers on a real element', () => {
  it('fadeIn animates opacity 0 → 1 with the default duration/easing', () => {
    const el = makeEl();
    fadeIn(el);
    const [keyframes, options] = el.animate.mock.calls[0];
    expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(options.duration).toBe(DURATION.normal);
    expect(options.easing).toBe(EASING.decelerate);
    expect(options.fill).toBe('forwards');
  });

  it('fadeIn honors custom duration / easing / fill', () => {
    const el = makeEl();
    fadeIn(el, { duration: 999, easing: 'linear', fill: 'both' });
    const [, options] = el.animate.mock.calls[0];
    expect(options).toEqual({
      duration: 999,
      easing: 'linear',
      fill: 'both',
    });
  });

  it('fadeOut animates opacity 1 → 0 with the accelerate default easing', () => {
    const el = makeEl();
    fadeOut(el);
    const [keyframes, options] = el.animate.mock.calls[0];
    expect(keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(options.easing).toBe(EASING.accelerate);
    expect(options.duration).toBe(DURATION.fast);
  });

  it('scaleIn uses SCALE.dialogFrom by default and honors overrides', () => {
    const el = makeEl();
    scaleIn(el);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[0].transform).toContain(`scale(${SCALE.dialogFrom})`);

    const el2 = makeEl();
    scaleIn(el2, { fromScale: 0.5, fromY: 20 });
    const [kf2] = el2.animate.mock.calls[0];
    expect(kf2[0].transform).toContain('scale(0.5)');
    expect(kf2[0].transform).toContain('translateY(20px)');
  });

  it('scaleOut animates towards the dialog exit transform', () => {
    const el = makeEl();
    scaleOut(el);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[1].transform).toContain(`scale(${SCALE.dialogTo})`);

    const el2 = makeEl();
    scaleOut(el2, { toScale: 0.7, toY: 40 });
    const [kf2] = el2.animate.mock.calls[0];
    expect(kf2[1].transform).toContain('scale(0.7)');
    expect(kf2[1].transform).toContain('translateY(40px)');
  });

  it.each([
    ['up', 'translateY(100%)'],
    ['down', 'translateY(-100%)'],
    ['left', 'translateX(-100%)'],
    ['right', 'translateX(100%)'],
  ] as const)('slideIn from %s starts at %s', (direction, expected) => {
    const el = makeEl();
    slideIn(el, direction);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[0].transform).toBe(expected);
  });

  it.each([
    ['up', 'translateY(-100%)'],
    ['down', 'translateY(100%)'],
    ['left', 'translateX(-100%)'],
    ['right', 'translateX(100%)'],
  ] as const)('slideOut to %s ends at %s', (direction, expected) => {
    const el = makeEl();
    slideOut(el, direction);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[1].transform).toBe(expected);
  });

  it('popIn defaults from SCALE.popFrom and honors fromScale', () => {
    const el = makeEl();
    popIn(el);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[0].transform).toContain(`scale(${SCALE.popFrom})`);

    const el2 = makeEl();
    popIn(el2, { fromScale: 0.4 });
    const [kf2] = el2.animate.mock.calls[0];
    expect(kf2[0].transform).toContain('scale(0.4)');
  });

  it('popOut defaults to 0.8 and honors toScale', () => {
    const el = makeEl();
    popOut(el);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[1].transform).toContain('scale(0.8)');

    const el2 = makeEl();
    popOut(el2, { toScale: 0.3 });
    const [kf2] = el2.animate.mock.calls[0];
    expect(kf2[1].transform).toContain('scale(0.3)');
  });

  it('pulse loops opacity indefinitely with a 1500ms default', () => {
    const el = makeEl();
    pulse(el);
    const [keyframes, options] = el.animate.mock.calls[0];
    expect(keyframes).toEqual([
      { opacity: 1 },
      { opacity: 0.5 },
      { opacity: 1 },
    ]);
    expect(options.duration).toBe(1500);
    expect(options.iterations).toBe(Infinity);

    const el2 = makeEl();
    pulse(el2, { duration: 400 });
    const [, opts2] = el2.animate.mock.calls[0];
    expect(opts2.duration).toBe(400);
  });

  it('shake produces a six-keyframe X wobble with forwards fill', () => {
    const el = makeEl();
    shake(el);
    const [keyframes, options] = el.animate.mock.calls[0];
    expect(keyframes).toHaveLength(6);
    expect(keyframes[0].transform).toBe('translateX(0)');
    expect(options.fill).toBe('forwards');

    const el2 = makeEl();
    shake(el2, { duration: 999, easing: 'linear' });
    const [, opts2] = el2.animate.mock.calls[0];
    expect(opts2.duration).toBe(999);
    expect(opts2.easing).toBe('linear');
  });

  it('springTranslateX interpolates through the midpoint with a squish', () => {
    const el = makeEl();
    springTranslateX(el, 0, 20);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[0].transform).toContain('translateX(0px)');
    expect(keyframes[1].transform).toContain('translateX(10px)');
    expect(keyframes[1].transform).toContain('scale(1.1)');
    expect(keyframes[2].transform).toContain('translateX(20px)');

    const el2 = makeEl();
    springTranslateX(el2, 0, 20, {
      duration: 500,
      easing: 'ease',
      fill: 'none',
    });
    const [, opts2] = el2.animate.mock.calls[0];
    expect(opts2).toEqual({ duration: 500, easing: 'ease', fill: 'none' });
  });

  it('revealIn slides in from a small Y offset', () => {
    const el = makeEl();
    revealIn(el);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[0].transform).toContain('translateY(8px)');

    const el2 = makeEl();
    revealIn(el2, { fromY: 24 });
    const [kf2] = el2.animate.mock.calls[0];
    expect(kf2[0].transform).toContain('translateY(24px)');
  });

  it('directionalSlideIn respects the direction sign', () => {
    const el = makeEl();
    directionalSlideIn(el, 1);
    const [keyframes] = el.animate.mock.calls[0];
    expect(keyframes[0].transform).toContain('translateX(24px)');

    const el2 = makeEl();
    directionalSlideIn(el2, -1);
    const [kf2] = el2.animate.mock.calls[0];
    expect(kf2[0].transform).toContain('translateX(-24px)');

    const el3 = makeEl();
    directionalSlideIn(el3, 1, { distance: 100 });
    const [kf3] = el3.animate.mock.calls[0];
    expect(kf3[0].transform).toContain('translateX(100px)');
  });
});

describe('animate — press helpers', () => {
  it('pressDown writes a transition + scale via setStyle', () => {
    const el = makeEl();
    const handle = pressDown(el);
    expect(el.setStyle).toHaveBeenCalledWith(
      'transition',
      expect.stringContaining(`transform ${DURATION.instant}ms`),
    );
    expect(el.setStyle).toHaveBeenCalledWith(
      'transform',
      `scale(${SCALE.pressDown})`,
    );
    // The returned handle exposes a no-op cancel() for API parity.
    expect(handle).toBeDefined();
    expect(() => handle!.cancel()).not.toThrow();
  });

  it('pressDown honors a custom scale', () => {
    const el = makeEl();
    pressDown(el, 0.5);
    expect(el.setStyle).toHaveBeenCalledWith('transform', 'scale(0.5)');
  });

  it('pressRelease returns to scale(1) via a spring easing transition', () => {
    const el = makeEl();
    pressRelease(el);
    expect(el.setStyle).toHaveBeenCalledWith('transform', 'scale(1)');
    expect(el.setStyle).toHaveBeenCalledWith(
      'transition',
      expect.stringContaining(EASING.spring),
    );
  });
});

describe('animate — composite overlay helpers', () => {
  it.each(['center', 'bottom', 'left', 'right'] as const)(
    'overlayOpen(%s) fades the backdrop and staggers the panel entrance',
    (type) => {
      vi.useFakeTimers();
      const backdrop = makeEl();
      const panel = makeEl();

      overlayOpen(backdrop, panel, type);

      // Backdrop fades in immediately.
      expect(backdrop.animate).toHaveBeenCalled();
      // Panel is scheduled 30ms later — advance the timer to fire it.
      vi.advanceTimersByTime(30);
      expect(panel.animate).toHaveBeenCalled();
      vi.useRealTimers();
    },
  );

  it.each([
    ['center', 180],
    ['bottom', DURATION.normal],
    ['left', DURATION.normal],
    ['right', DURATION.normal],
  ] as const)(
    'overlayClose(%s) returns the correct cleanup duration and animates both nodes',
    (type, expectedDuration) => {
      const backdrop = makeEl();
      const panel = makeEl();

      const duration = overlayClose(backdrop, panel, type);

      expect(duration).toBe(expectedDuration);
      expect(panel.animate).toHaveBeenCalled();
      expect(backdrop.animate).toHaveBeenCalled();
    },
  );
});

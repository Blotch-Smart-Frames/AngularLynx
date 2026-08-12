import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fadeIn,
  fadeOut,
  scaleIn,
  scaleOut,
  slideIn,
  slideOut,
  popIn,
  popOut,
  pulse,
  shake,
  springTranslateX,
  revealIn,
  directionalSlideIn,
  overlayOpen,
  overlayClose,
  pressDown,
  pressRelease,
  DURATION,
  EASING,
  SCALE,
} from './animate';

/**
 * The real Lynx element only needs an `animate()` method for the wrapper
 * helpers below — everything else about the element is irrelevant to them.
 * The mock returns a cancelable handle (mirroring the real API) so callers
 * that store/inspect the return value have something realistic to work with.
 */
const createAnimateEl = () => ({
  animate: vi.fn().mockReturnValue({ cancel: vi.fn() }),
});

// ---------------------------------------------------------------------------
// Guarded animate-wrapper functions
//
// Every function in this table follows the same shape:
//   if (!el) return undefined;
//   return el.animate(keyframes, { duration: opts?.duration ?? D, ... });
// Each `if (!el)` is its own branch in the compiled output (per function),
// so every entry needs its own falsy-el call to get full branch coverage —
// a shared falsy-el test at the top would only cover ONE function's branch.
// `call` normalizes each function's unique signature (extra positional args
// like direction/fromX/toX, or extra option keys like fromScale) down to a
// uniform (el, options) shape so the three required cases can be driven
// from a single table instead of copy-pasted per function.
// ---------------------------------------------------------------------------

type GuardedCase = {
  name: string;
  call: (el: any, options?: any) => unknown;
  // Options object exercising the non-default side of every `??` in the function.
  overrideOptions: Record<string, unknown>;
  // The subset of `overrideOptions` that actually lands in the `el.animate()`
  // config argument (fromScale/fromY/etc. are consumed into keyframes instead).
  expectedConfig: Record<string, unknown>;
  // Expected config object when no options are passed at all.
  defaultConfig: Record<string, unknown>;
};

const guardedCases: GuardedCase[] = [
  {
    name: 'fadeIn',
    call: fadeIn,
    overrideOptions: { duration: 999, easing: 'linear', fill: 'both' },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.normal,
      easing: EASING.decelerate,
      fill: 'forwards',
    },
  },
  {
    name: 'fadeOut',
    call: fadeOut,
    overrideOptions: { duration: 999, easing: 'linear', fill: 'both' },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.fast,
      easing: EASING.accelerate,
      fill: 'forwards',
    },
  },
  {
    name: 'scaleIn',
    call: scaleIn,
    overrideOptions: {
      duration: 999,
      easing: 'linear',
      fill: 'both',
      fromScale: 0.5,
      fromY: 40,
    },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.slow,
      easing: EASING.springSubtle,
      fill: 'forwards',
    },
  },
  {
    name: 'scaleOut',
    call: scaleOut,
    overrideOptions: {
      duration: 999,
      easing: 'linear',
      fill: 'both',
      toScale: 0.5,
      toY: 40,
    },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.fast,
      easing: EASING.accelerate,
      fill: 'forwards',
    },
  },
  {
    name: 'popIn',
    call: popIn,
    overrideOptions: {
      duration: 999,
      easing: 'linear',
      fill: 'both',
      fromScale: 0.2,
    },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.fast,
      easing: EASING.spring,
      fill: 'forwards',
    },
  },
  {
    name: 'popOut',
    call: popOut,
    overrideOptions: {
      duration: 999,
      easing: 'linear',
      fill: 'both',
      toScale: 0.2,
    },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.instant,
      easing: EASING.accelerate,
      fill: 'forwards',
    },
  },
  {
    name: 'springTranslateX',
    // fromX/toX are required positional args unrelated to `options`; pin
    // them to fixed values so only the options behavior varies per case.
    call: (el, options) => springTranslateX(el, 0, 100, options),
    overrideOptions: { duration: 999, easing: 'linear', fill: 'both' },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: { duration: 200, easing: EASING.spring, fill: 'forwards' },
  },
  {
    name: 'revealIn',
    call: revealIn,
    overrideOptions: {
      duration: 999,
      easing: 'linear',
      fill: 'both',
      fromY: 40,
    },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.normal,
      easing: EASING.decelerate,
      fill: 'forwards',
    },
  },
  {
    name: 'directionalSlideIn',
    call: (el, options) => directionalSlideIn(el, 1, options),
    overrideOptions: {
      duration: 999,
      easing: 'linear',
      fill: 'both',
      distance: 50,
    },
    expectedConfig: { duration: 999, easing: 'linear', fill: 'both' },
    defaultConfig: {
      duration: DURATION.slow,
      easing: EASING.springSubtle,
      fill: 'forwards',
    },
  },
];

describe.each(guardedCases)(
  '$name',
  ({ call, overrideOptions, expectedConfig, defaultConfig }) => {
    it('returns undefined and does not throw when el is falsy', () => {
      expect(call(undefined)).toBeUndefined();
    });

    it('calls el.animate() with default values when no options are given', () => {
      const el = createAnimateEl();
      call(el);
      expect(el.animate).toHaveBeenCalledTimes(1);
      // Second arg to el.animate() is always the { duration, easing, fill }
      // config object — checking it confirms every `?? DEFAULT` fired.
      expect(el.animate.mock.calls[0][1]).toEqual(defaultConfig);
    });

    it('calls el.animate() with the provided options overriding every default', () => {
      const el = createAnimateEl();
      call(el, overrideOptions);
      expect(el.animate).toHaveBeenCalledTimes(1);
      expect(el.animate.mock.calls[0][1]).toEqual(expectedConfig);
    });
  },
);

// ---------------------------------------------------------------------------
// pulse — shares the "guarded" shape but its options type only has
// `duration` (no easing/fill), and the config includes a fixed `iterations:
// Infinity` for the indefinite loop, so it doesn't fit the generic table.
// ---------------------------------------------------------------------------

describe('pulse', () => {
  it('returns undefined when el is falsy', () => {
    expect(pulse(undefined)).toBeUndefined();
  });

  it('defaults to a 1500ms ease-in-out loop', () => {
    const el = createAnimateEl();
    pulse(el);
    expect(el.animate.mock.calls[0][1]).toEqual({
      duration: 1500,
      easing: 'ease-in-out',
      iterations: Infinity,
    });
  });

  it('honors an explicit duration', () => {
    const el = createAnimateEl();
    pulse(el, { duration: 3000 });
    expect(el.animate.mock.calls[0][1]).toEqual({
      duration: 3000,
      easing: 'ease-in-out',
      iterations: Infinity,
    });
  });
});

// ---------------------------------------------------------------------------
// shake — also "guarded", but `fill` is hardcoded to 'forwards' rather than
// read from options, so there is no `?? ` branch for it (unlike every other
// AnimateOptions consumer). Passing `fill: 'both'` below is deliberate: it
// proves the value is ignored rather than accidentally leaking through.
// ---------------------------------------------------------------------------

describe('shake', () => {
  it('returns undefined when el is falsy', () => {
    expect(shake(undefined)).toBeUndefined();
  });

  it('defaults duration and easing', () => {
    const el = createAnimateEl();
    shake(el);
    expect(el.animate.mock.calls[0][1]).toEqual({
      duration: DURATION.slow,
      easing: EASING.standard,
      fill: 'forwards',
    });
  });

  it('honors explicit duration/easing but always fills forwards', () => {
    const el = createAnimateEl();
    shake(el, { duration: 999, easing: 'linear', fill: 'both' });
    expect(el.animate.mock.calls[0][1]).toEqual({
      duration: 999,
      easing: 'linear',
      fill: 'forwards',
    });
  });
});

// ---------------------------------------------------------------------------
// slideIn / slideOut — guarded like the table above, but the direction is
// resolved via an object-literal lookup (`{ up: ..., down: ... }[direction]`)
// rather than an if/else, so a single direction is enough for branch
// coverage. All four are still exercised for behavioral thoroughness since
// each call is cheap and documents the intended keyframes per direction.
// ---------------------------------------------------------------------------

describe('slideIn', () => {
  it('returns undefined when el is falsy', () => {
    expect(slideIn(undefined, 'up')).toBeUndefined();
  });

  it.each(['up', 'down', 'left', 'right'] as const)(
    'animates the %s direction with default options',
    (direction) => {
      const el = createAnimateEl();
      slideIn(el, direction);
      expect(el.animate).toHaveBeenCalledTimes(1);
      expect(el.animate.mock.calls[0][1]).toEqual({
        duration: DURATION.slow,
        easing: EASING.sheet,
        fill: 'forwards',
      });
    },
  );

  it('honors explicit options', () => {
    const el = createAnimateEl();
    slideIn(el, 'left', { duration: 999, easing: 'linear', fill: 'both' });
    expect(el.animate.mock.calls[0][1]).toEqual({
      duration: 999,
      easing: 'linear',
      fill: 'both',
    });
  });
});

describe('slideOut', () => {
  it('returns undefined when el is falsy', () => {
    expect(slideOut(undefined, 'up')).toBeUndefined();
  });

  it.each(['up', 'down', 'left', 'right'] as const)(
    'animates the %s direction with default options',
    (direction) => {
      const el = createAnimateEl();
      slideOut(el, direction);
      expect(el.animate).toHaveBeenCalledTimes(1);
      expect(el.animate.mock.calls[0][1]).toEqual({
        duration: DURATION.normal,
        easing: EASING.accelerate,
        fill: 'forwards',
      });
    },
  );

  it('honors explicit options', () => {
    const el = createAnimateEl();
    slideOut(el, 'right', { duration: 999, easing: 'linear', fill: 'both' });
    expect(el.animate.mock.calls[0][1]).toEqual({
      duration: 999,
      easing: 'linear',
      fill: 'both',
    });
  });
});

// ---------------------------------------------------------------------------
// overlayOpen / overlayClose — real if/else-if/else branches per `type`
// (unlike the object-literal lookups above), so all four values must be
// exercised to hit every branch.
// ---------------------------------------------------------------------------

describe('overlayOpen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['center', 'bottom', 'left', 'right'] as const)(
    'schedules the panel animation for type=%s after the 30ms stagger',
    (type) => {
      const backdrop = createAnimateEl();
      const panel = createAnimateEl();
      const result = overlayOpen(backdrop, panel, type);

      // Backdrop fades in synchronously, before the stagger.
      expect(backdrop.animate).toHaveBeenCalledTimes(1);
      expect(result.backdrop).toBeDefined();

      // Panel animation is deferred behind setTimeout(..., 30) — it must not
      // have run yet, which is what makes this the branch under test rather
      // than a duplicate of the scaleIn/slideIn unit tests above.
      expect(panel.animate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30);

      // Firing the timer exercises the matching if/else-if/else arm for
      // `type` inside the callback (scaleIn for 'center', slideIn otherwise).
      expect(panel.animate).toHaveBeenCalledTimes(1);
    },
  );
});

describe('overlayClose', () => {
  const cases: Array<['center' | 'bottom' | 'left' | 'right', number]> = [
    ['center', 180],
    ['bottom', DURATION.normal],
    ['left', DURATION.normal],
    ['right', DURATION.normal],
  ];

  it.each(cases)(
    'animates type=%s and returns duration %i',
    (type, expectedDuration) => {
      const backdrop = createAnimateEl();
      const panel = createAnimateEl();

      const duration = overlayClose(backdrop, panel, type);

      // Panel exit animation and backdrop fade both run synchronously.
      expect(panel.animate).toHaveBeenCalledTimes(1);
      expect(backdrop.animate).toHaveBeenCalledTimes(1);
      expect(duration).toBe(expectedDuration);
    },
  );
});

// ---------------------------------------------------------------------------
// pressDown / pressRelease (transitionTransform)
//
// transitionTransform is private, so it's only reachable through these two
// exports. It guards with `el?.setStyle`, which is a distinct branch from a
// plain `!el` check: it also returns undefined for a truthy object missing
// `setStyle`, not just for a nullish `el`.
// ---------------------------------------------------------------------------

describe('pressDown / pressRelease', () => {
  it('pressDown returns undefined when el is undefined', () => {
    expect(pressDown(undefined)).toBeUndefined();
  });

  it('pressRelease returns undefined when el is undefined', () => {
    expect(pressRelease(undefined)).toBeUndefined();
  });

  it('pressDown returns undefined when el has no setStyle', () => {
    // A truthy object with no setStyle exercises the `?.` short-circuit
    // itself, as opposed to the `el` being nullish outright above.
    expect(pressDown({})).toBeUndefined();
  });

  it('pressRelease returns undefined when el has no setStyle', () => {
    expect(pressRelease({})).toBeUndefined();
  });

  it('pressDown applies the default press-down scale', () => {
    const el = { setStyle: vi.fn() };
    const handle = pressDown(el);
    expect(el.setStyle).toHaveBeenNthCalledWith(
      1,
      'transition',
      `transform ${DURATION.instant}ms ${EASING.standard}`,
    );
    expect(el.setStyle).toHaveBeenNthCalledWith(
      2,
      'transform',
      `scale(${SCALE.pressDown})`,
    );
    // cancel() is a real (if intentionally empty) function body — invoke it
    // so it registers for function coverage, not just declaration coverage.
    expect(() => handle?.cancel()).not.toThrow();
  });

  it('pressDown accepts an explicit scale overriding the default', () => {
    const el = { setStyle: vi.fn() };
    pressDown(el, 0.5);
    expect(el.setStyle).toHaveBeenNthCalledWith(2, 'transform', 'scale(0.5)');
  });

  it('pressRelease transitions back to full scale with spring easing', () => {
    const el = { setStyle: vi.fn() };
    const handle = pressRelease(el);
    expect(el.setStyle).toHaveBeenNthCalledWith(
      1,
      'transition',
      `transform ${DURATION.fast}ms ${EASING.spring}`,
    );
    expect(el.setStyle).toHaveBeenNthCalledWith(2, 'transform', 'scale(1)');
    handle?.cancel();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ChartDomain } from './cartesian-chart';

// Mock Angular so importing the component module doesn't require the framework
// runtime. Only the exported pure geometry fns are exercised here; the class
// field initializers (input/computed) never run because we never construct the
// component.
vi.mock('@angular/core', () => ({
  Component: () => () => {},
  ViewEncapsulation: { None: 0 },
  computed: () => () => {},
  input: () => () => {},
  signal: () => () => {},
}));

// The module now imports the gesture primitives at top level. They're only used
// inside class field initializers (which never run — we don't construct the
// component), so bare stubs are enough to satisfy the imports.
vi.mock('@blotch/angular-lynx', () => ({
  LYNX_ELEMENTS: [],
  LynxGestureDetector: class {},
  PanGesture: class {},
  PinchGesture: class {},
  Gesture: { Simultaneous: () => ({}) },
}));

const {
  linearScale,
  invertLinear,
  niceNum,
  niceScale,
  generateTicks,
  generateAlignedTicks,
  isValueOutsideDomain,
  gridlineOffset,
  sampleSmoothLine,
  clampWindow,
  panWindow,
  zoomWindow,
} = await import('./cartesian-chart');

describe('linearScale', () => {
  it('interpolates a value across the range', () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(100);
  });

  it('supports a descending range (flipped y-axis)', () => {
    const scale = linearScale([0, 100], [180, 0]);
    expect(scale(0)).toBe(180);
    expect(scale(50)).toBe(90);
    expect(scale(100)).toBe(0);
  });

  it('collapses a zero-width domain to the range midpoint', () => {
    const scale = linearScale([5, 5], [0, 200]);
    expect(scale(5)).toBe(100);
    expect(scale(999)).toBe(100);
  });
});

describe('niceNum', () => {
  it('rounds a range up to a nice number', () => {
    expect(niceNum(97, false)).toBe(100);
    expect(niceNum(85, false)).toBe(100);
    expect(niceNum(10, false)).toBe(10);
  });

  it('snaps a step to the nearest nice number', () => {
    expect(niceNum(25, true)).toBe(20);
    expect(niceNum(20, true)).toBe(20);
    expect(niceNum(2, true)).toBe(2);
  });

  it('returns 0 for non-positive input', () => {
    expect(niceNum(0, true)).toBe(0);
    expect(niceNum(-5, false)).toBe(0);
  });
});

describe('niceScale', () => {
  it('produces a rounded domain that contains the data', () => {
    const { domain } = niceScale(3, 88, 5);
    expect(domain[0]).toBeLessThanOrEqual(3);
    expect(domain[1]).toBeGreaterThanOrEqual(88);
  });

  it('generates ticks that span the domain endpoints', () => {
    const { domain, ticks, step } = niceScale(0, 100, 5);
    expect(step).toBeGreaterThan(0);
    expect(ticks[0]).toBe(domain[0]);
    expect(ticks[ticks.length - 1]).toBe(domain[1]);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(domain[0]);
      expect(tick).toBeLessThanOrEqual(domain[1]);
    }
  });

  it('pads flat data around the single value', () => {
    const { domain } = niceScale(5, 5, 5);
    expect(domain[0]).toBeLessThan(5);
    expect(domain[1]).toBeGreaterThan(5);
    expect(Number.isFinite(domain[0])).toBe(true);
    expect(Number.isFinite(domain[1])).toBe(true);
  });
});

describe('generateTicks', () => {
  it('evenly divides a domain into count ticks', () => {
    expect(generateTicks([0, 10], 5)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(generateTicks([0, 100], 3)).toEqual([0, 50, 100]);
  });

  it('returns a single tick when count is 1', () => {
    expect(generateTicks([0, 10], 1)).toEqual([0]);
  });
});

// Regression guard for the "grid stays still while panning" bug. The report:
// zoomed-in pan moves the plotted content but the gridlines/tick marks stay
// put — only the axis numbers update. Root cause: the old zoomable-tick
// generator (generateTicks) divided the CURRENT window into a fixed fraction
// per tick, so every tick always lands at the same `i/(count-1)` pixel no
// matter where the window is. generateAlignedTicks fixes this by anchoring
// each tick to a fixed multiple of a step in DATA space instead.
describe('generateAlignedTicks', () => {
  it('returns a fixed count of targetCount + 2 regardless of the window', () => {
    expect(generateAlignedTicks([0, 100], 5)).toHaveLength(7);
    expect(generateAlignedTicks([37, 57], 5)).toHaveLength(7);
    expect(generateAlignedTicks([1000, 1050], 5)).toHaveLength(7);
  });

  it('anchors ticks to fixed data-space multiples of a nice step — panning shifts WHICH multiples are visible, not the multiples themselves', () => {
    // Two windows of the same span (20) as if panned right by 6 data units —
    // a real drag never changes the window's span, only its position.
    const before = generateAlignedTicks([40, 60], 5);
    const after = generateAlignedTicks([46, 66], 5);
    const step = 5; // niceNum(20 / 4, true)
    for (const t of [...before, ...after]) {
      expect(t % step).toBeCloseTo(0, 6);
    }
    // Ticks still inside the post-pan window must appear UNCHANGED in both
    // arrays — proof the grid is anchored to fixed data values, not
    // recomputed as a fraction of the (shifted) window.
    const stillVisible = before.filter((t) => t >= 46 && t <= 60);
    expect(stillVisible.length).toBeGreaterThan(0);
    for (const t of stillVisible) {
      expect(after).toContain(t);
    }
  });

  it('projects an anchored tick to a shifted pixel after a pan (the actual visual fix)', () => {
    const rangePx = 200;
    const project = (value: number, window: ChartDomain) =>
      linearScale(window, [0, rangePx])(value);

    const before: ChartDomain = [40, 60];
    const after: ChartDomain = [46, 66]; // panned right by 6 data units
    const common = generateAlignedTicks(before, 5).filter((t) =>
      generateAlignedTicks(after, 5).includes(t),
    );
    expect(common.length).toBeGreaterThan(0);
    for (const t of common) {
      const pxBefore = project(t, before);
      const pxAfter = project(t, after);
      // The old (buggy) generateTicks-based ticks always re-projected to the
      // exact same pixel here; an anchored tick must NOT.
      expect(pxAfter).not.toBeCloseTo(pxBefore, 3);
      // Panning the window +6 data units shifts every fixed value left by
      // 6/20 of the range.
      expect(pxBefore - pxAfter).toBeCloseTo((6 / 20) * rangePx, 6);
    }
  });

  it('falls back to a step of 1 for a zero-width window instead of dividing by zero', () => {
    expect(() => generateAlignedTicks([5, 5], 5)).not.toThrow();
    expect(generateAlignedTicks([5, 5], 5).every(Number.isFinite)).toBe(true);
  });
});

// Regression guard for the "top axis number cut in half" bug. The zoomable
// tick generator emits buffer ticks just past each edge of the window; their
// labels must be hidden, but a legitimate edge label (value exactly on the
// domain bound) must NOT be — hiding it, or clipping it at the container box,
// is what sliced the top "100" in half at 1:1.
describe('isValueOutsideDomain', () => {
  it('treats a value exactly on either bound as inside (edge labels stay visible)', () => {
    expect(isValueOutsideDomain(0, [0, 100])).toBe(false);
    expect(isValueOutsideDomain(100, [0, 100])).toBe(false);
  });

  it('flags buffer ticks beyond either edge as outside', () => {
    // generateAlignedTicks([0,100], 5) yields e.g. -20 and would extend past
    // 100 — those must hide; the in-range multiples must not.
    expect(isValueOutsideDomain(-20, [0, 100])).toBe(true);
    expect(isValueOutsideDomain(120, [0, 100])).toBe(true);
    expect(isValueOutsideDomain(40, [0, 100])).toBe(false);
  });

  it('does not exclude an on-bound tick lost to float drift', () => {
    // A window bound that arrived via pan/zoom arithmetic can land a hair off
    // the tick value; the relative epsilon must keep it visible.
    expect(isValueOutsideDomain(100, [0, 99.99999999])).toBe(false);
    expect(isValueOutsideDomain(0, [0.00000001, 100])).toBe(false);
  });

  it('scales epsilon with the span (a genuinely-outside tick still hides on a large domain)', () => {
    expect(isValueOutsideDomain(1_000_050, [0, 1_000_000])).toBe(true);
    expect(isValueOutsideDomain(1_000_000, [0, 1_000_000])).toBe(false);
  });
});

// Regression guard for the "y-axis 0 gridline isn't visible" bug. The plot needs
// `overflow: hidden` to clip panned marks, but a 1px gridline whose value sits on
// the plot's far edge projects to exactly `extent` — one row/column past the box —
// so the clip eats it. gridlineOffset nudges an in-window edge line back inside;
// out-of-window buffer ticks stay put so they clip away instead of piling up.
describe('gridlineOffset', () => {
  it('nudges an in-window far-edge line inward so overflow:hidden cannot clip it', () => {
    // y = domain min projects to `extent` (bottom of a flipped y-scale); a 1px
    // line there is fully outside, so it clamps to extent - thickness.
    expect(gridlineOffset(0, 200, [0, 100], 200)).toBe(199);
    // The near edge (top / left = 0) is already inside and is left untouched.
    expect(gridlineOffset(100, 0, [0, 100], 200)).toBe(0);
  });

  it('leaves an interior line exactly where it projects', () => {
    expect(gridlineOffset(50, 100, [0, 100], 200)).toBe(100);
  });

  it('does not clamp an out-of-window buffer tick (it must clip away, not pile on the edge)', () => {
    // generateAlignedTicks emits ticks just past each edge while panning. Below
    // the window it projects past `extent`; above it projects negative. Both are
    // returned as-is so the plot clip hides them rather than dragging them onto
    // the visible edge as a spurious doubled line.
    expect(gridlineOffset(-20, 260, [0, 100], 200)).toBe(260);
    expect(gridlineOffset(120, -60, [0, 100], 200)).toBe(-60);
  });

  it('honors a custom gridline thickness', () => {
    expect(gridlineOffset(0, 200, [0, 100], 200, 2)).toBe(198);
  });
});

describe('sampleSmoothLine', () => {
  it('returns fewer-than-three points unchanged (no curve possible)', () => {
    expect(sampleSmoothLine([])).toEqual([]);
    expect(sampleSmoothLine([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(
      sampleSmoothLine([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it('passes exactly through every original data point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 8 },
      { x: 2, y: 3 },
      { x: 3, y: 10 },
    ];
    const curve = sampleSmoothLine(points, 8);
    for (const p of points) {
      const hit = curve.find((c) => Math.abs(c.x - p.x) < 1e-9);
      expect(hit).toBeDefined();
      expect(hit?.y).toBeCloseTo(p.y);
    }
  });

  it('keeps a straight line straight (collinear points do not bow)', () => {
    // y = 2x sampled at the curve's x values must stay on the line.
    const curve = sampleSmoothLine(
      [
        { x: 0, y: 0 },
        { x: 5, y: 10 },
        { x: 10, y: 20 },
      ],
      6,
    );
    for (const c of curve) {
      expect(c.y).toBeCloseTo(c.x * 2);
    }
  });

  it('never overshoots the data range (monotone: no bulge past a peak)', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 10 },
      { x: 3, y: 0 },
    ];
    const curve = sampleSmoothLine(points, 16);
    const ys = curve.map((c) => c.y);
    // The plateau at 10 is the max and 0 the min — a monotone cubic must stay
    // inside them (Catmull-Rom would overshoot above 10 approaching the plateau).
    expect(Math.max(...ys)).toBeLessThanOrEqual(10 + 1e-9);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0 - 1e-9);
  });

  it('emits a denser, x-ascending point set', () => {
    const curve = sampleSmoothLine(
      [
        { x: 0, y: 0 },
        { x: 1, y: 5 },
        { x: 2, y: 2 },
      ],
      10,
    );
    // 2 segments × 10 samples + 1 closing point.
    expect(curve).toHaveLength(21);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].x).toBeGreaterThanOrEqual(curve[i - 1].x);
    }
  });
});

describe('invertLinear', () => {
  it('is the inverse of linearScale', () => {
    const domain = [0, 10] as const;
    const range = [0, 100] as const;
    const scale = linearScale(domain, range);
    for (const v of [0, 2.5, 5, 7.5, 10]) {
      expect(invertLinear(domain, range, scale(v))).toBeCloseTo(v);
    }
  });

  it('inverts a descending (flipped y) range', () => {
    // linearScale([0,100],[180,0])(50) === 90 → invert back to 50.
    expect(invertLinear([0, 100], [180, 0], 90)).toBeCloseTo(50);
    expect(invertLinear([0, 100], [180, 0], 180)).toBeCloseTo(0);
    expect(invertLinear([0, 100], [180, 0], 0)).toBeCloseTo(100);
  });

  it('collapses a zero-width range to the domain lower bound', () => {
    expect(invertLinear([2, 8], [50, 50], 999)).toBe(2);
  });
});

describe('clampWindow', () => {
  it('leaves a window already inside the base untouched', () => {
    expect(clampWindow([0, 10], [2, 6])).toEqual([2, 6]);
  });

  it('slides a window back inside the base, preserving its span', () => {
    expect(clampWindow([0, 10], [8, 14])).toEqual([4, 10]);
    expect(clampWindow([0, 10], [-3, 2])).toEqual([0, 5]);
  });

  it('caps a window wider than the base to the whole base', () => {
    expect(clampWindow([0, 10], [-5, 20])).toEqual([0, 10]);
  });
});

describe('panWindow', () => {
  it('shifts the window by a data delta', () => {
    expect(panWindow([0, 10], [2, 6], 1)).toEqual([3, 7]);
  });

  it('stops (does not resize) at either edge', () => {
    // Preserves the span of 4, clamped against the right and left edges.
    expect(panWindow([0, 10], [2, 6], 10)).toEqual([6, 10]);
    expect(panWindow([0, 10], [2, 6], -10)).toEqual([0, 4]);
  });
});

// Regression guard for the pan interaction. The bug: on iOS AND Android the
// native pan handler gates onStart/onEnd behind onBegin having fired, so a pan
// that registers only onStart/onUpdate/onEnd never snapshots the start window and
// #onPan re-reads the CURRENT window every frame — making the pan compound instead
// of tracking the finger 1:1. The fix registers onBegin to anchor the window once
// at gesture start. These tests lock the geometry that anchoring must produce, and
// pin down the compounding failure mode so it can't silently return.
describe('pan tracks the finger 1:1 (window anchored at gesture start)', () => {
  /**
   * Projects a data x into plot pixels through a given visible window, matching how
   * xScale maps the effective domain across the plot range.
   */
  const projectX = (
    dataX: number,
    window: readonly [number, number],
    rangePx: number,
  ) => ((dataX - window[0]) / (window[1] - window[0])) * rangePx;

  it('moves projected content exactly translationX pixels for any cumulative delta', () => {
    const base: ChartDomain = [0, 100];
    const start: ChartDomain = [40, 60]; // zoomed 5× (span 20 of a 100 domain)
    const rangePx = 200;
    const dataPerPx = (start[1] - start[0]) / rangePx; // 0.1 data units / px

    const pointX = 45; // any data point inside the window
    const startPx = projectX(pointX, start, rangePx);

    // A steady drag is reported as a CUMULATIVE translation (0 → growing). Each
    // frame maps it against the FIXED start window (what onBegin snapshots).
    for (const translationX of [5, 12, 40, -18, -35]) {
      const window = panWindow(base, start, -translationX * dataPerPx);
      const nowPx = projectX(pointX, window, rangePx);
      // 1:1: the point moved on screen by exactly the finger's travel.
      expect(nowPx - startPx).toBeCloseTo(translationX, 6);
    }
  });

  it('compounds (the bug) when the window is re-read every frame instead of anchored', () => {
    const base: ChartDomain = [0, 100];
    const rangePx = 200;
    const dataPerPx = 20 / rangePx; // 0.1

    // Correct path: fixed start window, cumulative translation. A 10 px/frame drag
    // over 3 frames (cumulative 10, 20, 30) shifts the window left by 30·0.1 = 3.
    const start: ChartDomain = [40, 60];
    const anchored = panWindow(base, start, -30 * dataPerPx);
    expect(anchored[0]).toBeCloseTo(37, 6);

    // Buggy path: use the CURRENT window as the base each frame (because the start
    // was never snapshotted). The same drag drives the window much further left —
    // the shift accumulates super-linearly.
    let window: ChartDomain = [40, 60];
    for (const cumulative of [10, 20, 30]) {
      window = panWindow(base, window, -cumulative * dataPerPx);
    }
    expect(window[0]).toBeLessThan(37);
    // Concretely: 40 → 39 → 37 → 34, i.e. 2× the correct shift after 3 frames.
    expect(window[0]).toBeCloseTo(34, 6);
  });
});

describe('zoomWindow', () => {
  it('zooms in around the focal value, keeping it fixed', () => {
    // 2× zoom on the center halves the span and stays centered.
    expect(zoomWindow([0, 10], [0, 10], 2, 5, 8)).toEqual([2.5, 7.5]);
    // Focal at the left edge keeps that edge pinned.
    expect(zoomWindow([0, 10], [0, 10], 2, 0, 8)).toEqual([0, 5]);
  });

  it('clamps zoom-in to maxZoom (min span = baseSpan / maxZoom)', () => {
    const [lo, hi] = zoomWindow([0, 10], [0, 10], 100, 5, 8);
    expect(hi - lo).toBeCloseTo(10 / 8); // 1.25, not 0.1
  });

  it('never zooms out past the full base domain', () => {
    expect(zoomWindow([0, 10], [2.5, 7.5], 0.1, 5, 8)).toEqual([0, 10]);
  });

  it('honors minZoom as an upper bound on the visible span', () => {
    // minZoom 2 → the window can never be wider than baseSpan / 2 = 5.
    const [lo, hi] = zoomWindow([0, 10], [3, 4], 0.01, 3.5, 8, 2);
    expect(hi - lo).toBeCloseTo(5);
  });
});

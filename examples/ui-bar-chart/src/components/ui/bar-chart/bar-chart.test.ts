import { describe, expect, it, vi } from 'vitest';

// Mock Angular (and the transitively-loaded cartesian-chart Angular usage) so
// importing the module needs no framework runtime. Only the exported pure
// `computeBars` is exercised; the components are never built.
vi.mock('@angular/core', () => ({
  Component: () => () => {},
  ViewEncapsulation: { None: 0 },
  computed: () => () => {},
  inject: () => ({}),
  input: () => () => {},
  output: () => () => {},
}));

vi.mock('@blotch/angular-lynx', () => ({
  LYNX_ELEMENTS: [],
  // cartesian-chart (imported transitively) registers these in its decorator.
  LynxGestureDetector: class {},
  PanGesture: class {},
  PinchGesture: class {},
  Gesture: { Simultaneous: () => ({}) },
}));

const { computeBars } = await import('./bar-chart');

// Screen y grows downward, so a value ABOVE the baseline has a SMALLER pixel y
// than baseY. Baseline pixel y = 100 in these cases (bottom of the plot).
describe('computeBars', () => {
  it('draws a positive bar from the baseline up to the value, centered on cx', () => {
    // value projects to y=30 (above the baseline at y=100).
    const [bar] = computeBars([{ cx: 50, valueY: 30 }], 100, 12);
    expect(bar.top).toBe(30); // min(valueY, baseY) — the higher edge
    expect(bar.height).toBe(70); // |valueY - baseY|
    expect(bar.width).toBe(12);
    expect(bar.left).toBe(50 - 6); // cx - barWidth/2
  });

  it('draws a negative bar growing downward from the baseline', () => {
    // value projects BELOW the baseline, so valueY (140) > baseY (100).
    const [bar] = computeBars([{ cx: 20, valueY: 140 }], 100, 10);
    expect(bar.top).toBe(100); // min(valueY, baseY) = baseY here
    expect(bar.height).toBe(40); // grows down to the value
  });

  it('draws nothing (zero height) for a value exactly on the baseline', () => {
    // A bar's height is its datum: on the baseline there is nothing to draw, so
    // the default minBarHeight of 0 leaves it invisible rather than a sliver.
    const [bar] = computeBars([{ cx: 0, valueY: 100 }], 100, 12);
    expect(bar.height).toBe(0);
  });

  it('honors a custom minimum bar height', () => {
    const [bar] = computeBars([{ cx: 0, valueY: 100 }], 100, 12, 3);
    expect(bar.height).toBe(3);
  });

  it('centers every bar on its own cx', () => {
    const bars = computeBars(
      [
        { cx: 10, valueY: 40 },
        { cx: 60, valueY: 20 },
      ],
      100,
      8,
    );
    expect(bars[0].left).toBe(10 - 4);
    expect(bars[1].left).toBe(60 - 4);
  });

  it('returns an empty array for no bars', () => {
    expect(computeBars([], 100, 12)).toEqual([]);
  });
});

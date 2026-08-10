import { describe, expect, it, vi } from 'vitest';

// Mock Angular (and the transitively-loaded cartesian-chart Angular usage) so
// importing the module needs no framework runtime. Only the exported pure
// `computeDots` is exercised; the components are never built.
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

const { computeDots } = await import('./scatter-chart');

describe('computeDots', () => {
  it('centers a dot on its point (top-left offset by the radius)', () => {
    const [dot] = computeDots([{ cx: 50, cy: 30, r: 4 }]);
    expect(dot.left).toBe(46); // cx - r
    expect(dot.top).toBe(26); // cy - r
    expect(dot.size).toBe(8); // r * 2 — the box the circle fills
  });

  it('honors a per-point radius (a bubble chart)', () => {
    const [small, big] = computeDots([
      { cx: 10, cy: 10, r: 2 },
      { cx: 40, cy: 40, r: 9 },
    ]);
    expect(small.size).toBe(4);
    expect(small.left).toBe(8);
    expect(big.size).toBe(18);
    expect(big.left).toBe(31); // 40 - 9
  });

  it('keeps each dot centered on its own coordinates', () => {
    const dots = computeDots([
      { cx: 0, cy: 100, r: 3 },
      { cx: 100, cy: 0, r: 3 },
    ]);
    expect(dots[0]).toEqual({ left: -3, top: 97, size: 6 });
    expect(dots[1]).toEqual({ left: 97, top: -3, size: 6 });
  });

  it('returns an empty array for no points', () => {
    expect(computeDots([])).toEqual([]);
  });
});

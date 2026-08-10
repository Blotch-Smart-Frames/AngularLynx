import { describe, expect, it, vi } from 'vitest';

// Mock Angular (and the transitively-loaded line-chart / cartesian-chart Angular
// usage) so importing the module needs no framework runtime. Only the exported
// pure `computeAreaColumns` is exercised; components are never built.
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

const { computeAreaColumns } = await import('./area-chart');

describe('computeAreaColumns', () => {
  it('fills a flat line down to the baseline with uniform columns', () => {
    // Horizontal line at pixel y=20, baseline at y=100, 30px plot, 10px strips.
    const columns = computeAreaColumns(
      [
        { x: 0, y: 20 },
        { x: 30, y: 20 },
      ],
      100,
      30,
      10,
    );
    expect(columns.map((c) => c.x)).toEqual([0, 10, 20]);
    for (const column of columns) {
      expect(column.top).toBeCloseTo(20);
      expect(column.height).toBeCloseTo(80);
    }
  });

  it('fills on both sides when the line crosses the baseline', () => {
    // Line y = x from (0,0) to (100,100); baseline pixel y = 50.
    const columns = computeAreaColumns(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      50,
      100,
      50,
    );
    expect(columns).toHaveLength(2);
    // Strip centered at x=25 → line above the baseline: top at the line, down to it.
    expect(columns[0].top).toBeCloseTo(25);
    expect(columns[0].height).toBeCloseTo(25);
    // Strip centered at x=75 → line below the baseline: top at the baseline.
    expect(columns[1].top).toBeCloseTo(50);
    expect(columns[1].height).toBeCloseTo(25);
  });

  it('skips strips whose center falls outside the data x-range', () => {
    // Data spans x=[40,60] but the plot is 100 wide → only strips inside fill.
    const columns = computeAreaColumns(
      [
        { x: 40, y: 10 },
        { x: 60, y: 10 },
      ],
      100,
      100,
      10,
    );
    expect(columns.map((c) => c.x)).toEqual([40, 50]);
    expect(columns.every((c) => c.x >= 40 && c.x <= 60)).toBe(true);
  });

  it('skips columns where the line sits on the baseline', () => {
    // Flat line exactly at the baseline → zero height everywhere, nothing to fill.
    const columns = computeAreaColumns(
      [
        { x: 0, y: 50 },
        { x: 30, y: 50 },
      ],
      50,
      30,
      10,
    );
    expect(columns).toEqual([]);
  });

  it('returns no columns for fewer than two points', () => {
    expect(computeAreaColumns([], 100, 100, 10)).toEqual([]);
    expect(computeAreaColumns([{ x: 0, y: 0 }], 100, 100, 10)).toEqual([]);
  });

  it('returns no columns for a non-positive plot width', () => {
    expect(
      computeAreaColumns(
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        100,
        0,
        10,
      ),
    ).toEqual([]);
  });
});

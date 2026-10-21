import { describe, expect, it } from 'vitest';
import { linearAxis, minSpacing, presetAxes } from './chart-presets';

/**
 * The configured domain of an axis config's scale instance.
 */
const domainOf = (axis: { scale: unknown }): number[] =>
  (axis.scale as { domain: () => number[] }).domain();

describe('linearAxis', () => {
  const base = { tickCount: 5, grid: true };

  it('fits the data and rounds out to nice values', () => {
    expect(domainOf(linearAxis({ ...base, values: [3, 47] }))).toEqual([0, 50]);
  });

  it('keeps fixed ends exact and rounds only the free one', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [3, 47], min: 1, max: 2 })),
    ).toEqual([1, 2]);
    expect(domainOf(linearAxis({ ...base, values: [3, 47], min: 1 }))).toEqual([
      1, 50,
    ]);
  });

  it('includes extra values, such as a baseline', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [5, 10], include: [0] })),
    ).toEqual([0, 10]);
  });

  it('gives flat and empty data a span around the value', () => {
    expect(domainOf(linearAxis({ ...base, values: [10, 10] }))).toEqual([
      4, 16,
    ]);
    expect(domainOf(linearAxis({ ...base, values: [0] }))).toEqual([-1, 1]);
    expect(domainOf(linearAxis({ ...base, values: [] }))).toEqual([0, 1]);
    expect(domainOf(linearAxis({ ...base, values: [Number.NaN] }))).toEqual([
      0, 1,
    ]);
  });

  it('orders reversed fixed ends', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [], min: 10, max: 0 })),
    ).toEqual([0, 10]);
  });

  it('widens by a margin, then by padding fractions', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [], min: 0, max: 10, margin: 1 })),
    ).toEqual([-1, 11]);
    // 10% each side of a 0–8 domain: the plot spans 10 units, inset 1 each side.
    const [lo, hi] = domainOf(
      linearAxis({ ...base, values: [], min: 0, max: 8, padding: [0.1, 0.1] }),
    );
    expect(lo).toBeCloseTo(-1);
    expect(hi).toBeCloseTo(9);
    // Padding that leaves no plot is ignored.
    expect(
      domainOf(
        linearAxis({
          ...base,
          values: [],
          min: 0,
          max: 8,
          padding: [0.6, 0.6],
        }),
      ),
    ).toEqual([0, 8]);
  });

  it('configures grid, label and ticks', () => {
    const format = (value: number) => `${value}%`;
    const axis = linearAxis({
      ...base,
      values: [0, 1],
      label: 'Share',
      format,
      grid: false,
    });
    expect(axis.grid).toBe(false);
    expect(axis.axis).toEqual({ label: 'Share', ticks: { count: 5, format } });
    expect(
      (
        linearAxis({ ...base, values: [0, 1], label: '' }).axis as {
          label?: string;
        }
      ).label,
    ).toBeUndefined();
  });
});

describe('minSpacing', () => {
  it('finds the smallest gap between distinct values', () => {
    expect(minSpacing([5, 1, 3, 3, 4])).toBe(1);
    expect(minSpacing([0, 10])).toBe(10);
  });

  it('defaults to 1 without a gap', () => {
    expect(minSpacing([])).toBe(1);
    expect(minSpacing([2])).toBe(1);
    expect(minSpacing([2, 2])).toBe(1);
  });
});

describe('presetAxes', () => {
  it('maps the shared options onto both axes', () => {
    const axes = presetAxes(
      {
        tickCount: 3,
        showGrid: false,
        showXGrid: true,
        xAxisLabel: 'X',
        yAxisLabel: 'Y',
        padding: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
        xMin: 0,
        xMax: 8,
        yMin: 0,
        yMax: 8,
      },
      { x: [], y: [], xMargin: 0 },
    );
    expect(axes.x.grid).toBe(true);
    expect(axes.y.grid).toBe(false);
    expect(axes.x.axis).toMatchObject({ label: 'X', ticks: { count: 3 } });
    expect(axes.y.axis).toMatchObject({ label: 'Y' });
    expect(domainOf(axes.x)[0]).toBeCloseTo(-1);
    expect(domainOf(axes.y)[1]).toBeCloseTo(9);
  });

  it('defaults to five ticks, a y grid and no padding', () => {
    const axes = presetAxes({}, { x: [0, 10], y: [0, 10], yInclude: [-5] });
    expect(axes.x.grid).toBe(false);
    expect(axes.y.grid).toBe(true);
    expect(domainOf(axes.x)).toEqual([0, 10]);
    expect(domainOf(axes.y)).toEqual([-10, 10]);
  });
});

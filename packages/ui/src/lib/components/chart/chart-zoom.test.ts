import { describe, expect, it } from 'vitest';
import type { ResolvedScale } from '@tanstack/charts/types';
import {
  axisContentWindow,
  axisVisibleWindow,
  clampWindow,
  isFullWindow,
  panWindow,
  toViewportDomain,
  withViewport,
  zoomWindow,
} from './chart-zoom';

const scale = (
  domain: readonly unknown[],
  extra: Partial<ResolvedScale> = {},
): ResolvedScale =>
  ({
    id: 'x',
    type: 'linear',
    domain,
    map: () => 0,
    ticks: [],
    bandwidth: 0,
    ...extra,
  }) as ResolvedScale;

describe('window math', () => {
  it('clamps a window inside the base, keeping its span', () => {
    expect(clampWindow([0, 10], [8, 12])).toEqual([6, 10]);
    expect(clampWindow([0, 10], [-3, 1])).toEqual([0, 4]);
    expect(clampWindow([0, 10], [-5, 20])).toEqual([0, 10]);
  });

  it('pans by a data delta, stopping at the edges', () => {
    expect(panWindow([0, 10], [2, 4], 3)).toEqual([5, 7]);
    expect(panWindow([0, 10], [2, 4], 100)).toEqual([8, 10]);
  });

  it('zooms around a focal value within the zoom limits', () => {
    expect(zoomWindow([0, 10], [0, 10], 2, 5, 8)).toEqual([2.5, 7.5]);
    // Never past maxZoom…
    expect(zoomWindow([0, 10], [4, 6], 100, 5, 4)).toEqual([3.75, 6.25]);
    // …nor out past the whole base.
    expect(zoomWindow([0, 10], [4, 6], 0.01, 5, 8)).toEqual([0, 10]);
    // A zero factor counts as 1, and zero limits mean the base span.
    expect(zoomWindow([0, 10], [0, 10], 0, 5, 0, 0)).toEqual([0, 10]);
    // A zero-width window zooms about its middle.
    expect(zoomWindow([0, 10], [5, 5], 1, 5, 8)).toEqual([4.375, 5.625]);
  });

  it('knows a window covering the base is at rest', () => {
    expect(isFullWindow([0, 10], [0, 10])).toBe(true);
    expect(isFullWindow([0, 10], [0, 9])).toBe(false);
    expect(isFullWindow([3, 3], [3, 3])).toBe(true);
  });
});

describe('axis windows', () => {
  it('reads a continuous axis as numbers, ordered', () => {
    expect(axisContentWindow(scale([0, 10]))).toEqual([0, 10]);
    expect(axisContentWindow(scale([10, 0]))).toEqual([0, 10]);
    expect(axisContentWindow(scale([new Date(1), new Date(5)]))).toEqual([
      1, 5,
    ]);
  });

  it("prefers a viewport's complete content domain", () => {
    expect(
      axisContentWindow(
        scale([2, 4], {
          viewport: {
            contentDomain: [0, 10],
            domain: [2, 4],
            translate: 0,
            map: () => 0,
          },
        }),
      ),
    ).toEqual([0, 10]);
  });

  it("rejects axes that can't zoom", () => {
    expect(axisContentWindow(undefined)).toBeNull();
    expect(axisContentWindow(scale(['a', 'b'], { bandwidth: 20 }))).toBeNull();
    expect(axisContentWindow(scale([1, 2, 3]))).toBeNull();
    expect(axisContentWindow(scale([1, 1]))).toBeNull();
    expect(axisContentWindow(scale(['a', 'b']))).toBeNull();
    expect(axisContentWindow(scale([0, Number.NaN]))).toBeNull();
  });

  it('reads the visible window from the viewport, else the whole axis', () => {
    const viewport = (domain: readonly unknown[]) =>
      scale([0, 10], {
        viewport: {
          contentDomain: [0, 10],
          domain: domain as never,
          translate: 0,
          map: () => 0,
        },
      });
    expect(axisVisibleWindow(viewport([6, 2]))).toEqual([2, 6]);
    expect(axisVisibleWindow(viewport(['a', 'b']))).toEqual([0, 10]);
    expect(axisVisibleWindow(scale([0, 10]))).toEqual([0, 10]);
    expect(axisVisibleWindow(undefined)).toBeNull();
  });

  it("converts a window to the axis's value type", () => {
    expect(toViewportDomain([1, 2], scale([0, 10]))).toEqual([1, 2]);
    expect(
      toViewportDomain([1, 2], scale([new Date(0), new Date(10)])),
    ).toEqual([new Date(1), new Date(2)]);
  });
});

describe('withViewport', () => {
  const definition = {
    marks: [],
    scales: { x: { scale: 'x-scale' }, y: { scale: 'y-scale' } },
  } as never;

  it('returns the definition untouched without a window', () => {
    expect(withViewport(definition, {})).toBe(definition);
  });

  it('sets the viewport on the windowed, configured axes', () => {
    const result = withViewport(definition, { x: [1, 2] }) as {
      scales: Record<string, unknown>;
    };
    expect(result.scales['x']).toEqual({
      scale: 'x-scale',
      viewport: { domain: [1, 2] },
    });
    expect(result.scales['y']).toEqual({ scale: 'y-scale' });
  });

  it('skips axes the definition leaves to inference', () => {
    const partial = { marks: [], scales: { y: { scale: 'y' } } } as never;
    expect(withViewport(partial, { x: [1, 2] })).toEqual(partial);
    const none = { marks: [] } as never;
    expect(withViewport(none, { x: [1, 2] })).toBe(none);
  });

  it("applies the viewport to a responsive definition's spec", () => {
    const responsive = {
      chart: () => ({ marks: [], scales: { x: { scale: 's' } } }),
      tooltip: false,
    } as never;
    const result = withViewport(responsive, { x: [3, 4] }) as {
      chart: (context: unknown) => { scales: Record<string, unknown> };
      tooltip: boolean;
    };
    expect(result.tooltip).toBe(false);
    expect(result.chart({}).scales['x']).toEqual({
      scale: 's',
      viewport: { domain: [3, 4] },
    });
  });
});

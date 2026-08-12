import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCartesianChart } from '../cartesian-chart/cartesian-chart';
import { UiScatterChart, UiScatterSeries } from './scatter-chart';

describe('UiScatterChart', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiScatterChart);
    expect(container).toBeTruthy();
  });

  it('derives axis domains from the data extremes', async () => {
    const { componentRef } = await render(UiScatterChart);
    const inst = componentRef.instance as UiScatterChart;
    setInputSignal(inst.data, [
      { x: 0, y: 0 },
      { x: 5, y: 8 },
      { x: 10, y: 3 },
    ]);
    await waitForUpdate();
    const cast = inst as unknown as {
      xAxis: () => { domain: readonly [number, number] };
      yAxis: () => { domain: readonly [number, number] };
      effectivePadding: () => {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
      };
    };
    expect(cast.xAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.xAxis().domain[1]).toBeGreaterThanOrEqual(10);
    expect(cast.yAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.yAxis().domain[1]).toBeGreaterThanOrEqual(8);
    // Default SCATTER_INSET on every side.
    expect(cast.effectivePadding().top).toBeCloseTo(0.04);
    expect(cast.effectivePadding().right).toBeCloseTo(0.04);
    expect(cast.effectivePadding().bottom).toBeCloseTo(0.04);
    expect(cast.effectivePadding().left).toBeCloseTo(0.04);
  });

  it('honors explicit xMin / xMax / yMin / yMax overrides', async () => {
    const { componentRef } = await render(UiScatterChart);
    const inst = componentRef.instance as UiScatterChart;
    setInputSignal(inst.data, [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    setInputSignal(inst.xMin, -5);
    setInputSignal(inst.xMax, 20);
    setInputSignal(inst.yMin, -1);
    setInputSignal(inst.yMax, 15);
    await waitForUpdate();
    const cast = inst as unknown as {
      xAxis: () => { domain: readonly [number, number] };
      yAxis: () => { domain: readonly [number, number] };
    };
    expect(cast.xAxis().domain[0]).toBeLessThanOrEqual(-5);
    expect(cast.xAxis().domain[1]).toBeGreaterThanOrEqual(20);
    expect(cast.yAxis().domain[0]).toBeLessThanOrEqual(-1);
    expect(cast.yAxis().domain[1]).toBeGreaterThanOrEqual(15);
  });

  it('user padding overrides individual sides of the default inset', async () => {
    const { componentRef } = await render(UiScatterChart);
    const inst = componentRef.instance as UiScatterChart;
    setInputSignal(inst.padding, { top: 0.2 });
    await waitForUpdate();
    const cast = inst as unknown as {
      effectivePadding: () => {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
      };
    };
    expect(cast.effectivePadding().top).toBeCloseTo(0.2);
    expect(cast.effectivePadding().left).toBeCloseTo(0.04);
  });

  it('exposes the default tick formatter used by the child cartesian chart', async () => {
    const { componentRef } = await render(UiScatterChart);
    const inst = componentRef.instance as UiScatterChart;
    expect(inst.xTickFormat()(3.14159)).toBe('3.14');
    expect(inst.yTickFormat()(1.005)).toBe('1');
  });
});

describe('UiScatterSeries', () => {
  const renderSeries = async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 10]);
    await waitForUpdate();
    const seriesResult = await render(UiScatterSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiScatterSeries;
    setInputSignal(series.data, [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    await waitForUpdate();
    return { parent, series };
  };

  it('renders a circular dot per datum with the fallback color', async () => {
    const { series } = await renderSeries();
    const cast = series as unknown as {
      dots: () => { style: string; point: { x: number; y: number } }[];
    };
    const dots = cast.dots();
    expect(dots.length).toBe(3);
    for (const d of dots) {
      expect(d.style).toContain('background-color: var(--primary)');
      expect(d.style).toContain('border-radius');
    }
  });

  it('cycles through the per-dot palette when colors are provided', async () => {
    const { series } = await renderSeries();
    setInputSignal(series.colors, ['#f00', '#0f0']);
    await waitForUpdate();
    const cast = series as unknown as { dots: () => { style: string }[] };
    const dots = cast.dots();
    expect(dots[0].style).toContain('#f00');
    expect(dots[1].style).toContain('#0f0');
    expect(dots[2].style).toContain('#f00');
  });

  it('per-dot sizes drive per-dot radii for a bubble chart', async () => {
    const { series } = await renderSeries();
    setInputSignal(series.sizes, [10, 6]);
    await waitForUpdate();
    const cast = series as unknown as { dots: () => { style: string }[] };
    const dots = cast.dots();
    // radius 10 → width 20px
    expect(dots[0].style).toContain('width: 20.00px');
    // radius 6 → width 12px
    expect(dots[1].style).toContain('width: 12.00px');
    // No entry → falls back to uniform radius (default 4) → width 8px
    expect(dots[2].style).toContain('width: 8.00px');
  });

  it('emits pointTap with the source point when a dot is tapped', async () => {
    const { series } = await renderSeries();
    const cb = vi.fn();
    series.pointTap.subscribe(cb);
    (
      series as unknown as { onPointTap: (p: { x: number; y: number }) => void }
    ).onPointTap({ x: 3, y: 4 });
    expect(cb).toHaveBeenCalledWith({ x: 3, y: 4 });
  });
});

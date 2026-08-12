import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCartesianChart } from '../cartesian-chart/cartesian-chart';
import { UiBarChart, UiBarSeries } from './bar-chart';

describe('UiBarChart', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiBarChart);
    expect(container).toBeTruthy();
  });

  it('folds the baseline into the y-axis domain', async () => {
    const { componentRef } = await render(UiBarChart);
    const inst = componentRef.instance as UiBarChart;
    setInputSignal(inst.data, [
      { x: 0, y: 5 },
      { x: 1, y: 10 },
      { x: 2, y: 8 },
    ]);
    setInputSignal(inst.baseline, 0);
    await waitForUpdate();
    const cast = inst as unknown as {
      xAxis: () => { domain: readonly [number, number] };
      yAxis: () => { domain: readonly [number, number] };
      effectivePadding: () => { left?: number; right?: number };
    };
    expect(cast.yAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.yAxis().domain[1]).toBeGreaterThanOrEqual(10);
    // 3 bars → half-bar inset = 0.5 / (3-1) = 0.25
    expect(cast.effectivePadding().left).toBeCloseTo(0.25);
    expect(cast.effectivePadding().right).toBeCloseTo(0.25);
  });

  it('honors explicit xMin / xMax / yMin / yMax overrides', async () => {
    const { componentRef } = await render(UiBarChart);
    const inst = componentRef.instance as UiBarChart;
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

  it('single-datum series drops the half-bar padding', async () => {
    const { componentRef } = await render(UiBarChart);
    const inst = componentRef.instance as UiBarChart;
    setInputSignal(inst.data, [{ x: 0, y: 5 }]);
    await waitForUpdate();
    const cast = inst as unknown as {
      effectivePadding: () => { left?: number; right?: number };
    };
    // n === 1 → half === 0
    expect(cast.effectivePadding().left).toBe(0);
    expect(cast.effectivePadding().right).toBe(0);
  });

  it('exposes the default tick formatter used by the child cartesian chart', async () => {
    const { componentRef } = await render(UiBarChart);
    const inst = componentRef.instance as UiBarChart;
    expect(inst.xTickFormat()(3.14159)).toBe('3.14');
    expect(inst.yTickFormat()(1.005)).toBe('1');
  });

  it('user padding overrides the auto half-bar inset per side', async () => {
    const { componentRef } = await render(UiBarChart);
    const inst = componentRef.instance as UiBarChart;
    setInputSignal(inst.data, [
      { x: 0, y: 5 },
      { x: 1, y: 10 },
    ]);
    setInputSignal(inst.padding, { left: 0.1 });
    await waitForUpdate();
    const cast = inst as unknown as {
      effectivePadding: () => { left?: number; right?: number };
    };
    // left explicitly set → wins; right still auto = 0.5
    expect(cast.effectivePadding().left).toBeCloseTo(0.1);
    expect(cast.effectivePadding().right).toBeCloseTo(0.5);
  });
});

describe('UiBarSeries', () => {
  const renderSeries = async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 10]);
    await waitForUpdate();
    const seriesResult = await render(UiBarSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiBarSeries;
    setInputSignal(series.data, [
      { x: 0, y: 2 },
      { x: 5, y: 8 },
      { x: 10, y: 5 },
    ]);
    await waitForUpdate();
    return { parent, series };
  };

  it('renders a rectangle per datum with the fallback color', async () => {
    const { series } = await renderSeries();
    const cast = series as unknown as {
      bars: () => { style: string; point: { x: number; y: number } }[];
    };
    const bars = cast.bars();
    expect(bars.length).toBe(3);
    for (const b of bars) {
      expect(b.style).toContain('background-color: var(--primary)');
    }
  });

  it('cycles through the per-bar palette when colors are provided', async () => {
    const { series } = await renderSeries();
    setInputSignal(series.colors, ['#f00', '#0f0']);
    await waitForUpdate();
    const cast = series as unknown as { bars: () => { style: string }[] };
    const bars = cast.bars();
    expect(bars[0].style).toContain('#f00');
    expect(bars[1].style).toContain('#0f0');
    // wraps around
    expect(bars[2].style).toContain('#f00');
  });

  it('emits barTap with the source point when a bar is tapped', async () => {
    const { series } = await renderSeries();
    const cb = vi.fn();
    series.barTap.subscribe(cb);
    (
      series as unknown as { onBarTap: (p: { x: number; y: number }) => void }
    ).onBarTap({ x: 1, y: 2 });
    expect(cb).toHaveBeenCalledWith({ x: 1, y: 2 });
  });

  it('single-datum series uses the fallback bar width', async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 10]);
    await waitForUpdate();
    const seriesResult = await render(UiBarSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiBarSeries;
    setInputSignal(series.data, [{ x: 5, y: 5 }]);
    await waitForUpdate();
    const cast = series as unknown as { bars: () => { style: string }[] };
    const [bar] = cast.bars();
    // fallback = 24px
    expect(bar.style).toContain('width: 24.00px');
  });

  it('clamps the baseline into the plot when it lies outside the domain', async () => {
    const { series } = await renderSeries();
    setInputSignal(series.baseline, 999);
    await waitForUpdate();
    const cast = series as unknown as { bars: () => { style: string }[] };
    expect(cast.bars().length).toBe(3);
  });
});

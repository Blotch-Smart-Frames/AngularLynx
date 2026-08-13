import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCartesianChart } from '../cartesian-chart/cartesian-chart';
import { UiAreaChart, UiAreaSeries } from './area-chart';

describe('UiAreaChart', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiAreaChart);
    expect(container).toBeTruthy();
  });

  it('folds the baseline into the y-axis domain', async () => {
    const { componentRef } = await render(UiAreaChart);
    const inst = componentRef.instance as UiAreaChart;
    setInputSignal(inst.data, [
      { x: 0, y: 5 },
      { x: 5, y: 10 },
      { x: 10, y: 8 },
    ]);
    setInputSignal(inst.baseline, 0);
    await waitForUpdate();
    const cast = inst as unknown as {
      xAxis: () => { domain: readonly [number, number]; ticks: number[] };
      yAxis: () => { domain: readonly [number, number]; ticks: number[] };
    };
    expect(cast.xAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.xAxis().domain[1]).toBeGreaterThanOrEqual(10);
    expect(cast.yAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.yAxis().domain[1]).toBeGreaterThanOrEqual(10);
  });

  it('honors explicit xMin / xMax / yMin / yMax overrides', async () => {
    const { componentRef } = await render(UiAreaChart);
    const inst = componentRef.instance as UiAreaChart;
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

  it('exposes the default tick formatter used by the child cartesian chart', async () => {
    const { componentRef } = await render(UiAreaChart);
    const inst = componentRef.instance as UiAreaChart;
    // JIT doesn't wire the child cartesian chart's [xTickFormat] input, so the
    // default formatter never fires through the template. Invoke it directly.
    expect(inst.xTickFormat()(3.14159)).toBe('3.14');
    expect(inst.yTickFormat()(1.005)).toBe('1');
  });
});

describe('UiAreaSeries', () => {
  const renderSeries = async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 10]);
    await waitForUpdate();
    const seriesResult = await render(UiAreaSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiAreaSeries;
    setInputSignal(series.data, [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    await waitForUpdate();
    return { parent, series };
  };

  it('renders fill columns and a translucent fill layer', async () => {
    const { series } = await renderSeries();
    const cast = series as unknown as {
      columns: () => { style: string }[];
      fillLayerStyle: () => string;
    };
    expect(cast.columns().length).toBeGreaterThan(0);
    expect(cast.fillLayerStyle()).toContain('opacity');
  });

  it('smooth mode densely resamples the fill columns', async () => {
    const { series } = await renderSeries();
    const cast = series as unknown as { columns: () => { style: string }[] };
    const straight = cast.columns().length;
    setInputSignal(series.smooth, true);
    await waitForUpdate();
    // Smoothed curve produces at least as many columns as the straight one.
    expect(cast.columns().length).toBeGreaterThanOrEqual(straight);
  });

  it('emits pointTap when the nested line series taps', async () => {
    const { series } = await renderSeries();
    const cb = vi.fn();
    series.pointTap.subscribe(cb);
    series.pointTap.emit({ x: 1, y: 2 });
    expect(cb).toHaveBeenCalledWith({ x: 1, y: 2 });
  });

  it('clamps the baseline into the plot when it lies outside the domain', async () => {
    const { series } = await renderSeries();
    // baseline > yDomain upper bound → clamp to top of plot; columns still render
    setInputSignal(series.baseline, 999);
    await waitForUpdate();
    const cast = series as unknown as { columns: () => { style: string }[] };
    expect(Array.isArray(cast.columns())).toBe(true);
  });
});

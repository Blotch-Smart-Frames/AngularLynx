import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCartesianChart } from '../cartesian-chart/cartesian-chart';
import { UiLineChart, UiLineSeries } from './line-chart';

describe('UiLineChart', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiLineChart);
    expect(container).toBeTruthy();
  });

  it('computes axis domains from data', async () => {
    const { componentRef } = await render(UiLineChart);
    const inst = componentRef.instance as UiLineChart;
    setInputSignal(inst.data, [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 5 },
    ]);
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
    const { componentRef } = await render(UiLineChart);
    const inst = componentRef.instance as UiLineChart;
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
    const { componentRef } = await render(UiLineChart);
    const inst = componentRef.instance as UiLineChart;
    // JIT doesn't wire the child cartesian chart's [xTickFormat] input, so the
    // default formatter is never invoked through the template. Invoke it
    // directly to cover its two-decimal rounding branch.
    expect(inst.xTickFormat()(3.14159)).toBe('3.14');
    expect(inst.yTickFormat()(1.005)).toBe('1');
  });
});

describe('UiLineSeries', () => {
  const renderSeries = async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 10]);
    await waitForUpdate();
    const seriesResult = await render(UiLineSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiLineSeries;
    setInputSignal(series.data, [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    await waitForUpdate();
    return { parent, series, seriesResult };
  };

  it('renders segments and dots for the projected data', async () => {
    const { series } = await renderSeries();
    const cast = series as unknown as {
      segments: () => { style: string }[];
      dots: () => { style: string }[];
    };
    expect(cast.segments().length).toBeGreaterThan(0);
    expect(cast.dots().length).toBe(3);
  });

  it('hides dots when showDots is false', async () => {
    const { series } = await renderSeries();
    setInputSignal(series.showDots, false);
    await waitForUpdate();
    const cast = series as unknown as { dots: () => { style: string }[] };
    expect(cast.dots()).toEqual([]);
  });

  it('emits pointTap when onPointTap is invoked', async () => {
    const { series } = await renderSeries();
    const cb = vi.fn();
    series.pointTap.subscribe(cb);
    (series as unknown as { onPointTap: (p: unknown) => void }).onPointTap({
      x: 1,
      y: 2,
    });
    expect(cb).toHaveBeenCalledWith({ x: 1, y: 2 });
  });

  it('smooth mode resamples through sampleSmoothLine', async () => {
    const { series } = await renderSeries();
    setInputSignal(series.smooth, true);
    await waitForUpdate();
    const cast = series as unknown as { segments: () => { style: string }[] };
    expect(cast.segments().length).toBeGreaterThan(2);
  });
});

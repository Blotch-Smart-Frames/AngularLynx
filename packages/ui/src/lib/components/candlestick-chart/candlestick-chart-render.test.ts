import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCartesianChart } from '../cartesian-chart/cartesian-chart';
import {
  UiCandlestickChart,
  UiCandlestickSeries,
  type CandlestickPoint,
} from './candlestick-chart';

const period = (
  x: number,
  o: number,
  h: number,
  l: number,
  c: number,
): CandlestickPoint => ({ x, open: o, high: h, low: l, close: c });

describe('UiCandlestickChart', () => {
  it('renders with default configuration', async () => {
    const { container } = await render(UiCandlestickChart);
    expect(container).toBeTruthy();
  });

  it('derives the y-axis from the lowest low and highest high', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const inst = componentRef.instance as UiCandlestickChart;
    setInputSignal(inst.data, [
      period(0, 10, 15, 5, 12),
      period(1, 12, 20, 8, 18),
      period(2, 18, 22, 14, 16),
    ]);
    await waitForUpdate();
    const cast = inst as unknown as {
      xAxis: () => { domain: readonly [number, number] };
      yAxis: () => { domain: readonly [number, number] };
      effectivePadding: () => { left?: number; right?: number };
    };
    expect(cast.xAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.xAxis().domain[1]).toBeGreaterThanOrEqual(2);
    expect(cast.yAxis().domain[0]).toBeLessThanOrEqual(5);
    expect(cast.yAxis().domain[1]).toBeGreaterThanOrEqual(22);
    // 3 candles → half = 0.5 / 2 = 0.25
    expect(cast.effectivePadding().left).toBeCloseTo(0.25);
    expect(cast.effectivePadding().right).toBeCloseTo(0.25);
  });

  it('honors explicit xMin / xMax / yMin / yMax overrides', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const inst = componentRef.instance as UiCandlestickChart;
    setInputSignal(inst.data, [period(0, 10, 15, 5, 12)]);
    setInputSignal(inst.xMin, -5);
    setInputSignal(inst.xMax, 20);
    setInputSignal(inst.yMin, 0);
    setInputSignal(inst.yMax, 100);
    await waitForUpdate();
    const cast = inst as unknown as {
      xAxis: () => { domain: readonly [number, number] };
      yAxis: () => { domain: readonly [number, number] };
    };
    expect(cast.xAxis().domain[0]).toBeLessThanOrEqual(-5);
    expect(cast.xAxis().domain[1]).toBeGreaterThanOrEqual(20);
    expect(cast.yAxis().domain[0]).toBeLessThanOrEqual(0);
    expect(cast.yAxis().domain[1]).toBeGreaterThanOrEqual(100);
  });

  it('single-datum series drops the half-candle padding', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const inst = componentRef.instance as UiCandlestickChart;
    setInputSignal(inst.data, [period(0, 10, 15, 5, 12)]);
    await waitForUpdate();
    const cast = inst as unknown as {
      effectivePadding: () => { left?: number; right?: number };
    };
    expect(cast.effectivePadding().left).toBe(0);
    expect(cast.effectivePadding().right).toBe(0);
  });

  it('user padding overrides the auto half-candle inset per side', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const inst = componentRef.instance as UiCandlestickChart;
    setInputSignal(inst.data, [
      period(0, 10, 15, 5, 12),
      period(1, 12, 20, 8, 18),
    ]);
    setInputSignal(inst.padding, { right: 0.05 });
    await waitForUpdate();
    const cast = inst as unknown as {
      effectivePadding: () => { left?: number; right?: number };
    };
    expect(cast.effectivePadding().right).toBeCloseTo(0.05);
    expect(cast.effectivePadding().left).toBeCloseTo(0.5);
  });

  it('exposes the default tick formatter used by the child cartesian chart', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const inst = componentRef.instance as UiCandlestickChart;
    expect(inst.xTickFormat()(3.14159)).toBe('3.14');
    expect(inst.yTickFormat()(1.005)).toBe('1');
  });
});

describe('UiCandlestickSeries', () => {
  const renderSeries = async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 100]);
    await waitForUpdate();
    const seriesResult = await render(UiCandlestickSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiCandlestickSeries;
    setInputSignal(series.data, [
      // up candle (close >= open)
      period(0, 10, 20, 5, 15),
      // down candle (close < open)
      period(5, 60, 70, 50, 55),
      // doji (close === open)
      period(10, 40, 50, 30, 40),
    ]);
    await waitForUpdate();
    return { parent, series };
  };

  it('renders a wick + body for each period, tinted by direction', async () => {
    const { series } = await renderSeries();
    const cast = series as unknown as {
      candles: () => {
        wickStyle: string;
        bodyStyle: string;
        point: CandlestickPoint;
      }[];
    };
    const candles = cast.candles();
    expect(candles.length).toBe(3);
    // First: up candle → uses upColor (green rgba)
    expect(candles[0].bodyStyle).toContain('rgba(34, 197, 94, 1)');
    // Second: down candle → uses downColor (red rgba)
    expect(candles[1].bodyStyle).toContain('rgba(239, 68, 68, 1)');
    // Third: doji (open === close) is `up: true` (>= comparison)
    expect(candles[2].bodyStyle).toContain('rgba(34, 197, 94, 1)');
  });

  it('emits candleTap with the source point when a body is tapped', async () => {
    const { series } = await renderSeries();
    const cb = vi.fn();
    series.candleTap.subscribe(cb);
    const p = period(1, 2, 3, 1, 2);
    (
      series as unknown as { onCandleTap: (point: CandlestickPoint) => void }
    ).onCandleTap(p);
    expect(cb).toHaveBeenCalledWith(p);
  });

  it('single-datum series uses the fallback body width', async () => {
    const parentResult = await render(UiCartesianChart);
    const parent = parentResult.componentRef.instance as UiCartesianChart;
    setInputSignal(parent.xDomain, [0, 10]);
    setInputSignal(parent.yDomain, [0, 100]);
    await waitForUpdate();
    const seriesResult = await render(UiCandlestickSeries, {
      providers: [{ provide: UiCartesianChart, useValue: parent }],
    });
    const series = seriesResult.componentRef.instance as UiCandlestickSeries;
    setInputSignal(series.data, [period(5, 10, 15, 5, 12)]);
    await waitForUpdate();
    const cast = series as unknown as {
      candles: () => { bodyStyle: string }[];
    };
    // fallback body width = 8px
    expect(cast.candles()[0].bodyStyle).toContain('width: 8.00px');
  });
});

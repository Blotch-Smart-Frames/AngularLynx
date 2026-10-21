import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import { defineChart, link, rect } from '@tanstack/charts/universal';
import type {
  ChartPoint,
  ChartTooltipContent,
  ChartTooltipContentContext,
} from '@tanstack/charts/types';

import { UiChart, tooltip } from '../chart/chart';
import {
  type CartesianPresetOptions,
  PRESET_CHART_BINDINGS,
  UiCartesianPreset,
  minSpacing,
  presetAxes,
} from '../chart/chart-presets';

/** One period's open, high, low and close (OHLC) at x. */
export type CandlestickDatum = {
  readonly x: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type CandlestickChartOptions = {
  readonly data: readonly CandlestickDatum[];
  /** Color of a candle that closed at or above its open. */
  readonly upColor?: string;
  /** Color of a candle that closed below its open. */
  readonly downColor?: string;
  /** Width of the high–low wick in px. */
  readonly wickWidth?: number;
  /** Body width as a fraction of the space each candle has, `0`–`1`. */
  readonly bodyWidthRatio?: number;
} & CartesianPresetOptions;

const isUp = (d: CandlestickDatum): boolean => d.close >= d.open;

const isCandle = (datum: unknown): datum is CandlestickDatum =>
  typeof datum === 'object' &&
  datum !== null &&
  'open' in datum &&
  'close' in datum;

/**
 * The definition `<ui-candlestick-chart>` renders: a wick from low to high and
 * a body from open to close per period, colored by direction. The tooltip lists
 * all four prices.
 */
export const candlestickChartDefinition = (
  options: CandlestickChartOptions,
) => {
  const {
    data,
    upColor = 'rgba(34, 197, 94, 1)',
    downColor = 'rgba(239, 68, 68, 1)',
    wickWidth = 1,
    bodyWidthRatio = 0.6,
  } = options;
  const xs = data.map((d) => d.x);
  const spacing = minSpacing(xs);
  const half = (Math.min(1, Math.max(0, bodyWidthRatio)) * spacing) / 2;
  return defineChart({
    marks: [
      link(data, {
        x1: 'x',
        y1: 'low',
        x2: 'x',
        y2: 'high',
        stroke: (d) => (isUp(d) ? upColor : downColor),
        strokeWidth: wickWidth,
      }),
      rect(data, {
        x1: (d) => d.x - half,
        x2: (d) => d.x + half,
        y1: 'open',
        y2: 'close',
        // rect's fill is a single color, so direction goes through the color
        // scale below.
        color: (d) => (isUp(d) ? 'up' : 'down'),
      }),
    ],
    scales: presetAxes(options, {
      x: xs,
      y: data.flatMap((d) => [d.low, d.high]),
      // Half a slot of room either side so the edge candles fit.
      xMargin: spacing / 2,
    }),
    color: { domain: ['up', 'down'], range: [upColor, downColor] },
    tooltip:
      options.tooltip === false
        ? false
        : {
            use: tooltip,
            // Typed for any point, not just candles: a definition built on
            // this one can add marks (a moving average), whose points get a
            // plain x/y tooltip.
            content: (
              points: readonly ChartPoint[],
              context: ChartTooltipContentContext,
            ): ChartTooltipContent => {
              const point = points[0];
              const d = point?.datum;
              if (!point || !isCandle(d)) {
                return {
                  title: point ? context.formatX(point.xValue) : undefined,
                  rows: points.map((p) => ({
                    label: context.yLabel,
                    value: context.formatY(p.yValue),
                  })),
                };
              }
              return {
                title: String(d.x),
                color: isUp(d) ? upColor : downColor,
                rows: [
                  { label: 'Open', value: String(d.open) },
                  { label: 'High', value: String(d.high) },
                  { label: 'Low', value: String(d.low) },
                  { label: 'Close', value: String(d.close) },
                ],
              };
            },
          },
  });
};

/**
 * An OHLC candlestick chart. For a moving average or volume bars over the
 * candles, build a definition with `link`, `rect` and `lineY` and render it
 * with `<ui-chart>`.
 *
 * ```html
 * <ui-candlestick-chart [data]="prices" [zoomable]="true" zoomAxes="x" />
 * ```
 */
@Component({
  selector: 'ui-candlestick-chart',
  imports: [UiChart],
  encapsulation: ViewEncapsulation.None,
  template: `
    <ui-chart
      [definition]="definition()"
      ${PRESET_CHART_BINDINGS}
      (pointSelect)="onSelect($event)"
    />
  `,
})
export class UiCandlestickChart extends UiCartesianPreset<CandlestickDatum> {
  readonly data = input.required<readonly CandlestickDatum[]>();
  readonly upColor = input('rgba(34, 197, 94, 1)');
  readonly downColor = input('rgba(239, 68, 68, 1)');
  readonly wickWidth = input(1);
  readonly bodyWidthRatio = input(0.6);

  /** The tapped candle's datum. */
  readonly candleTap = output<CandlestickDatum>();

  protected readonly definition = computed(() =>
    candlestickChartDefinition({
      ...this.commonOptions(),
      data: this.data(),
      upColor: this.upColor(),
      downColor: this.downColor(),
      wickWidth: this.wickWidth(),
      bodyWidthRatio: this.bodyWidthRatio(),
    }),
  );

  protected onSelect(point: ChartPoint | null): void {
    const datum = this.datumOf(point);
    if (datum) this.candleTap.emit(datum);
  }
}

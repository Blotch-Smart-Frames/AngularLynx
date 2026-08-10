import {
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type ChartPadding,
  UiCartesianChart,
  niceScale,
} from '../cartesian-chart/cartesian-chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One OHLC period: the `open`, `high`, `low`, and `close` prices at position
 * `x`. `x` is a plain number (a period index), not a `Date` — Lynx has no `Intl`
 * to format dates, so the whole chart system keeps x numeric (see {@link
 * ChartPoint}). Format the axis with `xTickFormat` if you need labels.
 */
export type CandlestickPoint = {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** One candle after projection into plot-local pixel space. */
type ProjectedCandle = {
  /** Center x of the candle, in px. */
  cx: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  /** `true` when the period closed at or above its open (a rising candle). */
  up: boolean;
};

/** An axis-aligned rectangle in plot-local pixel space. */
type Rect = { left: number; top: number; width: number; height: number };

/**
 * Render geometry for one candle: a thin vertical **wick** (high→low) and a
 * **body** (open↔close), both plain axis-aligned rectangles. `up` is echoed from
 * the input so the caller can pick the fill color.
 */
export type CandleShape = {
  wick: Rect;
  body: Rect;
  up: boolean;
};

// ---------------------------------------------------------------------------
// Pure geometry (exported so it can be unit-tested without Angular)
// ---------------------------------------------------------------------------

/**
 * Turns projected candles — already in plot-local pixel space — into wick/body
 * rectangles ready to render as `<view>`s. Unlike the line and area series, a
 * candlestick needs no rotation or fill rasterization: each mark is a plain
 * axis-aligned box, so this is a straight geometric mapping.
 *
 * Screen y grows *downward*, so a higher price projects to a *smaller* y. Hence
 * the wick's top is `min(highY, lowY)` and the body's top is `min(openY,
 * closeY)` — taking the pixel min picks the visually-higher (larger-value) edge.
 *
 * A doji (open === close) would give a zero-height body that renders invisibly,
 * so the body height is clamped to `minBodyHeight` (a thin line, like a bar).
 * Wick and body are both centered on the candle's `cx`.
 *
 * @param bodyWidth width of the body rectangle in px (the wick stays `wickWidth`).
 * @param minBodyHeight floor for the body height so a doji is still visible.
 */
export const computeCandles = (
  candles: readonly ProjectedCandle[],
  bodyWidth: number,
  wickWidth = 1,
  minBodyHeight = 1,
): CandleShape[] =>
  candles.map((c) => {
    const bodyTop = Math.min(c.openY, c.closeY);
    const bodyHeight = Math.max(Math.abs(c.closeY - c.openY), minBodyHeight);
    const wickTop = Math.min(c.highY, c.lowY);
    const wickHeight = Math.abs(c.lowY - c.highY);
    return {
      wick: {
        left: c.cx - wickWidth / 2,
        top: wickTop,
        width: wickWidth,
        height: wickHeight,
      },
      body: {
        left: c.cx - bodyWidth / 2,
        top: bodyTop,
        width: bodyWidth,
        height: bodyHeight,
      },
      up: c.up,
    };
  });

// ---------------------------------------------------------------------------
// Rendering helpers (mirror the equivalents in line-chart.ts / area-chart.ts —
// kept local so this module stays self-contained when scaffolded by `dolan add`)
// ---------------------------------------------------------------------------

/**
 * Formats a pixel value for an inline style, avoiding scientific notation.
 */
const px = (n: number): string => `${n.toFixed(2)}px`;

/**
 * Default axis label formatter — plain JS only (no `Intl`, absent in Lynx).
 */
const defaultTickFormat = (value: number): string =>
  String(Math.round(value * 100) / 100);

// Fallback body width (px) when there is only a single candle, so there is no
// neighbor to derive a spacing from. Matches the React source's `font(8)`.
const SINGLE_CANDLE_BODY_WIDTH = 8;

/**
 * A single candlestick series drawn inside a `<ui-cartesian-chart>`. Reads the
 * shared scales from the parent chart via DI and renders, per period, a wick
 * `<view>` (high→low) and a body `<view>` (open↔close), colored by direction.
 *
 * ## Why the host is `position: absolute; width/height: 100%`
 * Identical to `UiLineSeries`: Lynx resolves an absolute child against its
 * **direct parent** (there is no `position: static`), so the host itself must be
 * the plot-sized containing block. Every wick and body is a direct child of it.
 *
 * ## Differentiating up vs down
 * On a color screen, the fill color carries direction — up candles use
 * `upColor`, down candles `downColor`. (The React original also supported SVG
 * *fill patterns* for e-ink displays where color can't be relied on; Lynx has
 * no SVG patterns, so that is dropped in favor of solid color.)
 */
@Component({
  selector: 'ui-candlestick-series',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    style:
      'position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;',
    '[class]': 'userClass()',
  },
  template: `
    <!-- Wick first so the body paints on top of it (Lynx paint order follows
         source order; z-index is unnecessary). The body is the tap target. -->
    @for (candle of candles(); track $index) {
      <view [style]="candle.wickStyle"></view>
      <view
        [style]="candle.bodyStyle"
        (bindtap)="onCandleTap(candle.point)"
      ></view>
    }
  `,
})
export class UiCandlestickSeries {
  readonly #chart = inject(UiCartesianChart);

  readonly data = input.required<CandlestickPoint[]>();
  /** Fill for rising candles (close ≥ open). Fixed data hue, not theme chrome. */
  readonly upColor = input('rgba(34, 197, 94, 1)');
  /** Fill for falling candles (close < open). */
  readonly downColor = input('rgba(239, 68, 68, 1)');
  /** Width of the high–low wick in px. */
  readonly wickWidth = input(1);
  /** Body width as a fraction of the spacing between adjacent candles. 0.6
   * leaves a ~40% gap between bodies, the conventional candlestick look. */
  readonly bodyWidthRatio = input(0.6);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly candleTap = output<CandlestickPoint>();

  // Project each OHLC point into plot-local pixel space via the shared scales.
  // Reading the chart's scale signals here makes this recompute whenever the
  // domain or plot size changes.
  readonly #projected = computed(() => {
    const scaleX = this.#chart.xScale();
    const scaleY = this.#chart.yScale();
    return this.data().map((point) => ({
      cx: scaleX(point.x),
      openY: scaleY(point.open),
      highY: scaleY(point.high),
      lowY: scaleY(point.low),
      closeY: scaleY(point.close),
      up: point.close >= point.open,
      point,
    }));
  });

  // Body width = a fraction of the pixel spacing between candle centers, so
  // bodies scale with the plot and never overlap. With one candle there is no
  // spacing to measure, so fall back to a fixed width.
  readonly #bodyWidth = computed(() => {
    const projected = this.#projected();
    const n = projected.length;
    if (n < 2) return SINGLE_CANDLE_BODY_WIDTH;
    const span = Math.abs(projected[n - 1].cx - projected[0].cx);
    return (span / (n - 1)) * this.bodyWidthRatio();
  });

  protected readonly candles = computed(() => {
    const projected = this.#projected();
    const up = this.upColor();
    const down = this.downColor();
    // computeCandles works purely from the projected pixel fields; zip its output
    // back with each source point so the body's tap can emit the original data.
    return computeCandles(projected, this.#bodyWidth(), this.wickWidth()).map(
      (shape, i) => {
        const fill = shape.up ? up : down;
        return {
          point: projected[i].point,
          wickStyle:
            `position: absolute; left: ${px(shape.wick.left)}; top: ${px(shape.wick.top)}; ` +
            `width: ${px(shape.wick.width)}; height: ${px(shape.wick.height)}; ` +
            `background-color: ${fill};`,
          bodyStyle:
            `position: absolute; left: ${px(shape.body.left)}; top: ${px(shape.body.top)}; ` +
            `width: ${px(shape.body.width)}; height: ${px(shape.body.height)}; ` +
            `background-color: ${fill};`,
        };
      },
    );
  });

  protected onCandleTap(point: CandlestickPoint): void {
    this.candleTap.emit(point);
  }
}

/**
 * A ready-to-use candlestick (OHLC) chart for the common single-series case.
 * Composes a `<ui-cartesian-chart>` with one `<ui-candlestick-series>` and
 * auto-derives rounded axis domains + ticks from the data. For a moving-average
 * line on top, or full control over the axes, use `<ui-cartesian-chart>` with a
 * `<ui-candlestick-series>` (and optionally a `<ui-line-series>`) directly.
 */
@Component({
  selector: 'ui-candlestick-chart',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiCartesianChart, UiCandlestickSeries],
  encapsulation: ViewEncapsulation.None,
  template: `
    <ui-cartesian-chart
      [xDomain]="xAxis().domain"
      [yDomain]="yAxis().domain"
      [xTicks]="xAxis().ticks"
      [yTicks]="yAxis().ticks"
      [width]="width()"
      [height]="height()"
      [tickCount]="tickCount()"
      [showXGrid]="showXGrid()"
      [xAxisLabel]="xAxisLabel()"
      [yAxisLabel]="yAxisLabel()"
      [padding]="effectivePadding()"
      [xTickFormat]="xTickFormat()"
      [yTickFormat]="yTickFormat()"
      [zoomable]="zoomable()"
      [zoomAxes]="zoomAxes()"
      [showZoomControls]="showZoomControls()"
      [minZoom]="minZoom()"
      [maxZoom]="maxZoom()"
      [zoomStep]="zoomStep()"
      [class]="userClass()"
    >
      <ui-candlestick-series
        [data]="data()"
        [upColor]="upColor()"
        [downColor]="downColor()"
        [wickWidth]="wickWidth()"
        [bodyWidthRatio]="bodyWidthRatio()"
        (candleTap)="candleTap.emit($event)"
      />
    </ui-cartesian-chart>
  `,
})
export class UiCandlestickChart {
  readonly data = input.required<CandlestickPoint[]>();
  readonly upColor = input('rgba(34, 197, 94, 1)');
  readonly downColor = input('rgba(239, 68, 68, 1)');
  readonly width = input(320);
  readonly height = input(200);
  readonly tickCount = input(5);
  readonly wickWidth = input(1);
  readonly bodyWidthRatio = input(0.6);
  /** Draw vertical gridlines at each x tick. */
  readonly showXGrid = input(false);
  /** Title for the x-axis (centered below the tick labels). */
  readonly xAxisLabel = input<string>('');
  /** Title for the y-axis (rotated in the left gutter). */
  readonly yAxisLabel = input<string>('');
  /** Inner inset of the plot area — merged over the auto half-candle padding
   * (below), so any side you set wins. See {@link ChartPadding}. */
  readonly padding = input<ChartPadding>({});
  /** Force the x-axis lower/upper bound instead of deriving it from the data.
   * Omitted bounds fall back to the data extremes. */
  readonly xMin = input<number | undefined>(undefined);
  readonly xMax = input<number | undefined>(undefined);
  /** Force the y-axis lower/upper bound (e.g. to compare two charts on one scale). */
  readonly yMin = input<number | undefined>(undefined);
  readonly yMax = input<number | undefined>(undefined);
  readonly xTickFormat = input<(value: number) => string>(defaultTickFormat);
  readonly yTickFormat = input<(value: number) => string>(defaultTickFormat);
  readonly userClass = input<string>('', { alias: 'class' });

  // Pan/zoom — forwarded to the underlying <ui-cartesian-chart>. Off by default
  // so a candlestick chart stays static unless opted in.
  readonly zoomable = input(false);
  readonly zoomAxes = input<'x' | 'y' | 'xy'>('xy');
  readonly showZoomControls = input(true);
  readonly minZoom = input(1);
  readonly maxZoom = input(8);
  readonly zoomStep = input(1.4);

  readonly candleTap = output<CandlestickPoint>();

  // Auto-compute rounded axes from the data extremes, letting an explicit
  // min/max override either end. `Math.min/max(...[])` yield ±Infinity for empty
  // data, which `niceScale` handles by padding.
  protected readonly xAxis = computed(() => {
    const xs = this.data().map((p) => p.x);
    const lo = this.xMin() ?? Math.min(...xs);
    const hi = this.xMax() ?? Math.max(...xs);
    return niceScale(lo, hi, this.tickCount());
  });
  // The y-extent spans every wick: the lowest low to the highest high. Open and
  // close always sit inside that range, so they need no separate consideration.
  protected readonly yAxis = computed(() => {
    const lows = this.data().map((p) => p.low);
    const highs = this.data().map((p) => p.high);
    const lo = this.yMin() ?? Math.min(...lows);
    const hi = this.yMax() ?? Math.max(...highs);
    return niceScale(lo, hi, this.tickCount());
  });

  // A candle body is centered on its x, so the first and last bodies would spill
  // over the plot edges. Insetting the scales by half a candle's spacing keeps
  // them fully inside. User `padding` is spread last, so an explicit side wins.
  protected readonly effectivePadding = computed<ChartPadding>(() => {
    const n = this.data().length;
    const half = n > 1 ? 0.5 / (n - 1) : 0;
    return { left: half, right: half, ...this.padding() };
  });
}

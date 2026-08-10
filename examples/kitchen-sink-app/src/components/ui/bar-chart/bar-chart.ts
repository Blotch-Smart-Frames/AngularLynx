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
  type ChartPoint,
  UiCartesianChart,
  niceScale,
} from '../cartesian-chart/cartesian-chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A bar is just an (x, y) datum — x is the category position, y the bar's value —
// so it reuses the shared `ChartPoint` rather than defining its own. That also
// lets a bar series and a line/area series share one dataset on the same axes.

/** One bar after projection into plot-local pixel space. */
type ProjectedBar = {
  /** Center x of the bar, in px. */
  cx: number;
  /** Pixel y of the bar's value (its far edge from the baseline). */
  valueY: number;
};

/** An axis-aligned rectangle in plot-local pixel space. */
export type BarShape = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// ---------------------------------------------------------------------------
// Pure geometry (exported so it can be unit-tested without Angular)
// ---------------------------------------------------------------------------

/**
 * Turns projected bars — already in plot-local pixel space — into rectangles
 * ready to render as `<view>`s. A bar is the simplest chart mark on Lynx: one
 * axis-aligned box from the shared `baseY` (the baseline's pixel y) to the
 * value, so this is a straight geometric mapping with no rotation or fill
 * rasterization (unlike the line and area series).
 *
 * Screen y grows *downward*, so a value above the baseline has a *smaller*
 * `valueY` than `baseY`. Taking `top = min(valueY, baseY)` therefore anchors the
 * rectangle at whichever edge is visually higher, which makes bars for negative
 * values (value below the baseline) grow *downward* from the baseline correctly.
 *
 * Unlike a candlestick doji, `minBarHeight` defaults to `0`: a bar's height *is*
 * its datum, so a value exactly on the baseline should draw nothing rather than
 * a misleading sliver. Callers wanting every bar guaranteed visible can raise it.
 *
 * @param baseY pixel y of the baseline every bar grows from.
 * @param barWidth width of each bar in px.
 * @param minBarHeight floor for the bar height (0 = honest zero-height at baseline).
 */
export const computeBars = (
  bars: readonly ProjectedBar[],
  baseY: number,
  barWidth: number,
  minBarHeight = 0,
): BarShape[] =>
  bars.map((b) => {
    const top = Math.min(b.valueY, baseY);
    const height = Math.max(Math.abs(b.valueY - baseY), minBarHeight);
    return { left: b.cx - barWidth / 2, top, width: barWidth, height };
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

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

// Fallback bar width (px) when there is only a single bar, so there is no
// neighbor to derive a spacing from. Matches the candlestick series' fallback.
const SINGLE_BAR_WIDTH = 24;

/**
 * A single bar series drawn inside a `<ui-cartesian-chart>`. Reads the shared
 * scales from the parent chart via DI and renders one `<view>` rectangle per
 * datum, from the shared `baseline` up (or down) to the value.
 *
 * ## Why the host is `position: absolute; width/height: 100%`
 * Identical to `UiLineSeries`: Lynx resolves an absolute child against its
 * **direct parent** (there is no `position: static`), so the host itself must be
 * the plot-sized containing block. Every bar is a direct child of it.
 *
 * ## Per-bar colors
 * `color` fills every bar by default. Pass `colors` to give each bar its own
 * hue (a categorical bar chart) — the palette cycles if it is shorter than the
 * data, so a handful of colors tint any number of bars.
 */
@Component({
  selector: 'ui-bar-series',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    style:
      'position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;',
    '[class]': 'userClass()',
  },
  template: `
    @for (bar of bars(); track $index) {
      <view [style]="bar.style" (bindtap)="onBarTap(bar.point)"></view>
    }
  `,
})
export class UiBarSeries {
  readonly #chart = inject(UiCartesianChart);

  readonly data = input.required<ChartPoint[]>();
  /** Fill for every bar. Overridden per bar by `colors` when that is set. */
  readonly color = input('var(--primary)');
  /** Per-bar fills (a categorical palette). Cycles when shorter than the data;
   * an empty array falls back to `color`. */
  readonly colors = input<string[]>([]);
  /** Bar width as a fraction of the spacing between adjacent bars. 0.7 leaves a
   * ~30% gap between bars, the conventional bar-chart look. */
  readonly barWidthRatio = input(0.7);
  /** Data-space y the bars grow from (usually 0). Values below it grow downward. */
  readonly baseline = input(0);
  /** Corner radius of each bar in px (0 = square corners). */
  readonly radius = input(0);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly barTap = output<ChartPoint>();

  // Project each datum into plot-local pixel space via the shared scales.
  // Reading the chart's scale signals here makes this recompute whenever the
  // domain or plot size changes.
  readonly #projected = computed(() => {
    const scaleX = this.#chart.xScale();
    const scaleY = this.#chart.yScale();
    return this.data().map((point) => ({
      cx: scaleX(point.x),
      valueY: scaleY(point.y),
      point,
    }));
  });

  // Bar width = a fraction of the pixel spacing between bar centers, so bars
  // scale with the plot and never overlap. With one bar there is no spacing to
  // measure, so fall back to a fixed width.
  readonly #barWidth = computed(() => {
    const projected = this.#projected();
    const n = projected.length;
    if (n < 2) return SINGLE_BAR_WIDTH;
    const span = Math.abs(projected[n - 1].cx - projected[0].cx);
    return (span / (n - 1)) * this.barWidthRatio();
  });

  protected readonly bars = computed(() => {
    const projected = this.#projected();
    const fallback = this.color();
    const palette = this.colors();
    const radius = this.radius();
    // Clamp the baseline into the plot so a baseline outside the domain anchors
    // the bars to the nearest edge (top/bottom) instead of drawing off-plot.
    const baseY = clamp(
      this.#chart.yScale()(this.baseline()),
      0,
      this.#chart.plotHeight(),
    );
    // computeBars works purely from the projected pixel fields; zip its output
    // back with each source point so a bar's tap can emit the original datum.
    return computeBars(projected, baseY, this.#barWidth()).map((shape, i) => {
      const fill = palette.length ? palette[i % palette.length] : fallback;
      return {
        point: projected[i].point,
        style:
          `position: absolute; left: ${px(shape.left)}; top: ${px(shape.top)}; ` +
          `width: ${px(shape.width)}; height: ${px(shape.height)}; ` +
          `background-color: ${fill}; border-radius: ${px(radius)};`,
      };
    });
  });

  protected onBarTap(point: ChartPoint): void {
    this.barTap.emit(point);
  }
}

/**
 * A ready-to-use bar chart for the common single-series case. Composes a
 * `<ui-cartesian-chart>` with one `<ui-bar-series>` and auto-derives rounded
 * axis domains + ticks from the data. For a line overlay, or full control over
 * the axes, use `<ui-cartesian-chart>` with a `<ui-bar-series>` (and optionally
 * a `<ui-line-series>`) directly.
 */
@Component({
  selector: 'ui-bar-chart',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiCartesianChart, UiBarSeries],
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
      <ui-bar-series
        [data]="data()"
        [color]="color()"
        [colors]="colors()"
        [barWidthRatio]="barWidthRatio()"
        [baseline]="baseline()"
        [radius]="radius()"
        (barTap)="barTap.emit($event)"
      />
    </ui-cartesian-chart>
  `,
})
export class UiBarChart {
  readonly data = input.required<ChartPoint[]>();
  readonly color = input('var(--primary)');
  readonly colors = input<string[]>([]);
  readonly width = input(320);
  readonly height = input(200);
  readonly tickCount = input(5);
  readonly barWidthRatio = input(0.7);
  /** Data-space y the bars grow from (usually 0). Values below it grow downward. */
  readonly baseline = input(0);
  /** Corner radius of each bar in px. */
  readonly radius = input(0);
  /** Draw vertical gridlines at each x tick. */
  readonly showXGrid = input(false);
  /** Title for the x-axis (centered below the tick labels). */
  readonly xAxisLabel = input<string>('');
  /** Title for the y-axis (rotated in the left gutter). */
  readonly yAxisLabel = input<string>('');
  /** Inner inset of the plot area — merged over the auto half-bar padding
   * (below), so any side you set wins. See {@link ChartPadding}. */
  readonly padding = input<ChartPadding>({});
  /** Force the x-axis lower/upper bound instead of deriving it from the data.
   * Omitted bounds fall back to the data extremes. */
  readonly xMin = input<number | undefined>(undefined);
  readonly xMax = input<number | undefined>(undefined);
  /** Force the y-axis lower/upper bound. The `baseline` is still folded in, so
   * `yMin` only lowers the floor further — it can't clip a bar's base off. */
  readonly yMin = input<number | undefined>(undefined);
  readonly yMax = input<number | undefined>(undefined);
  readonly xTickFormat = input<(value: number) => string>(defaultTickFormat);
  readonly yTickFormat = input<(value: number) => string>(defaultTickFormat);
  readonly userClass = input<string>('', { alias: 'class' });

  // Pan/zoom — forwarded to the underlying <ui-cartesian-chart>. Off by default
  // so a bar chart stays static (and scroll-view friendly) unless opted in.
  readonly zoomable = input(false);
  readonly zoomAxes = input<'x' | 'y' | 'xy'>('xy');
  readonly showZoomControls = input(true);
  readonly minZoom = input(1);
  readonly maxZoom = input(8);
  readonly zoomStep = input(1.4);

  readonly barTap = output<ChartPoint>();

  // Auto-compute rounded axes from the data extremes, letting an explicit
  // min/max override either end. `Math.min/max(...[])` yield ±Infinity for empty
  // data, which `niceScale` handles by padding.
  protected readonly xAxis = computed(() => {
    const xs = this.data().map((p) => p.x);
    const lo = this.xMin() ?? Math.min(...xs);
    const hi = this.xMax() ?? Math.max(...xs);
    return niceScale(lo, hi, this.tickCount());
  });
  // Fold the baseline into the y-extent so the axis always spans the whole bar:
  // a positive-only series still shows the baseline at the bottom, and negative
  // values pull the domain below it. An explicit yMin/yMax overrides the
  // corresponding data-derived end (the baseline still participates in the other).
  protected readonly yAxis = computed(() => {
    const ys = this.data().map((p) => p.y);
    const base = this.baseline();
    const lo = this.yMin() ?? Math.min(base, ...ys);
    const hi = this.yMax() ?? Math.max(base, ...ys);
    return niceScale(lo, hi, this.tickCount());
  });

  // A bar is centered on its x, so the first and last bars would spill over the
  // plot edges. Insetting the scales by half a bar's spacing keeps them fully
  // inside. User `padding` is spread last, so an explicit side wins.
  protected readonly effectivePadding = computed<ChartPadding>(() => {
    const n = this.data().length;
    const half = n > 1 ? 0.5 / (n - 1) : 0;
    return { left: half, right: half, ...this.padding() };
  });
}

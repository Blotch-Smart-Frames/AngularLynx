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

// A scatter mark is just an (x, y) datum, so it reuses the shared `ChartPoint`
// rather than defining its own. That also lets a scatter series and a line
// series (e.g. a regression line) share one dataset on the same axes.

/** One point after projection into plot-local pixel space, with its dot radius. */
type ProjectedDot = {
  /** Center x of the dot, in px. */
  cx: number;
  /** Center y of the dot, in px. */
  cy: number;
  /** Dot radius in px (varies per point for a bubble chart). */
  r: number;
};

/** A square (rendered as a circle via border-radius) in plot-local pixel space. */
export type DotShape = { left: number; top: number; size: number };

// ---------------------------------------------------------------------------
// Pure geometry (exported so it can be unit-tested without Angular)
// ---------------------------------------------------------------------------

/**
 * Turns projected points — already in plot-local pixel space — into square boxes
 * centered on each point, ready to render as circular `<view>`s (the caller sets
 * `border-radius` to half the size). A scatter mark is the simplest chart mark
 * of all: one box per datum, positioned so the point sits at its center.
 *
 * Each dot's radius comes from the point itself, so a per-point radius (a bubble
 * chart) and a uniform radius (a plain scatter) share this one mapping.
 */
export const computeDots = (dots: readonly ProjectedDot[]): DotShape[] =>
  dots.map((d) => ({ left: d.cx - d.r, top: d.cy - d.r, size: d.r * 2 }));

// ---------------------------------------------------------------------------
// Rendering helpers (mirror the equivalents in line-chart.ts / bar-chart.ts —
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

// Default inner inset (fraction of the plot) for the wrapper. Unlike the line
// chart, a scatter's marks are dots at the data extremes, so a small inset on
// every side keeps the edge dots from being clipped by the frame.
const SCATTER_INSET = 0.04;

/**
 * A single scatter series drawn inside a `<ui-cartesian-chart>`. Reads the shared
 * scales from the parent chart via DI and renders one circular `<view>` per datum
 * at its (x, y) position.
 *
 * ## Why the host is `position: absolute; width/height: 100%`
 * Identical to `UiLineSeries`: Lynx resolves an absolute child against its
 * **direct parent** (there is no `position: static`), so the host itself must be
 * the plot-sized containing block. Every dot is a direct child of it.
 *
 * ## Per-point colors and sizes
 * `color` fills every dot by default; pass `colors` to tint each dot (a
 * categorical scatter) — the palette cycles if it is shorter than the data. Pass
 * `sizes` to give each dot its own radius (a bubble chart); a point with no entry
 * falls back to the uniform `radius`.
 */
@Component({
  selector: 'ui-scatter-series',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    style:
      'position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;',
    '[class]': 'userClass()',
  },
  template: `
    @for (dot of dots(); track $index) {
      <view [style]="dot.style" (bindtap)="onPointTap(dot.point)"></view>
    }
  `,
})
export class UiScatterSeries {
  readonly #chart = inject(UiCartesianChart);

  readonly data = input.required<ChartPoint[]>();
  /** Fill for every dot. Overridden per dot by `colors` when that is set. */
  readonly color = input('var(--primary)');
  /** Per-dot fills (a categorical palette). Cycles when shorter than the data;
   * an empty array falls back to `color`. */
  readonly colors = input<string[]>([]);
  /** Uniform dot radius in px. Overridden per dot by `sizes`. */
  readonly radius = input(4);
  /** Per-dot radii in px (a bubble chart). A point with no entry uses `radius`. */
  readonly sizes = input<number[]>([]);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pointTap = output<ChartPoint>();

  // Project each datum into plot-local pixel space via the shared scales, picking
  // up a per-point radius when `sizes` supplies one. Reading the chart's scale
  // signals here makes this recompute whenever the domain or plot size changes.
  readonly #projected = computed(() => {
    const scaleX = this.#chart.xScale();
    const scaleY = this.#chart.yScale();
    const sizes = this.sizes();
    const r = this.radius();
    return this.data().map((point, i) => ({
      cx: scaleX(point.x),
      cy: scaleY(point.y),
      r: sizes[i] ?? r,
      point,
    }));
  });

  protected readonly dots = computed(() => {
    const projected = this.#projected();
    const fallback = this.color();
    const palette = this.colors();
    // computeDots works purely from the projected pixel fields; zip its output
    // back with each source point so a dot's tap can emit the original datum.
    // A circle is a square with border-radius of half its size.
    return computeDots(projected).map((shape, i) => {
      const fill = palette.length ? palette[i % palette.length] : fallback;
      return {
        point: projected[i].point,
        style:
          `position: absolute; left: ${px(shape.left)}; top: ${px(shape.top)}; ` +
          `width: ${px(shape.size)}; height: ${px(shape.size)}; ` +
          `background-color: ${fill}; border-radius: ${px(shape.size / 2)};`,
      };
    });
  });

  protected onPointTap(point: ChartPoint): void {
    this.pointTap.emit(point);
  }
}

/**
 * A ready-to-use scatter chart for the common single-series case. Composes a
 * `<ui-cartesian-chart>` with one `<ui-scatter-series>` and auto-derives rounded
 * axis domains + ticks from the data. For a regression/trend line on top, or
 * full control over the axes, use `<ui-cartesian-chart>` with a
 * `<ui-scatter-series>` (and optionally a `<ui-line-series>`) directly.
 */
@Component({
  selector: 'ui-scatter-chart',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiCartesianChart, UiScatterSeries],
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
      <ui-scatter-series
        [data]="data()"
        [color]="color()"
        [colors]="colors()"
        [radius]="radius()"
        [sizes]="sizes()"
        (pointTap)="pointTap.emit($event)"
      />
    </ui-cartesian-chart>
  `,
})
export class UiScatterChart {
  readonly data = input.required<ChartPoint[]>();
  readonly color = input('var(--primary)');
  readonly colors = input<string[]>([]);
  readonly radius = input(4);
  readonly sizes = input<number[]>([]);
  readonly width = input(320);
  readonly height = input(200);
  readonly tickCount = input(5);
  /** Draw vertical gridlines at each x tick (horizontal ones are on by default). */
  readonly showXGrid = input(false);
  /** Title for the x-axis (centered below the tick labels). */
  readonly xAxisLabel = input<string>('');
  /** Title for the y-axis (rotated in the left gutter). */
  readonly yAxisLabel = input<string>('');
  /** Inner inset of the plot area — merged over the default all-side inset
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

  // Pan/zoom — forwarded to the underlying <ui-cartesian-chart>. Off by default.
  readonly zoomable = input(false);
  readonly zoomAxes = input<'x' | 'y' | 'xy'>('xy');
  readonly showZoomControls = input(true);
  readonly minZoom = input(1);
  readonly maxZoom = input(8);
  readonly zoomStep = input(1.4);

  readonly pointTap = output<ChartPoint>();

  // Auto-compute rounded axes from the data extremes, letting an explicit
  // min/max override either end. Unlike the bar/area charts there is no baseline
  // to fold in — both axes simply fit the data. `Math.min/max(...[])` yield
  // ±Infinity for empty data, which `niceScale` handles by padding.
  protected readonly xAxis = computed(() => {
    const xs = this.data().map((p) => p.x);
    const lo = this.xMin() ?? Math.min(...xs);
    const hi = this.xMax() ?? Math.max(...xs);
    return niceScale(lo, hi, this.tickCount());
  });
  protected readonly yAxis = computed(() => {
    const ys = this.data().map((p) => p.y);
    const lo = this.yMin() ?? Math.min(...ys);
    const hi = this.yMax() ?? Math.max(...ys);
    return niceScale(lo, hi, this.tickCount());
  });

  // Dots sit at the data extremes, so without an inset the edge dots would be
  // clipped by the frame. Default a small inset on every side; user `padding` is
  // spread last, so an explicit side wins.
  protected readonly effectivePadding = computed<ChartPadding>(() => ({
    top: SCATTER_INSET,
    right: SCATTER_INSET,
    bottom: SCATTER_INSET,
    left: SCATTER_INSET,
    ...this.padding(),
  }));
}

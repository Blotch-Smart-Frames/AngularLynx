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
  sampleSmoothLine,
} from '../cartesian-chart/cartesian-chart';
import { UiLineSeries } from '../line-chart/line-chart';

// ---------------------------------------------------------------------------
// Pure geometry (exported so it can be unit-tested without Angular)
// ---------------------------------------------------------------------------

/** One vertical fill column: a rectangle `height` px tall starting at (`x`, `top`). */
export type AreaColumn = {
  x: number;
  width: number;
  top: number;
  height: number;
};

/**
 * Linearly interpolates the polyline's y at pixel `x`. `points` must be sorted
 * ascending by x (as cartesian-chart data always is). Returns `null` when `x`
 * falls outside the data's x-range, so the fill is only drawn *under the actual
 * series* — never extrapolated flat past the first or last point.
 */
const interpolateY = (
  points: readonly ChartPoint[],
  x: number,
): number | null => {
  const first = points[0];
  const last = points[points.length - 1];
  if (x < first.x || x > last.x) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (x >= p1.x && x <= p2.x) {
      const span = p2.x - p1.x;
      if (span === 0) return p1.y; // duplicate x — avoid divide-by-zero
      return p1.y + ((x - p1.x) / span) * (p2.y - p1.y);
    }
  }
  return last.y; // defensive: x === last.x but the loop missed it
};

/**
 * Rasterizes the region between a polyline and a horizontal baseline into thin
 * vertical `<view>` columns — the Lynx substitute for a filled area.
 *
 * Lynx has no filled-polygon primitive: `clip-path` supports no `polygon()` and
 * its inline `<svg>` is unreliable, so an area is approximated as a run of
 * adjacent rectangles, one per `stripWidth` band, each reaching from the
 * interpolated line height down to `baseY`. The crisp line is drawn on top (see
 * `UiAreaSeries`), which hides the columns' stepped upper edge. Sampling at each
 * strip's center keeps that step within about `stripWidth / 2 × slope` px.
 *
 * Guards: fewer than two points, or a non-positive `plotWidth`/`stripWidth`,
 * yield no columns; near-zero-height columns (line meeting the baseline) are
 * skipped so we never emit a degenerate 0-height view.
 */
export const computeAreaColumns = (
  points: readonly ChartPoint[],
  baseY: number,
  plotWidth: number,
  stripWidth: number,
): AreaColumn[] => {
  const columns: AreaColumn[] = [];
  if (points.length < 2 || plotWidth <= 0 || stripWidth <= 0) return columns;

  for (let x = 0; x < plotWidth; x += stripWidth) {
    // Sample the line at the strip's center (clamped to the plot's right edge).
    const center = Math.min(x + stripWidth / 2, plotWidth);
    const lineY = interpolateY(points, center);
    if (lineY === null) continue;

    const top = Math.min(lineY, baseY);
    const height = Math.abs(lineY - baseY);
    if (height < 0.01) continue; // line rests on the baseline here — nothing to fill

    // A hair of overlap (stripWidth + 1) closes sub-pixel seams between adjacent
    // columns. Harmless: the shared `opacity` layer composites them once, so the
    // overlaps never double-darken.
    columns.push({ x, width: stripWidth + 1, top, height });
  }
  return columns;
};

// ---------------------------------------------------------------------------
// Rendering helpers (mirror the equivalents in line-chart.ts — kept local so
// this module stays self-contained when scaffolded by `dolan add`)
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

/**
 * Width of each fill strip in px. Smaller means a smoother top edge but more
 * native views (roughly `plotWidth / STRIP_WIDTH` per series); 3px keeps a
 * ~250px plot near ~83 views, and the crisp line drawn on top hides the residual
 * stepping. Lynx offers no polygon `clip-path` or reliable `<svg>` fill, so the
 * area is rasterized this way rather than drawn as a single shape.
 */
const STRIP_WIDTH = 3;

/**
 * A single area series drawn inside a `<ui-cartesian-chart>`: a translucent fill
 * beneath a line. It reuses `<ui-line-series>` for the crisp line + dots and adds
 * only the fill — an area chart is, structurally, a line chart with the region
 * down to a baseline filled in.
 *
 * ## Why the host is `position: absolute; width/height: 100%`
 * Identical to `UiLineSeries`: Lynx resolves an absolute child against its
 * **direct parent** (there is no `position: static`), so the host itself must be
 * the plot-sized containing block. Both the fill layer and the nested
 * `<ui-line-series>` are direct children of this host and fill it exactly.
 *
 * ## Why the nested `<ui-line-series>` still finds the chart
 * Element injectors are parented by *template nesting*, not physical projection.
 * `<ui-line-series>` sits in this component's template, so its injector chains up
 * through this host to the `UiCartesianChart` that `<ui-area-series>` is projected
 * into — the same `inject(UiCartesianChart)` that `UiLineSeries` already relies
 * on, one level deeper.
 */
@Component({
  selector: 'ui-area-series',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiLineSeries],
  encapsulation: ViewEncapsulation.None,
  host: {
    style:
      'position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;',
    '[class]': 'userClass()',
  },
  template: `
    <!-- Fill layer first so the line + dots (below) paint on top of it. Its own
         opacity makes the whole fill translucent in a single composite —
         independent of the color's format (rgba/var()/named), so there's no need
         to inject an alpha channel into an arbitrary CSS color string. -->
    <view [style]="fillLayerStyle()">
      @for (column of columns(); track $index) {
        <view [style]="column.style"></view>
      }
    </view>
    <ui-line-series
      [data]="data()"
      [color]="color()"
      [strokeWidth]="strokeWidth()"
      [dotRadius]="dotRadius()"
      [showDots]="showDots()"
      [smooth]="smooth()"
      (pointTap)="pointTap.emit($event)"
    />
  `,
})
export class UiAreaSeries {
  readonly #chart = inject(UiCartesianChart);

  readonly data = input.required<ChartPoint[]>();
  readonly color = input('var(--primary)');
  readonly strokeWidth = input(2);
  readonly dotRadius = input(3);
  readonly showDots = input(true);
  readonly fillOpacity = input(0.2);
  /** Data-space y the fill descends to (the flat edge of the area). */
  readonly baseline = input(0);
  /** Fill under a smooth (monotone-cubic) curve instead of straight segments.
   * Forwarded to the nested line so the crisp edge matches the fill's top. */
  readonly smooth = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pointTap = output<ChartPoint>();

  // Project each data point into plot-local pixel space via the shared scales.
  readonly #pixelPoints = computed(() => {
    const scaleX = this.#chart.xScale();
    const scaleY = this.#chart.yScale();
    return this.data().map((point) => ({
      x: scaleX(point.x),
      y: scaleY(point.y),
    }));
  });

  protected readonly fillLayerStyle = computed(
    () =>
      `position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; opacity: ${this.fillOpacity()};`,
  );

  protected readonly columns = computed(() => {
    const fill = this.color();
    // Clamp the baseline into the plot so a baseline outside the domain anchors
    // the fill to the nearest edge (top/bottom) instead of drawing off-plot.
    const baseY = clamp(
      this.#chart.yScale()(this.baseline()),
      0,
      this.#chart.plotHeight(),
    );
    // In smooth mode the fill traces the same monotone-cubic curve as the line:
    // sampling the polyline densely means `computeAreaColumns` (which linearly
    // interpolates the height at each strip) closely follows the curve's top edge.
    const pixels = this.#pixelPoints();
    const line = this.smooth() ? sampleSmoothLine(pixels) : pixels;
    return computeAreaColumns(
      line,
      baseY,
      this.#chart.plotWidth(),
      STRIP_WIDTH,
    ).map((c) => ({
      style:
        `position: absolute; left: ${px(c.x)}; top: ${px(c.top)}; ` +
        `width: ${px(c.width)}; height: ${px(c.height)}; background-color: ${fill};`,
    }));
  });
}

/**
 * A ready-to-use area chart for the common single-series case. Composes a
 * `<ui-cartesian-chart>` with one `<ui-area-series>` and auto-derives rounded
 * axis domains + ticks from the data. For multiple series or full control over
 * the axes, use `<ui-cartesian-chart>` with `<ui-area-series>` children directly.
 */
@Component({
  selector: 'ui-area-chart',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiCartesianChart, UiAreaSeries],
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
      [padding]="padding()"
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
      <ui-area-series
        [data]="data()"
        [color]="color()"
        [strokeWidth]="strokeWidth()"
        [dotRadius]="dotRadius()"
        [showDots]="showDots()"
        [fillOpacity]="fillOpacity()"
        [baseline]="baseline()"
        [smooth]="smooth()"
        (pointTap)="pointTap.emit($event)"
      />
    </ui-cartesian-chart>
  `,
})
export class UiAreaChart {
  readonly data = input.required<ChartPoint[]>();
  readonly color = input('var(--primary)');
  readonly width = input(320);
  readonly height = input(200);
  readonly tickCount = input(5);
  readonly strokeWidth = input(2);
  readonly dotRadius = input(3);
  readonly showDots = input(true);
  readonly fillOpacity = input(0.2);
  readonly baseline = input(0);
  /** Fill under a smooth (monotone-cubic) curve instead of straight segments. */
  readonly smooth = input(false);
  /** Draw vertical gridlines at each x tick. */
  readonly showXGrid = input(false);
  /** Title for the x-axis (centered below the tick labels). */
  readonly xAxisLabel = input<string>('');
  /** Title for the y-axis (rotated in the left gutter). */
  readonly yAxisLabel = input<string>('');
  /** Inner inset of the plot area, each side a fraction (0–1) — see {@link ChartPadding}. */
  readonly padding = input<ChartPadding>({});
  /** Force the x-axis lower/upper bound instead of deriving it from the data.
   * Omitted bounds fall back to the data extremes. */
  readonly xMin = input<number | undefined>(undefined);
  readonly xMax = input<number | undefined>(undefined);
  /** Force the y-axis lower/upper bound. The `baseline` is still folded in, so
   * `yMin` only lowers the floor further — it can't clip the fill's base off. */
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
  // min/max override either end. `Math.min/max(...[])` yield ±Infinity for empty
  // data, which `niceScale` handles by padding.
  protected readonly xAxis = computed(() => {
    const xs = this.data().map((p) => p.x);
    const lo = this.xMin() ?? Math.min(...xs);
    const hi = this.xMax() ?? Math.max(...xs);
    return niceScale(lo, hi, this.tickCount());
  });
  // Fold the baseline into the y-extent so the axis always spans the whole filled
  // region: a positive-only series still shows the baseline at the bottom, and
  // negative values pull the domain below it. An explicit yMin/yMax overrides the
  // corresponding data-derived end (the baseline still participates in the other).
  protected readonly yAxis = computed(() => {
    const ys = this.data().map((p) => p.y);
    const base = this.baseline();
    const lo = this.yMin() ?? Math.min(base, ...ys);
    const hi = this.yMax() ?? Math.max(base, ...ys);
    return niceScale(lo, hi, this.tickCount());
  });
}

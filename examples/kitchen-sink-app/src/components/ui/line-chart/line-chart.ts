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

// ---------------------------------------------------------------------------
// Pure geometry (exported so it can be unit-tested without Angular)
// ---------------------------------------------------------------------------

/** A rotated line segment spec: start point (plot-local px), length, angle. */
export type LineSegment = {
  x: number;
  y: number;
  length: number;
  /** Rotation in degrees, measured clockwise from the +x axis (screen y-down). */
  angle: number;
};

/**
 * Turns a polyline — already projected into plot-local pixel space — into a list
 * of rotated segment specs. Lynx has no `<line>`/SVG, so each segment is drawn
 * as a thin `<view>` rotated about its start point (see `UiLineSeries`).
 *
 * The length uses `Math.sqrt(dx² + dy²)` rather than `Math.hypot` for the same
 * reason `niceNum` avoids `Math.log10`: `hypot` is a runtime method the Lynx
 * build pipeline may not polyfill, whereas `sqrt`/`atan2` are ES5 and always
 * present. Zero-length segments (duplicate consecutive points) are skipped so we
 * never emit a degenerate 0-width rotated view.
 */
export const computeLineSegments = (
  points: readonly ChartPoint[],
): LineSegment[] => {
  const segments: LineSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    segments.push({ x: p1.x, y: p1.y, length, angle });
  }
  return segments;
};

// ---------------------------------------------------------------------------
// Rendering helpers (mirror the equivalents in cartesian-chart.ts — kept local
// so this module stays self-contained when scaffolded by `dolan add`)
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

/**
 * A single line series drawn inside a `<ui-cartesian-chart>`. Reads the shared
 * scales from the parent chart via DI and renders the polyline (rotated `<view>`
 * segments) plus a dot at each data point.
 *
 * ## Why the host is `position: absolute; width/height: 100%`
 * Lynx resolves an absolute child against its **direct parent** (there is no
 * `position: static`). The marks are direct children of this host, so the host
 * itself must be the plot-sized containing block — it fills the plot area (its
 * direct parent, a definite-size box). Sizing an *inner* view instead would fail
 * because a content-sized host of absolute-only children collapses to 0×0.
 */
@Component({
  selector: 'ui-line-series',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    style:
      'position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;',
    '[class]': 'userClass()',
  },
  template: `
    <!-- Segments render before dots so each dot paints on top of the line
         (Lynx paint order follows source order; z-index is unnecessary). -->
    @for (segment of segments(); track $index) {
      <view [style]="segment.style"></view>
    }
    @for (dot of dots(); track $index) {
      <view [style]="dot.style" (bindtap)="onPointTap(dot.point)"></view>
    }
  `,
})
export class UiLineSeries {
  readonly #chart = inject(UiCartesianChart);

  readonly data = input.required<ChartPoint[]>();
  readonly color = input('var(--primary)');
  readonly strokeWidth = input(2);
  readonly dotRadius = input(3);
  readonly showDots = input(true);
  /** Draw a smooth (monotone-cubic) curve through the points instead of straight
   * segments. Dots still sit on the raw data points. */
  readonly smooth = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pointTap = output<ChartPoint>();

  // Project each data point into plot-local pixel space via the shared scales.
  // Reading the chart's scale signals here makes this recompute whenever the
  // domain or plot size changes.
  readonly #pixelPoints = computed(() => {
    const scaleX = this.#chart.xScale();
    const scaleY = this.#chart.yScale();
    return this.data().map((point) => ({
      x: scaleX(point.x),
      y: scaleY(point.y),
      point,
    }));
  });

  protected readonly segments = computed(() => {
    const stroke = this.strokeWidth();
    const fill = this.color();
    // Smooth mode replaces the raw polyline with a dense monotone-cubic
    // resampling; `computeLineSegments` then rasterizes it identically — the
    // curve is just made of many more, shorter rotated views.
    const pixels = this.#pixelPoints();
    const line = this.smooth() ? sampleSmoothLine(pixels) : pixels;
    return computeLineSegments(line).map((s) => ({
      style:
        `position: absolute; left: ${px(s.x)}; top: ${px(s.y - stroke / 2)}; ` +
        `width: ${px(s.length)}; height: ${px(stroke)}; ` +
        `background-color: ${fill}; border-radius: ${px(stroke / 2)}; ` +
        `transform-origin: 0 50%; transform: rotate(${s.angle.toFixed(2)}deg);`,
    }));
  });

  protected readonly dots = computed(() => {
    if (!this.showDots()) return [];
    const radius = this.dotRadius();
    const fill = this.color();
    return this.#pixelPoints().map((p) => ({
      point: p.point,
      style:
        `position: absolute; left: ${px(p.x - radius)}; top: ${px(p.y - radius)}; ` +
        `width: ${px(radius * 2)}; height: ${px(radius * 2)}; ` +
        `background-color: ${fill}; border-radius: ${px(radius)};`,
    }));
  });

  protected onPointTap(point: ChartPoint): void {
    this.pointTap.emit(point);
  }
}

/**
 * A ready-to-use line chart for the common single-series case. Composes a
 * `<ui-cartesian-chart>` with one `<ui-line-series>` and auto-derives rounded
 * axis domains + ticks from the data. For multiple series or full control over
 * the axes, use `<ui-cartesian-chart>` with `<ui-line-series>` children directly.
 */
@Component({
  selector: 'ui-line-chart',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiCartesianChart, UiLineSeries],
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
      <ui-line-series
        [data]="data()"
        [color]="color()"
        [strokeWidth]="strokeWidth()"
        [dotRadius]="dotRadius()"
        [showDots]="showDots()"
        [smooth]="smooth()"
        (pointTap)="pointTap.emit($event)"
      />
    </ui-cartesian-chart>
  `,
})
export class UiLineChart {
  readonly data = input.required<ChartPoint[]>();
  readonly color = input('var(--primary)');
  readonly width = input(320);
  readonly height = input(200);
  readonly tickCount = input(5);
  readonly strokeWidth = input(2);
  readonly dotRadius = input(3);
  readonly showDots = input(true);
  /** Draw a smooth (monotone-cubic) curve through the points. */
  readonly smooth = input(false);
  /** Draw vertical gridlines at each x tick. */
  readonly showXGrid = input(false);
  /** Title for the x-axis (centered below the tick labels). */
  readonly xAxisLabel = input<string>('');
  /** Title for the y-axis (rotated in the left gutter). */
  readonly yAxisLabel = input<string>('');
  /** Inner inset of the plot area, each side a fraction (0–1) — see {@link ChartPadding}. */
  readonly padding = input<ChartPadding>({});
  /** Force the x-axis lower/upper bound instead of deriving it from the data —
   * e.g. `xMin={0}` to anchor the origin. Omitted bounds fall back to the data. */
  readonly xMin = input<number | undefined>(undefined);
  readonly xMax = input<number | undefined>(undefined);
  /** Force the y-axis lower/upper bound (e.g. `yMin={0}` to start at zero). */
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
  protected readonly yAxis = computed(() => {
    const ys = this.data().map((p) => p.y);
    const lo = this.yMin() ?? Math.min(...ys);
    const hi = this.yMax() ?? Math.max(...ys);
    return niceScale(lo, hi, this.tickCount());
  });
}

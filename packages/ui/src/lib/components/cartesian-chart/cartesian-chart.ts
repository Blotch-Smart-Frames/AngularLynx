import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  Gesture,
  LYNX_ELEMENTS,
  LynxGestureDetector,
  PanGesture,
  type PanGestureEvent,
  PinchGesture,
  type PinchGestureEvent,
} from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single data point in cartesian (x, y) space. */
export type ChartPoint = { x: number; y: number };

/** An inclusive `[min, max]` value range for one axis. */
export type ChartDomain = readonly [number, number];

/** Maps a data value on one axis to a pixel offset inside the plot area. */
export type ChartScale = (value: number) => number;

/**
 * Inner inset applied to the plot area, one value per side as a **fraction**
 * (`0`–`1`) of the plot's width/height. It shrinks the range the scales map into,
 * so every projected series is pushed clear of the frame at once — the common use
 * is keeping the first/last dot from sitting flush against the axis. Fractions
 * (not pixels) keep the inset proportional as the chart is resized. Omitted sides
 * default to `0`.
 */
export type ChartPadding = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

// ---------------------------------------------------------------------------
// Pure geometry (exported so it can be unit-tested without Angular)
// ---------------------------------------------------------------------------

/**
 * Builds a linear interpolation function from a data `domain` to a pixel
 * `range`. The range is allowed to be *descending* (`[height, 0]`) — that is how
 * the y-axis is flipped so that larger data values render higher up the screen
 * (screen y grows downward).
 *
 * A zero-width domain (all values equal) would divide by zero, so it collapses
 * to the range midpoint — the flat line then sits centered in the plot.
 */
export const linearScale = (
  domain: ChartDomain,
  range: readonly [number, number],
): ChartScale => {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
};

/**
 * Rounds a number to a "nice" one — a `1`, `2`, `5`, or `10` times a power of
 * ten. This is the Heckbert "nice numbers for graph labels" primitive: it makes
 * axis steps read as `0, 25, 50, 75, 100` rather than `0, 24.25, 48.5, …`.
 *
 * We compute the magnitude with `Math.log(x) / Math.LN10` rather than
 * `Math.log10` — the latter is a runtime method the Lynx build pipeline does
 * NOT polyfill (same class of gap as `String.prototype.replaceAll`), whereas
 * `Math.log`/`Math.LN10` are ES5 and always present.
 *
 * @param round when `true`, snap to the nearest nice number; when `false`, take
 *   the smallest nice number ≥ `value` (used to size the whole range).
 */
export const niceNum = (value: number, round: boolean): number => {
  if (value <= 0) return 0;
  const exponent = Math.floor(Math.log(value) / Math.LN10);
  const fraction = value / Math.pow(10, exponent); // in [1, 10)
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
};

/**
 * Derives a rounded axis from raw data extremes: a padded `[lo, hi]` domain
 * plus evenly stepped, human-readable `ticks`. `tickCount` is a *target* — the
 * actual tick count can differ by one because the step is snapped to a nice
 * value (this is standard axis behavior, e.g. D3's `ticks`).
 *
 * Flat data (`min === max`) or non-finite input can't yield a range, so we pad
 * around the single value to keep the line visible mid-plot.
 */
export const niceScale = (
  min: number,
  max: number,
  tickCount = 5,
): { domain: ChartDomain; ticks: number[]; step: number } => {
  let lo0 = min;
  let hi0 = max;
  if (!Number.isFinite(lo0) || !Number.isFinite(hi0) || lo0 === hi0) {
    const base = Number.isFinite(lo0) ? lo0 : 0;
    const pad = base === 0 ? 1 : Math.abs(base) * 0.5;
    lo0 = base - pad;
    hi0 = base + pad;
  }

  const range = niceNum(hi0 - lo0, false);
  const step = niceNum(range / Math.max(1, tickCount - 1), true);
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step;

  const ticks: number[] = [];
  // Step to `hi` inclusive; the half-step slack absorbs floating-point drift so
  // the final tick isn't dropped. Snapping each value to the step grid clears
  // accumulated error (e.g. 0.30000000000000004 → 0.3).
  for (let v = lo; v <= hi + step * 0.5; v += step) {
    ticks.push(Math.round(v / step) * step);
  }

  return { domain: [lo, hi], ticks, step };
};

/**
 * Evenly divides a `domain` into exactly `count` tick values (endpoints
 * included). Used as the fallback when a caller hasn't supplied explicit ticks
 * — `niceScale` is preferred when human-readable labels matter.
 */
export const generateTicks = (domain: ChartDomain, count: number): number[] => {
  const [d0, d1] = domain;
  if (count <= 1) return [d0];
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(d0 + ((d1 - d0) * i) / (count - 1));
  }
  return ticks;
};

// Extra ticks generated beyond the target count so a full "screen" of grid
// stays covered while a pan is mid-slide. The extras land just past either
// plot edge, clipped by `overflow: hidden` — never visible, just inert
// elements reserved so the `@for` never needs to grow.
const ALIGNED_TICK_BUFFER = 2;

/**
 * Computes ZERO-aligned tick values spanning a `window` at a fixed "nice" step
 * derived from the window's span (see {@link niceNum}). Unlike `generateTicks`
 * — which divides a window into a fixed *fraction* of its own span, so every
 * tick re-lands on the exact same pixel position the instant the window
 * shifts (the axis *numbers* change but the *gridlines* visually stay put,
 * which is what made a pan look like it was translating nothing) — each tick
 * here sits on a fixed multiple of `step` in DATA space. Panning changes which
 * multiples fall inside the window, but never an individual tick's data
 * value, so its projected pixel position slides across the screen exactly in
 * step with the content it labels — real X/Y scroll behavior.
 *
 * The returned array always has `targetCount + ALIGNED_TICK_BUFFER` entries —
 * a count that depends only on `targetCount` (an input, stable for the whole
 * gesture), never on the window's position — so it can back a Lynx
 * gesture-driven `@for` without ever adding/removing nodes mid-drag.
 */
export const generateAlignedTicks = (
  window: ChartDomain,
  targetCount: number,
): number[] => {
  const span = window[1] - window[0];
  const step = niceNum(span / Math.max(1, targetCount - 1), true) || 1;
  const firstIndex = Math.floor(window[0] / step) - 1;
  const count = Math.max(1, targetCount) + ALIGNED_TICK_BUFFER;
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push((firstIndex + i) * step);
  }
  return ticks;
};

/**
 * True when `value` sits outside `domain`, treating the bounds as inclusive: a
 * tick exactly on a bound reads as inside, protected by a tiny relative epsilon
 * so float drift in the window math can't exclude a legitimate edge tick.
 *
 * Drives per-label hiding for zoomable charts — {@link generateAlignedTicks}
 * intentionally emits a couple of tick values just past each edge of the
 * visible window (so the grid stays covered while panning without changing the
 * element count), and this predicate is what suppresses those buffer ticks'
 * labels while every in-window label renders in full. Testing by value rather
 * than projected pixel keeps it independent of axis padding.
 */
export const isValueOutsideDomain = (
  value: number,
  domain: ChartDomain,
): boolean => {
  const eps = Math.abs(domain[1] - domain[0]) * 1e-6;
  return value < domain[0] - eps || value > domain[1] + eps;
};

/**
 * ---------------------------------------------------------------------------
 * Pan / zoom window math (pure — exported for unit tests)
 *
 * Pan and zoom are modeled as a *visible window*: a sub-range of the axis
 * domain that the scales map from. Shrinking the window zooms in (data spreads
 * across the same pixels), sliding it pans. Because every gridline, axis label,
 * and series mark projects through the scales, replacing the window re-projects
 * the whole chart — and bar/candle widths (derived from projected pixel spacing)
 * stretch for free. These helpers are the pure geometry behind that model.
 * ---------------------------------------------------------------------------
 */

const clampValue = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

// Gridlines are 1px thick. A line whose data value sits exactly on the plot's
// FAR edge — the bottom (y = domain min) or the right (x = domain max) —
// projects to pixel `plotHeight` / `plotWidth`: the first row/column just
// OUTSIDE the plot's content box. The plot needs `overflow: hidden` to clip
// panned/zoomed marks, so that 1px line is clipped away and the edge gridline
// silently vanishes (reported: the y-axis "0" gridline isn't visible; its label
// still shows because labels live in the un-clipped container). This is ordinary
// box geometry, not a Lynx quirk — a child at `top: 100%` height 1px is outside
// an overflow-hidden parent on the web too.
const GRIDLINE_THICKNESS = 1;

/**
 * The pixel offset at which to draw a gridline of {@link GRIDLINE_THICKNESS},
 * nudged so an in-window line at the plot's far edge stays visible instead of
 * being clipped by the plot's `overflow: hidden`. An in-domain line is clamped
 * into `[0, extentPx - thickness]` so its full thickness lands inside the box; an
 * out-of-domain line — the buffer ticks {@link generateAlignedTicks} emits just
 * past each edge while panning — is returned unclamped so it clips away
 * naturally, because clamping those would instead pile them onto the visible edge.
 */
export const gridlineOffset = (
  value: number,
  offsetPx: number,
  domain: ChartDomain,
  extentPx: number,
  thickness = GRIDLINE_THICKNESS,
): number =>
  isValueOutsideDomain(value, domain)
    ? offsetPx
    : clampValue(offsetPx, 0, extentPx - thickness);

/**
 * The inverse of {@link linearScale}: maps a pixel offset back to its data
 * value. Used to turn a pinch's focal *pixel* into the data value under the
 * fingers, so the zoom can hold that value fixed on screen. A zero-width range
 * (all pixels equal) can't be inverted, so it collapses to the domain's lower
 * bound.
 */
export const invertLinear = (
  domain: ChartDomain,
  range: readonly [number, number],
  pixel: number,
): number => {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = r1 - r0;
  if (span === 0) return d0;
  return d0 + ((pixel - r0) / span) * (d1 - d0);
};

/**
 * Clamps a visible `window` so it always sits inside the full data `base`
 * domain: its span can't exceed the base span, and it can't slide past either
 * edge. Span is preserved where possible (the window slides rather than resizes)
 * so panning against an edge doesn't secretly zoom. Keeps a zoomed view valid
 * even if the underlying data domain later shrinks.
 */
export const clampWindow = (
  base: ChartDomain,
  window: ChartDomain,
): ChartDomain => {
  const [bLo, bHi] = base;
  const baseSpan = bHi - bLo;
  const span = Math.min(window[1] - window[0], baseSpan);
  const lo = clampValue(window[0], bLo, bHi - span);
  return [lo, lo + span];
};

/**
 * Pans a visible `window` by `dataDelta` (in data units), clamped inside `base`.
 * The span is preserved, so hitting an edge stops the pan rather than resizing
 * the window. Positive `dataDelta` moves the window toward higher values.
 */
export const panWindow = (
  base: ChartDomain,
  current: ChartDomain,
  dataDelta: number,
): ChartDomain =>
  clampWindow(base, [current[0] + dataDelta, current[1] + dataDelta]);

/**
 * Zooms a visible `window` by `factor` (>1 zooms in, <1 zooms out), holding the
 * data value `focal` fixed on screen so a pinch stays centered on the fingers.
 * The resulting span is clamped to `[baseSpan / maxZoom, baseSpan / minZoom]` —
 * you can never zoom out past the full data range, nor in past `maxZoom`× — then
 * the window is clamped inside `base`.
 */
export const zoomWindow = (
  base: ChartDomain,
  current: ChartDomain,
  factor: number,
  focal: number,
  maxZoom: number,
  minZoom = 1,
): ChartDomain => {
  const baseSpan = base[1] - base[0];
  const [lo, hi] = current;
  const span = hi - lo;
  const minSpan = maxZoom > 0 ? baseSpan / maxZoom : baseSpan;
  const maxSpan = minZoom > 0 ? baseSpan / minZoom : baseSpan;
  const newSpan = clampValue(span / (factor || 1), minSpan, maxSpan);
  // Keep the focal value at the same fractional position within the window.
  const frac = span === 0 ? 0.5 : (focal - lo) / span;
  const newLo = focal - frac * newSpan;
  return clampWindow(base, [newLo, newLo + newSpan]);
};

/**
 * Resamples a polyline into a dense run of points that trace a smooth
 * **monotone cubic** curve through the originals — the shared smoothing
 * primitive both the line and the area series build on so that "smooth" behaves
 * identically for either.
 *
 * ## Why monotone cubic (Fritsch–Carlson), not Catmull-Rom
 * A monotone cubic never overshoots its data: between two points the curve stays
 * inside their y-range, so a smoothed line never bulges past a peak and a
 * smoothed area fill never pokes above the plot or dips below its baseline. That
 * matters here because the axis domain is derived from the *raw* data extremes —
 * an overshooting curve (which Catmull-Rom produces) would render outside the
 * plot and clip. This is the same curve D3 draws for `curveMonotoneX` and the
 * default Recharts `type="monotone"`.
 *
 * ## Why resample instead of emitting a path
 * Lynx has no SVG path: a line is drawn as many short rotated `<view>` segments
 * and an area as sampled column heights. So rather than describe the curve, we
 * return closely-spaced points *on* it, and each caller rasterizes them with the
 * exact same code it already uses for raw data (`computeLineSegments` /
 * `computeAreaColumns`). "Smooth" then costs nothing but a denser point set.
 *
 * Points must be sorted ascending by x (as cartesian data always is). Fewer than
 * three points can't define a curve — two already draw a single straight
 * segment — so they're returned unchanged. `samplesPerSegment` is how many
 * straight chords approximate each original segment; higher is smoother but emits
 * proportionally more native views.
 */
export const sampleSmoothLine = (
  points: readonly ChartPoint[],
  samplesPerSegment = 12,
): ChartPoint[] => {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));

  // Secant slope between each consecutive pair. A zero-width x-gap (duplicate x)
  // has no defined slope, so treat it as flat to avoid dividing by zero — the
  // sampler then draws a near-vertical chord across the repeated x.
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    secants.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  // Tangent at each point. Endpoints borrow their single adjacent secant;
  // interior points average their two neighbors, but a sign change (a local
  // peak or trough) forces a flat tangent so the curve turns without overshoot.
  const tangents: number[] = Array.from({ length: n });
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const prev = secants[i - 1];
    const next = secants[i];
    tangents[i] = prev * next <= 0 ? 0 : (prev + next) / 2;
  }

  // Fritsch–Carlson monotonicity fix: keep each Hermite segment monotone by
  // clamping the tangents. Normalize them by the secant into (alpha, beta); if
  // that point falls outside a circle of radius 3, scale both back onto it. A
  // flat secant (equal endpoints) can't be normalized, so its tangents are
  // pinned to 0 instead.
  for (let i = 0; i < n - 1; i++) {
    const secant = secants[i];
    if (secant === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i] / secant;
    const beta = tangents[i + 1] / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[i] = scale * alpha * secant;
      tangents[i + 1] = scale * beta * secant;
    }
  }

  // Evaluate the cubic Hermite spline on each segment. Sampling `t` from 0
  // (inclusive) up to — but not including — 1 hits every original point exactly
  // once via the next segment's t=0; the very last point is appended at the end.
  const samples = Math.max(1, samplesPerSegment);
  const out: ChartPoint[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const h = p1.x - p0.x;
    const m0 = tangents[i];
    const m1 = tangents[i + 1];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      // Hermite basis functions for value (h00, h01) and tangent (h10, h11).
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push({
        x: p0.x + t * h,
        y: h00 * p0.y + h10 * h * m0 + h01 * p1.y + h11 * h * m1,
      });
    }
  }
  out.push({ x: points[n - 1].x, y: points[n - 1].y });
  return out;
};

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Formats a pixel value for an inline style string. Two decimals keeps
 * sub-pixel precision for rotated segments while avoiding scientific notation
 * (`1e-7px`), which Lynx's CSS parser would reject.
 */
const px = (n: number): string => `${n.toFixed(2)}px`;

/**
 * Default axis label formatter — plain JS only (no `Intl`, absent in Lynx).
 */
const defaultTickFormat = (value: number): string =>
  String(Math.round(value * 100) / 100);

// Small pixel constants for label placement. Font is 10px; offsetting a y-label
// by half that vertically-centers it on its gridline.
const LABEL_FONT_HALF = 5;
const LABEL_GUTTER_GAP = 6;
const X_LABEL_WIDTH = 44;
const X_LABEL_GAP = 4;

// Extra gutter reserved when an axis *title* is set: a strip to the left of the
// y tick-labels for the (rotated) y-title, and a band below the x tick-labels for
// the x-title. 16px comfortably fits the 10px title font plus its line box.
const Y_AXIS_LABEL_SPACE = 16;
const X_AXIS_LABEL_SPACE = 16;
// Approximate line box of the 10px title font — used to size the rotated y-title.
const AXIS_LABEL_LINE_HEIGHT = 12;

/**
 * The reusable foundation for cartesian (x/y) charts — line, bar, scatter, …
 *
 * It draws the *frame* — horizontal (and optional vertical) gridlines, axis tick
 * labels, and optional axis titles — and hosts a definite-size **plot area** into
 * which chart marks are projected via `<ng-content>`. Inner `padding` insets the
 * shared scales so every series clears the frame at once. It carries no marks of
 * its own; series components
 * (`<ui-line-series>`, and future `<ui-bar-series>` etc.) `inject()` this class
 * to read the shared `xScale`/`yScale`/`plotWidth`/`plotHeight` and draw
 * themselves. This mirrors the `UiToggleGroup` / `UiToggleGroupItem` DI pattern.
 *
 * ## Why explicit pixel `width`/`height`
 * A line is drawn as rotated `<view>` segments (Lynx has no SVG/`<line>`), and
 * the rotation angle/length can only be computed from *pixel* coordinates. So
 * the chart is sized in explicit px rather than stretching responsively.
 *
 * ## Why absolute positioning works here
 * Lynx has no `position: static` — every element is `position: relative` and an
 * absolute child resolves against its **direct parent**, not a distant
 * ancestor. So the plot area is a definite-size box and every mark must be a
 * direct child of it (or of a series host sized to fill it — see UiLineSeries).
 */
@Component({
  selector: 'ui-cartesian-chart',
  standalone: true,
  imports: [LYNX_ELEMENTS, LynxGestureDetector],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()" [style]="containerStyle()">
      <!--
        Plot area: a definite-size box, offset by the y-axis gutter. It is the
        containing block for both the gridlines and the projected series marks.
        Gridlines render BEFORE <ng-content> so the line paints on top of them
        (Lynx paint order follows source order; z-index is not needed).

        When zoomable, the plot view is the gesture target: a 1-finger drag pans
        and a pinch zooms (both write the visible window). overflow:hidden on the
        plot keeps zoomed marks clipped to this box.
      -->
      <view
        [style]="plotStyle()"
        [lynxGesture]="zoomable() ? interactionGesture : noGesture"
      >
        @if (showGrid()) {
          @for (line of gridlines(); track $index) {
            <view class="bg-border" [style]="line.style"></view>
          }
        }
        @if (showXGrid()) {
          @for (line of verticalGridlines(); track $index) {
            <view class="bg-border" [style]="line.style"></view>
          }
        }
        <ng-content />
      </view>

      <!-- Y-axis tick labels, right-aligned in the gutter beside the plot. -->
      @for (label of yLabels(); track $index) {
        <text
          class="text-[10px] leading-none text-muted-foreground text-right"
          [style]="label.style"
        >
          {{ label.text }}
        </text>
      }

      <!-- X-axis tick labels, centered under each tick below the plot. -->
      @for (label of xLabels(); track $index) {
        <text
          class="text-[10px] leading-none text-muted-foreground text-center"
          [style]="label.style"
        >
          {{ label.text }}
        </text>
      }

      <!-- Y-axis title: rotated -90° in the reserved left strip, centered on the
           plot height. Rendered only when set so it costs no gutter otherwise. -->
      @if (yAxisLabel()) {
        <text
          class="text-[10px] font-medium leading-none text-muted-foreground text-center"
          [style]="yAxisLabelStyle()"
        >
          {{ yAxisLabel() }}
        </text>
      }

      <!-- X-axis title: centered across the plot, below the x tick labels. -->
      @if (xAxisLabel()) {
        <text
          class="text-[10px] font-medium leading-none text-muted-foreground text-center"
          [style]="xAxisLabelStyle()"
        >
          {{ xAxisLabel() }}
        </text>
      }

      <!-- Zoom controls: a small +/−/reset cluster at the plot's top-right.
           Rendered LAST so it paints over the plot, and kept in the container
           (not inside the clipped, gesture-capturing plot view) so it is neither
           clipped by overflow:hidden nor swallowed by the pan gesture. Each is a
           plain (bindtap) view — a normal Angular event, safe to mutate state
           from, unlike the gesture worklet. -->
      @if (zoomable() && showZoomControls()) {
        <view [style]="zoomControlsStyle()" class="flex-col gap-1 flex">
          <view
            class="h-7 w-7 items-center rounded-md border border-border bg-card flex justify-center"
            (bindtap)="zoomIn()"
          >
            <text class="text-base font-medium leading-none text-foreground"
              >+</text
            >
          </view>
          <view
            class="h-7 w-7 items-center rounded-md border border-border bg-card flex justify-center"
            (bindtap)="zoomOut()"
          >
            <text class="text-base font-medium leading-none text-foreground"
              >-</text
            >
          </view>
          <view
            class="h-7 w-7 items-center rounded-md border border-border bg-card flex justify-center"
            (bindtap)="resetZoom()"
          >
            <text class="text-[9px] font-medium leading-none text-foreground"
              >1:1</text
            >
          </view>
        </view>
      }
    </view>
  `,
})
export class UiCartesianChart {
  readonly xDomain = input<ChartDomain>([0, 1]);
  readonly yDomain = input<ChartDomain>([0, 1]);
  /** Explicit tick values. When omitted, ticks are evenly generated. */
  readonly xTicks = input<number[] | undefined>(undefined);
  readonly yTicks = input<number[] | undefined>(undefined);
  readonly width = input(320);
  readonly height = input(200);
  readonly yAxisWidth = input(32);
  readonly xAxisHeight = input(20);
  readonly tickCount = input(5);
  /** Draw horizontal gridlines at each y tick. */
  readonly showGrid = input(true);
  /** Draw vertical gridlines at each x tick (off by default — the y gridlines
   * above are the usual value reference for line/area charts). */
  readonly showXGrid = input(false);
  /** Title drawn along the x-axis, centered below the tick labels. */
  readonly xAxisLabel = input<string>('');
  /** Title drawn along the y-axis, rotated in the left gutter. */
  readonly yAxisLabel = input<string>('');
  /** Inner inset of the plot area, each side a fraction (0–1) — see {@link ChartPadding}. */
  readonly padding = input<ChartPadding>({});
  readonly xTickFormat = input<(value: number) => string>(defaultTickFormat);
  readonly yTickFormat = input<(value: number) => string>(defaultTickFormat);
  readonly userClass = input<string>('', { alias: 'class' });

  // --- Pan / zoom (opt-in) ---
  /** Enable pan (1-finger drag) + zoom (pinch and the on-screen controls). Off
   * by default so existing charts — which often sit inside scroll-views — keep
   * their static behavior and don't fight the native scroll gesture. */
  readonly zoomable = input(false);
  /** Which axes pan/zoom affect. `'xy'` (default) zooms both; `'x'` or `'y'`
   * locks the other axis (e.g. `'x'` for a time-series where only the horizontal
   * stretches). */
  readonly zoomAxes = input<'x' | 'y' | 'xy'>('xy');
  /** Show the +/−/reset control cluster (top-right of the plot) when zoomable. */
  readonly showZoomControls = input(true);
  /** Lower zoom bound (1 = fully zoomed out; you can't zoom out past the data). */
  readonly minZoom = input(1);
  /** Upper zoom bound — the visible window can shrink to `baseSpan / maxZoom`. */
  readonly maxZoom = input(8);
  /** Multiplier applied per +/− control press. 1.4 ≈ a comfortable step. */
  readonly zoomStep = input(1.4);

  // --- Shared coordinate system (read by projected series via DI) ---

  // A set axis title steals a strip of the gutter (left for y, bottom for x);
  // absorbing it here shrinks the plot so titles never overlap the tick labels.
  readonly #yGutter = computed(
    () => this.yAxisWidth() + (this.yAxisLabel() ? Y_AXIS_LABEL_SPACE : 0),
  );
  readonly #xGutter = computed(
    () => this.xAxisHeight() + (this.xAxisLabel() ? X_AXIS_LABEL_SPACE : 0),
  );

  readonly plotWidth = computed(() => this.width() - this.#yGutter());
  readonly plotHeight = computed(() => this.height() - this.#xGutter());

  // Padding as pixels, resolved against the plot size. Omitted sides read as 0.
  readonly #padLeft = computed(
    () => (this.padding().left ?? 0) * this.plotWidth(),
  );
  readonly #padRight = computed(
    () => (this.padding().right ?? 0) * this.plotWidth(),
  );
  readonly #padTop = computed(
    () => (this.padding().top ?? 0) * this.plotHeight(),
  );
  readonly #padBottom = computed(
    () => (this.padding().bottom ?? 0) * this.plotHeight(),
  );

  // --- Pan/zoom view state ---
  // The currently-visible sub-window of each axis domain, or `null` when the
  // chart is at rest (fully zoomed out). Gestures and the zoom controls write
  // these; everything downstream (scales, gridlines, labels, series marks) reads
  // through the effective domain below, so a single signal write re-projects the
  // whole chart. `null` (rather than the base domain) marks "at rest" so a
  // non-zoomable chart keeps its exact original tick behavior (see
  // `#resolvedXTicks`).
  readonly #viewXDomain = signal<ChartDomain | null>(null);
  readonly #viewYDomain = signal<ChartDomain | null>(null);

  // The domain the scales actually map from: the visible window when zoomed,
  // else the input domain. Clamped to the input domain so a data change while
  // zoomed can never strand the window outside the data.
  readonly #effectiveXDomain = computed<ChartDomain>(() => {
    const view = this.#viewXDomain();
    return view ? clampWindow(this.xDomain(), view) : this.xDomain();
  });
  readonly #effectiveYDomain = computed<ChartDomain>(() => {
    const view = this.#viewYDomain();
    return view ? clampWindow(this.yDomain(), view) : this.yDomain();
  });

  // Scales map the *effective* domain into the padded range, so every projected
  // series is inset from the frame together — no per-series padding needed. When
  // zoomed, the effective domain is the visible window, so the same scale drives
  // gridlines, labels, and every mark (bars/candles stretch because their width
  // is derived from projected pixel spacing).
  readonly xScale = computed<ChartScale>(() =>
    linearScale(this.#effectiveXDomain(), [
      this.#padLeft(),
      this.plotWidth() - this.#padRight(),
    ]),
  );
  // Range is flipped (high px → low px) so larger y-values sit higher up the plot.
  readonly yScale = computed<ChartScale>(() =>
    linearScale(this.#effectiveYDomain(), [
      this.plotHeight() - this.#padBottom(),
      this.#padTop(),
    ]),
  );

  // --- Internal rendering state ---

  // When zoomable, ticks are pinned to fixed DATA-space multiples of a "nice"
  // step (generateAlignedTicks) rather than evenly dividing the *current*
  // window — the latter re-lands every tick on the same pixel position the
  // instant the window shifts (numbers change, gridlines visually don't),
  // which is why a pan used to look like it was translating around a fixed
  // center instead of tracking the finger. Anchoring to fixed data values
  // makes every gridline slide across the screen exactly like the content it
  // labels. The array length still depends only on `tickCount` (never the
  // window), so the gridline/label `@for` never adds or removes nodes
  // mid-gesture — mutating the element tree inside a Lynx gesture worklet can
  // crash natively. A non-zoomable chart keeps its original behavior exactly
  // (explicit ticks, else evenly generated over the full domain).
  readonly #resolvedYTicks = computed(() =>
    this.zoomable()
      ? generateAlignedTicks(this.#effectiveYDomain(), this.tickCount())
      : (this.yTicks() ?? generateTicks(this.yDomain(), this.tickCount())),
  );
  readonly #resolvedXTicks = computed(() =>
    this.zoomable()
      ? generateAlignedTicks(this.#effectiveXDomain(), this.tickCount())
      : (this.xTicks() ?? generateTicks(this.xDomain(), this.tickCount())),
  );

  protected readonly containerClass = computed(() => cn(this.userClass()));

  // `flex-shrink: 0` stops a narrow parent squeezing the chart below its
  // explicit pixel width (Lynx lets flex items shrink past their content).
  //
  // Deliberately NOT `overflow: hidden` here. Tick labels are positioned to
  // STRADDLE the plot edges on purpose — the top y-label is centered on the top
  // gridline, so its text box overhangs the container's top by half the font
  // height (LABEL_FONT_HALF); the last x-label overhangs the right edge by half
  // its width. A container clip would slice those legitimate edge labels in
  // half (reported: "the top 100 gets cut in half at 1:1"). The only labels
  // that actually need suppressing are a zoomable chart's out-of-window buffer
  // ticks, and those are hidden individually by value in `yLabels`/`xLabels`
  // (see `#labelVisibility`) — precise enough to drop the strays while letting
  // every in-range label render in full. Gridlines still clip correctly: they
  // live inside the plot view, which keeps its own `overflow: hidden`.
  protected readonly containerStyle = computed(
    () =>
      `position: relative; width: ${px(this.width())}; height: ${px(this.height())}; flex-shrink: 0;`,
  );

  protected readonly plotStyle = computed(
    () =>
      // `overflow: hidden` clips zoomed/panned marks — and the gridlines, which
      // are also children of this view — to the plot rectangle. The axis labels
      // live in the container (siblings of this plot view), so they are NOT
      // clipped here; out-of-window buffer labels are hidden individually
      // instead (see `#labelVisibility`). Harmless at rest — every series
      // already draws inside the plot bounds.
      `position: absolute; left: ${px(this.#yGutter())}; top: 0px; width: ${px(this.plotWidth())}; height: ${px(this.plotHeight())}; overflow: hidden;`,
  );

  /**
   * A zoomable chart emits tick VALUES just past each edge of the visible
   * window (ALIGNED_TICK_BUFFER) so the grid stays covered mid-pan without the
   * element count ever changing. Their gridlines are clipped by the plot's own
   * `overflow: hidden`, but their labels live outside the plot — so we hide the
   * strays here. Testing by VALUE (is the tick outside the visible domain?)
   * rather than by pixel keeps this independent of axis padding and guarantees
   * a legitimate edge label (value exactly on the domain bound) is never caught
   * by float drift. Returns a style fragment appended to the label; `visibility`
   * keeps the element in the layout (fixed count) and is a pure paint toggle, so
   * it is safe to update from a gesture-driven signal write (no tree mutation).
   *
   * Only zoomable charts generate buffer ticks, so this is a no-op otherwise —
   * gated on `zoomable()` so a non-zoomable chart's labels (including any
   * explicit `xTicks`/`yTicks` a caller placed outside the domain on purpose)
   * are never touched, byte-for-byte matching the pre-pan/zoom behavior.
   */
  #labelVisibility(value: number, domain: ChartDomain): string {
    if (!this.zoomable()) return '';
    return isValueOutsideDomain(value, domain) ? ' visibility: hidden;' : '';
  }

  // Horizontal gridlines: full-width rules at each y tick's pixel height. The
  // bottom-most in-window line is nudged up by its thickness so the plot's
  // `overflow: hidden` doesn't clip it (see {@link gridlineOffset}).
  protected readonly gridlines = computed(() => {
    const scale = this.yScale();
    const domain = this.#effectiveYDomain();
    const extent = this.plotHeight();
    return this.#resolvedYTicks().map((value) => ({
      style: `position: absolute; left: 0px; top: ${px(gridlineOffset(value, scale(value), domain, extent))}; width: 100%; height: ${GRIDLINE_THICKNESS}px;`,
    }));
  });

  // Vertical gridlines: full-height rules at each x tick's pixel position. The
  // right-most in-window line is nudged left by its thickness for the same
  // clip reason as the horizontal ones above.
  protected readonly verticalGridlines = computed(() => {
    const scale = this.xScale();
    const domain = this.#effectiveXDomain();
    const extent = this.plotWidth();
    return this.#resolvedXTicks().map((value) => ({
      style: `position: absolute; top: 0px; left: ${px(gridlineOffset(value, scale(value), domain, extent))}; width: ${GRIDLINE_THICKNESS}px; height: 100%;`,
    }));
  });

  protected readonly yLabels = computed(() => {
    const scale = this.yScale();
    const format = this.yTickFormat();
    const domain = this.#effectiveYDomain();
    // A y-title pushes the tick labels right, past its reserved strip.
    const left = this.yAxisLabel() ? Y_AXIS_LABEL_SPACE : 0;
    const width = this.yAxisWidth() - LABEL_GUTTER_GAP;
    return this.#resolvedYTicks().map((value) => ({
      text: format(value),
      style: `position: absolute; left: ${px(left)}; top: ${px(scale(value) - LABEL_FONT_HALF)}; width: ${px(width)};${this.#labelVisibility(value, domain)}`,
    }));
  });

  protected readonly xLabels = computed(() => {
    const scale = this.xScale();
    const format = this.xTickFormat();
    const domain = this.#effectiveXDomain();
    const gutter = this.#yGutter();
    const top = this.plotHeight() + X_LABEL_GAP;
    return this.#resolvedXTicks().map((value) => ({
      text: format(value),
      style: `position: absolute; top: ${px(top)}; left: ${px(gutter + scale(value) - X_LABEL_WIDTH / 2)}; width: ${px(X_LABEL_WIDTH)};${this.#labelVisibility(value, domain)}`,
    }));
  });

  // Y-title: a horizontal text box `plotHeight` wide, rotated -90° about its
  // center so it runs vertically. Rotation is visual only (it doesn't change the
  // layout box), so we position the *unrotated* box centered on the reserved left
  // strip and the plot's mid-height; after the turn it spans the full plot height.
  protected readonly yAxisLabelStyle = computed(() => {
    const h = this.plotHeight();
    const centerX = Y_AXIS_LABEL_SPACE / 2;
    const centerY = h / 2;
    const left = centerX - h / 2;
    const top = centerY - AXIS_LABEL_LINE_HEIGHT / 2;
    return (
      `position: absolute; left: ${px(left)}; top: ${px(top)}; ` +
      `width: ${px(h)}; height: ${px(AXIS_LABEL_LINE_HEIGHT)}; ` +
      `transform-origin: center; transform: rotate(-90deg);`
    );
  });

  // X-title: centered across the plot, in the band below the x tick labels.
  protected readonly xAxisLabelStyle = computed(
    () =>
      `position: absolute; left: ${px(this.#yGutter())}; top: ${px(this.plotHeight() + this.xAxisHeight())}; width: ${px(this.plotWidth())};`,
  );

  // The control cluster sits just inside the container's top-right corner, over
  // the plot. `CONTROL_INSET` = button width (28px) + a 6px margin.
  protected readonly zoomControlsStyle = computed(
    () => `position: absolute; top: 6px; left: ${px(this.width() - 34)};`,
  );

  // ---------------------------------------------------------------------------
  // Pan / zoom interaction
  //
  // A 1-finger drag pans and a 2-finger pinch zooms. `maxPointers(1)` on the pan
  // keeps it from firing during a pinch, so the two never fight for the touch.
  // Both gestures snapshot the visible window at their *start* and derive the new
  // window from the gesture's cumulative value (translation / scale), so there is
  // no per-frame drift. Callbacks only ever write the view signals — that
  // restyles existing nodes (the tick count is fixed while zoomable), never
  // mutates the element tree, which is unsafe inside a Lynx gesture worklet.
  // ---------------------------------------------------------------------------

  // Visible window captured at the start of the active pan/pinch (null between
  // gestures). Plain fields, not signals — they seed the math, nothing renders
  // from them directly.
  #panStartX: ChartDomain | null = null;
  #panStartY: ChartDomain | null = null;
  #pinchStartX: ChartDomain | null = null;
  #pinchStartY: ChartDomain | null = null;
  // Data value under the pinch focal point, held fixed on screen as the zoom runs.
  #pinchFocalX = 0;
  #pinchFocalY = 0;

  readonly #pan = new PanGesture()
    .maxPointers(1)
    // Registering onBegin is REQUIRED, not decorative. On BOTH iOS and Android the
    // native pan handler gates onStart *and* onEnd behind onBegin having fired
    // (`!_isInvokedBegin` / `!mIsInvokedBegin` early-return in
    // LynxPanGestureHandler.m / PanGestureHandler.java), and onBegin itself
    // no-ops unless a JS onBegin callback was registered (the enable flag defaults
    // off). Wire only onStart/onUpdate/onEnd and, on-device, onStart/onEnd NEVER
    // fire — so the start-of-gesture window snapshot below is never taken, #onPan
    // re-reads the *current* (already-moved) window every frame, and the pan
    // compounds into a runaway slide instead of tracking the finger 1:1 (the
    // reported "doesn't move the same distance / anchored to the middle" bug).
    // onUpdate has no such gate, which is why the pan fired at all but drifted.
    // Snapshotting here at touch-down also anchors the window at the exact zero
    // point of translationX — mapGestureEvent anchors its own origin on onBegin —
    // so the two stay in lockstep for precise 1:1 panning.
    .onBegin(() => {
      // Unconditional: marks a fresh gesture start. Overwrites any stale snapshot
      // left behind if a previous gesture's onEnd was dropped (e.g. a cancel path).
      this.#panStartX = this.#effectiveXDomain();
      this.#panStartY = this.#effectiveYDomain();
    })
    // Fallback anchor for any platform that fires onStart without onBegin; guarded
    // so it keeps the earlier onBegin snapshot when both fire (nothing has panned
    // in between, so the value is identical either way).
    .onStart(() => {
      this.#panStartX ??= this.#effectiveXDomain();
      this.#panStartY ??= this.#effectiveYDomain();
    })
    .onUpdate((event) => this.#onPan(event))
    .onEnd(() => {
      this.#panStartX = null;
      this.#panStartY = null;
    });

  readonly #pinch = new PinchGesture()
    // Same begin-gating as pan (see above) — register onBegin so onStart can fire.
    // NOTE: Lynx's new-gesture system currently ships NO native pinch handler on
    // ANY platform (iOS/Android/Harmony all omit it from convertToGestureHandler),
    // so pinch never fires on-device today; zoom is driven by drag-to-pan and the
    // +/−/1:1 controls. This wiring is kept correct so pinch-to-zoom lights up the
    // moment a Lynx runtime adds pinch support.
    .onBegin(() => {
      // Intentionally empty: only needed to flip the native onBegin-enabled flag
      // so onStart is allowed to fire. The real focal snapshot happens in onStart.
    })
    .onStart((event) => this.#onPinchStart(event))
    .onUpdate((event) => this.#onPinch(event));

  // Bound on the plot view when `zoomable()` is true. Pan and pinch recognize
  // simultaneously; `maxPointers(1)` keeps them from actually overlapping.
  protected readonly interactionGesture = Gesture.Simultaneous(
    this.#pan,
    this.#pinch,
  );

  // A stable empty gesture list bound when NOT zoomable. The directive treats an
  // empty array as "no gestures" (it detaches), and sharing one reference keeps
  // the binding from churning ngOnChanges every change detection (a fresh `[]`
  // literal would). Using this instead of `null` also satisfies the directive's
  // non-nullable GestureInput type.
  protected readonly noGesture: never[] = [];

  #onPan(event: PanGestureEvent): void {
    // Defensive anchor: onBegin/onStart normally snapshot the start window, but if
    // a platform ever delivered onUpdate without either, anchor on this first
    // update and hold it (the `??=` won't overwrite on later frames). Without a
    // fixed anchor the window would be re-read every frame and the pan would
    // compound — the exact failure the onBegin registration above prevents.
    this.#panStartX ??= this.#effectiveXDomain();
    this.#panStartY ??= this.#effectiveYDomain();
    const axes = this.zoomAxes();
    if (axes === 'x' || axes === 'xy') {
      const start = this.#panStartX ?? this.#effectiveXDomain();
      const rangePx = this.plotWidth() - this.#padLeft() - this.#padRight();
      const dataPerPx = rangePx !== 0 ? (start[1] - start[0]) / rangePx : 0;
      // Dragging right (translationX > 0) reveals earlier (lower) x, so the
      // window slides toward lower values.
      this.#setViewX(
        panWindow(this.xDomain(), start, -event.translationX * dataPerPx),
      );
    }
    if (axes === 'y' || axes === 'xy') {
      const start = this.#panStartY ?? this.#effectiveYDomain();
      const rangePx = this.plotHeight() - this.#padTop() - this.#padBottom();
      const dataPerPx = rangePx !== 0 ? (start[1] - start[0]) / rangePx : 0;
      // The y-scale is flipped (screen y grows downward), so dragging DOWN
      // (translationY > 0) reveals higher values → window slides up.
      this.#setViewY(
        panWindow(this.yDomain(), start, event.translationY * dataPerPx),
      );
    }
  }

  #onPinchStart(event: PinchGestureEvent): void {
    const startX = this.#effectiveXDomain();
    const startY = this.#effectiveYDomain();
    this.#pinchStartX = startX;
    this.#pinchStartY = startY;
    // The focal point is element-relative (to the plot view) so it is already in
    // plot-local pixels; fall back to the plot center if the native payload omits
    // it. Invert through the start scale to get the data value to pin.
    const focalPx = event.params?.['x'];
    const focalPy = event.params?.['y'];
    const fx = typeof focalPx === 'number' ? focalPx : this.plotWidth() / 2;
    const fy = typeof focalPy === 'number' ? focalPy : this.plotHeight() / 2;
    this.#pinchFocalX = invertLinear(
      startX,
      [this.#padLeft(), this.plotWidth() - this.#padRight()],
      fx,
    );
    this.#pinchFocalY = invertLinear(
      startY,
      [this.plotHeight() - this.#padBottom(), this.#padTop()],
      fy,
    );
  }

  #onPinch(event: PinchGestureEvent): void {
    const factor = event.scale || 1;
    const axes = this.zoomAxes();
    if (axes === 'x' || axes === 'xy') {
      const start = this.#pinchStartX ?? this.#effectiveXDomain();
      this.#setViewX(
        zoomWindow(
          this.xDomain(),
          start,
          factor,
          this.#pinchFocalX,
          this.maxZoom(),
          this.minZoom(),
        ),
      );
    }
    if (axes === 'y' || axes === 'xy') {
      const start = this.#pinchStartY ?? this.#effectiveYDomain();
      this.#setViewY(
        zoomWindow(
          this.yDomain(),
          start,
          factor,
          this.#pinchFocalY,
          this.maxZoom(),
          this.minZoom(),
        ),
      );
    }
  }

  /**
   * Write a new visible window, collapsing it back to `null` (rest) when it spans
   * essentially the whole domain, so a fully zoomed-out chart reverts to its base
   * tick behavior.
   */
  #setViewX(window: ChartDomain): void {
    this.#viewXDomain.set(
      this.#isFullSpan(window, this.xDomain()) ? null : window,
    );
  }
  #setViewY(window: ChartDomain): void {
    this.#viewYDomain.set(
      this.#isFullSpan(window, this.yDomain()) ? null : window,
    );
  }
  #isFullSpan(window: ChartDomain, base: ChartDomain): boolean {
    const baseSpan = base[1] - base[0];
    if (baseSpan === 0) return true;
    return window[1] - window[0] >= baseSpan * (1 - 1e-6);
  }

  // --- Public zoom API (drives the controls; also callable via a template ref) ---

  /**
   * Zoom in by `zoomStep`, centered on the plot.
   */
  zoomIn(): void {
    this.#zoomByControls(this.zoomStep());
  }
  /**
   * Zoom out by `zoomStep`, centered on the plot.
   */
  zoomOut(): void {
    this.#zoomByControls(1 / this.zoomStep());
  }
  /**
   * Reset to the fully zoomed-out view.
   */
  resetZoom(): void {
    this.#viewXDomain.set(null);
    this.#viewYDomain.set(null);
  }

  #zoomByControls(factor: number): void {
    const axes = this.zoomAxes();
    if (axes === 'x' || axes === 'xy') {
      const current = this.#effectiveXDomain();
      const focal = (current[0] + current[1]) / 2;
      this.#setViewX(
        zoomWindow(
          this.xDomain(),
          current,
          factor,
          focal,
          this.maxZoom(),
          this.minZoom(),
        ),
      );
    }
    if (axes === 'y' || axes === 'xy') {
      const current = this.#effectiveYDomain();
      const focal = (current[0] + current[1]) / 2;
      this.#setViewY(
        zoomWindow(
          this.yDomain(),
          current,
          factor,
          focal,
          this.maxZoom(),
          this.minZoom(),
        ),
      );
    }
  }
}

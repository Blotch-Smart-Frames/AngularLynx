import {
  Directive,
  booleanAttribute,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import type {
  ChartPoint,
  ChartPositionScaleOptions,
} from '@tanstack/charts/types';

import { cn } from '../../utils/cn';
import { UiChart } from './chart';
import type { ChartColorSchemeOption } from './chart-theme';
import type { ChartZoomAxes } from './chart-zoom';

/**
 * Shared pieces of the chart presets (`<ui-line-chart>`, `<ui-bar-chart>`, …).
 * Each preset is a thin component that turns its inputs into a TanStack
 * definition for `<ui-chart>`; this file holds the axis handling and the inputs
 * they all share, so every preset behaves the same way.
 */

/** A point in x/y data space, the datum the line, area and scatter presets plot. */
export type XYDatum = {
  readonly x: number;
  readonly y: number;
};

/**
 * Inner inset per side, as a **fraction** (`0`–`1`) of the plot's width or
 * height, so the first and last marks don't sit on the frame. Fractions keep
 * the inset proportional as the chart resizes. Omitted sides default to `0`.
 */
export type ChartPadding = {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
};

/** The axis, grid and tooltip options every cartesian preset takes. */
export type CartesianPresetOptions = {
  readonly tickCount?: number;
  readonly showGrid?: boolean;
  readonly showXGrid?: boolean;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly padding?: ChartPadding;
  readonly xMin?: number;
  readonly xMax?: number;
  readonly yMin?: number;
  readonly yMax?: number;
  readonly xTickFormat?: (value: number) => string;
  readonly yTickFormat?: (value: number) => string;
  /** `false` turns the tooltip off. */
  readonly tooltip?: boolean;
};

/**
 * The x and y axes for a preset's data, from the shared options: `x` and `y`
 * are the values each axis fits, `xMargin` widens x by data units (half a bar),
 * `yInclude` keeps values like a baseline in view.
 */
export const presetAxes = (
  options: CartesianPresetOptions,
  data: {
    readonly x: readonly number[];
    readonly y: readonly number[];
    readonly xMargin?: number;
    readonly yInclude?: readonly number[];
  },
) => {
  const { tickCount = 5, padding = {} } = options;
  return {
    x: linearAxis({
      values: data.x,
      min: options.xMin,
      max: options.xMax,
      margin: data.xMargin,
      tickCount,
      padding: [padding.left ?? 0, padding.right ?? 0],
      format: options.xTickFormat,
      label: options.xAxisLabel,
      grid: options.showXGrid ?? false,
    }),
    y: linearAxis({
      values: data.y,
      include: data.yInclude,
      min: options.yMin,
      max: options.yMax,
      tickCount,
      padding: [padding.bottom ?? 0, padding.top ?? 0],
      format: options.yTickFormat,
      label: options.yAxisLabel,
      grid: options.showGrid ?? true,
    }),
  };
};

export type LinearAxisOptions = {
  /** Data values on this axis, to fit the domain to. */
  readonly values: readonly number[];
  /** Fixed ends; a missing end fits the data. */
  readonly min?: number;
  readonly max?: number;
  /** Values that must stay in view, such as an area's baseline. */
  readonly include?: readonly number[];
  readonly tickCount: number;
  /** Inset at the low and high end, as fractions of the plot (see {@link ChartPadding}). */
  readonly padding?: readonly [number, number];
  /** Extra data units added beyond each end, e.g. half a bar so the edge bars fit. */
  readonly margin?: number;
  readonly format?: (value: number) => string;
  readonly label?: string;
  readonly grid: boolean;
};

/**
 * A linear axis config: the domain fits the data (and `include`), is rounded
 * out to nice tick values unless both ends are fixed, then widened by `margin`
 * and `padding`. Flat or empty data gets a span around the value so the marks
 * sit mid-plot instead of collapsing onto one edge.
 *
 * The domain is computed here, not left to TanStack's inference, because
 * padding has to apply after rounding, and a zoomable axis needs a configured
 * scale to carry its viewport.
 */
export const linearAxis = (
  options: LinearAxisOptions,
): ChartPositionScaleOptions<number> => {
  const values = [...options.values, ...(options.include ?? [])].filter(
    Number.isFinite,
  );
  let lo = options.min ?? (values.length ? Math.min(...values) : 0);
  let hi = options.max ?? (values.length ? Math.max(...values) : 1);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    lo -= pad;
    hi += pad;
  }
  if (lo > hi) [lo, hi] = [hi, lo];
  if (options.min === undefined || options.max === undefined) {
    const nice = scaleLinear()
      .domain([lo, hi])
      .nice(options.tickCount)
      .domain();
    lo = options.min ?? nice[0];
    hi = options.max ?? nice[1];
  }
  const margin = options.margin ?? 0;
  lo -= margin;
  hi += margin;
  const [padLo, padHi] = options.padding ?? [0, 0];
  const keep = 1 - padLo - padHi;
  if ((padLo || padHi) && keep > 0) {
    const span = (hi - lo) / keep;
    lo -= padLo * span;
    hi = lo + span;
  }
  return {
    scale: scaleLinear().domain([lo, hi]),
    grid: options.grid,
    axis: {
      label: options.label || undefined,
      ticks: { count: options.tickCount, format: options.format },
    },
  };
};

/** Smallest gap between neighboring values, `1` for fewer than two. */
export const minSpacing = (values: readonly number[]): number => {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let spacing = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    spacing = Math.min(spacing, sorted[i]! - sorted[i - 1]!);
  }
  return Number.isFinite(spacing) && spacing > 0 ? spacing : 1;
};

/**
 * `UiChart`, for `viewChild()`. A call rather than the class itself: for a
 * class, Angular's test build keeps an arrow function that nothing calls,
 * which an app's coverage report would show as uncovered.
 */
const chartType = () => UiChart;

/**
 * The inputs and zoom API every cartesian preset shares. A preset extends this
 * and adds its own data and mark inputs, and renders `<ui-chart #chart>`
 * with the shared bindings.
 *
 * A preset's host is the chart's box in the page, and takes the app's
 * classes; the chart inside fills its width, at the preset's `height`.
 * Angular gives a component's host every static attribute the app writes on
 * it, so a class on `<ui-line-chart>` lands on the preset's host whatever the
 * preset does with its `class` input: passed on to the chart as well, a
 * margin applied twice, and a width class sized the chart a second time
 * inside the first.
 */
@Directive({ host: { '[class]': 'hostClass()' } })
export abstract class UiCartesianPreset<TDatum> {
  /** Fixed width in px. Omit to fill the container. */
  readonly width = input<number>();
  readonly height = input(200);
  /** Target number of ticks per axis; the axis picks nice values near it. */
  readonly tickCount = input(5);
  /** Horizontal gridlines at the y ticks. */
  readonly showGrid = input(true, { transform: booleanAttribute });
  /** Vertical gridlines at the x ticks. */
  readonly showXGrid = input(false, { transform: booleanAttribute });
  readonly xAxisLabel = input('');
  readonly yAxisLabel = input('');
  readonly padding = input<ChartPadding>({});
  readonly xMin = input<number>();
  readonly xMax = input<number>();
  readonly yMin = input<number>();
  readonly yMax = input<number>();
  readonly xTickFormat = input<(value: number) => string>();
  readonly yTickFormat = input<(value: number) => string>();
  /** Shows a tooltip for the touched point; a tap pins it. */
  readonly tooltip = input(true, { transform: booleanAttribute });
  /** What a screen reader announces for the chart. */
  readonly label = input('Chart');
  /** Light, dark or `'system'` colors; the chart theme's setting when unset. */
  readonly colorScheme = input<Exclude<ChartColorSchemeOption, Function>>();
  readonly zoomable = input(false, { transform: booleanAttribute });
  readonly zoomAxes = input<ChartZoomAxes>('xy');
  readonly showZoomControls = input(true, { transform: booleanAttribute });
  readonly minZoom = input(1);
  readonly maxZoom = input(8);
  readonly zoomStep = input(1.4);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly chart = viewChild.required(chartType());

  // Like the chart's box: as wide as its parent, and not squeezed by a column.
  protected readonly hostClass = computed(() =>
    cn('w-full flex-shrink-0', this.userClass()),
  );

  /**
   * The shared inputs, as the options every preset's definition takes.
   */
  protected commonOptions(): CartesianPresetOptions {
    return {
      tickCount: this.tickCount(),
      showGrid: this.showGrid(),
      showXGrid: this.showXGrid(),
      xAxisLabel: this.xAxisLabel(),
      yAxisLabel: this.yAxisLabel(),
      padding: this.padding(),
      xMin: this.xMin(),
      xMax: this.xMax(),
      yMin: this.yMin(),
      yMax: this.yMax(),
      xTickFormat: this.xTickFormat(),
      yTickFormat: this.yTickFormat(),
      tooltip: this.tooltip(),
    };
  }

  /**
   * The tapped datum, unwrapped from TanStack's point.
   */
  protected datumOf(point: ChartPoint | null): TDatum | null {
    return point ? (point.datum as TDatum) : null;
  }

  zoomIn(): void {
    this.chart().zoomIn();
  }

  zoomOut(): void {
    this.chart().zoomOut();
  }

  resetZoom(): void {
    this.chart().resetZoom();
  }
}

/** The `<ui-chart>` bindings a preset passes straight through. */
export const PRESET_CHART_BINDINGS = `
  [width]="width()"
  [height]="height()"
  [label]="label()"
  [colorScheme]="colorScheme()"
  [zoomable]="zoomable()"
  [zoomAxes]="zoomAxes()"
  [showZoomControls]="showZoomControls()"
  [minZoom]="minZoom()"
  [maxZoom]="maxZoom()"
  [zoomStep]="zoomStep()"
`;

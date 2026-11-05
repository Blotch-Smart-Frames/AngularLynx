import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import { barY, defineChart, rect } from '@tanstack/charts/universal';
import { scaleBand } from '@tanstack/charts/scales/band';
import type { ChartPoint } from '@tanstack/charts/types';

import { UiChart, tooltip } from '../chart/chart';
import {
  type CartesianPresetOptions,
  PRESET_CHART_BINDINGS,
  UiCartesianPreset,
  minSpacing,
  presetAxes,
} from '../chart/chart-presets';

/** One bar: a category (`'Mon'`) or a number on a continuous x axis. */
export type BarDatum = {
  readonly x: number | string;
  readonly y: number;
};

export type BarChartOptions = {
  readonly data: readonly BarDatum[];
  /** Any CSS color; theme tokens like `var(--primary)` follow dark mode. */
  readonly color?: string;
  /** One color per bar, cycling; overrides `color` when not empty. */
  readonly colors?: readonly string[];
  /** Bar width as a fraction of the space each bar has, `0`–`1`. */
  readonly barWidthRatio?: number;
  /** The value bars grow from; negative values grow down from it. */
  readonly baseline?: number;
  /** Corner radius in px. */
  readonly radius?: number;
} & CartesianPresetOptions;

/**
 * The definition `<ui-bar-chart>` renders.
 *
 * With category labels (any string `x`) the bars sit on a band scale. With
 * numbers they sit on a linear axis at their values, `barWidthRatio` of the
 * smallest gap wide, so a sparse series keeps its spacing and the chart can
 * pan and zoom along x.
 */
export const barChartDefinition = (options: BarChartOptions) => {
  const {
    data,
    color = 'var(--primary)',
    colors = [],
    barWidthRatio = 0.7,
    baseline = 0,
    radius = 0,
  } = options;
  const ratio = Math.min(1, Math.max(0, barWidthRatio));
  const categorical = data.some((d) => typeof d.x === 'string');
  const xs = categorical ? [] : data.map((d) => d.x as number);
  const spacing = minSpacing(xs);
  const axes = presetAxes(options, {
    x: xs,
    y: data.map((d) => d.y),
    yInclude: [baseline],
    // Half a slot of room either side so the edge bars fit inside the plot.
    xMargin: spacing / 2,
  });
  const tooltipOption = options.tooltip === false ? false : tooltip;

  if (categorical) {
    return defineChart({
      marks: [
        barY(data, {
          x: (d) => String(d.x),
          y: 'y',
          y1: baseline,
          fill: colors.length
            ? (_d, { index }) => colors[index % colors.length]!
            : color,
          radius,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand().padding(1 - ratio),
          grid: options.showXGrid ?? false,
          axis: { label: options.xAxisLabel || undefined },
        },
        y: axes.y,
      },
      tooltip: tooltipOption,
    });
  }

  const half = (ratio * spacing) / 2;
  return defineChart({
    marks: [
      rect(data, {
        x1: (d) => (d.x as number) - half,
        x2: (d) => (d.x as number) + half,
        y1: () => baseline,
        y2: 'y',
        // rect's fill is a single color, so per-bar colors go through the
        // color scale, keyed by bar index.
        ...(colors.length
          ? { color: (_d: BarDatum, { index }: { index: number }) => index }
          : { fill: color }),
        radius,
      }),
    ],
    scales: axes,
    ...(colors.length
      ? {
          color: {
            domain: data.map((_d, index) => index),
            range: data.map((_d, index) => colors[index % colors.length]!),
          },
        }
      : {}),
    tooltip: tooltipOption,
  });
};

/**
 * A bar chart for one series. For grouped or stacked bars, horizontal bars or
 * a line over the bars, build a definition with `barY`/`barX` and render it
 * with `<ui-chart>`.
 *
 * ```html
 * <ui-bar-chart [data]="sales" [radius]="4" />
 * ```
 */
@Component({
  selector: 'ui-bar-chart',
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
export class UiBarChart extends UiCartesianPreset<BarDatum> {
  readonly data = input.required<readonly BarDatum[]>();
  readonly color = input('var(--primary)');
  readonly colors = input<readonly string[]>([]);
  readonly barWidthRatio = input(0.7);
  readonly baseline = input(0);
  readonly radius = input(0);

  /** The tapped bar's datum. */
  readonly barTap = output<BarDatum>();

  protected readonly definition = computed(() =>
    barChartDefinition({
      ...this.commonOptions(),
      data: this.data(),
      color: this.color(),
      colors: this.colors(),
      barWidthRatio: this.barWidthRatio(),
      baseline: this.baseline(),
      radius: this.radius(),
    }),
  );

  protected onSelect(point: ChartPoint | null): void {
    const datum = this.datumOf(point);
    if (datum) this.barTap.emit(datum);
  }
}

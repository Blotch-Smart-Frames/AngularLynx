import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import { defineChart, dot } from '@tanstack/charts/universal';
import type { ChartPoint } from '@tanstack/charts/types';

import { UiChart, tooltip } from '../chart/chart';
import {
  type CartesianPresetOptions,
  PRESET_CHART_BINDINGS,
  UiCartesianPreset,
  type XYDatum,
  presetAxes,
} from '../chart/chart-presets';

export type ScatterChartOptions = {
  readonly data: readonly XYDatum[];
  /** Any CSS color; theme tokens like `var(--primary)` follow dark mode. */
  readonly color?: string;
  /** One color per point, cycling; overrides `color` when not empty. */
  readonly colors?: readonly string[];
  /** Dot radius in px. */
  readonly radius?: number;
  /** One radius per point (a bubble chart); points past its end use `radius`. */
  readonly sizes?: readonly number[];
} & CartesianPresetOptions;

/**
 * Scatter plots inset every side by 4% unless told otherwise, so dots at the
 * extremes aren't cut in half by the frame.
 */
const SCATTER_INSET = 0.04;

/** The definition `<ui-scatter-chart>` renders. */
export const scatterChartDefinition = (options: ScatterChartOptions) => {
  const {
    data,
    color = 'var(--primary)',
    colors = [],
    radius = 4,
    sizes = [],
  } = options;
  const padding = options.padding ?? {};
  return defineChart({
    marks: [
      dot(data, {
        x: 'x',
        y: 'y',
        r: sizes.length ? (_d, { index }) => sizes[index] ?? radius : radius,
        // dot's fill is a single color, so per-point colors go through the
        // color scale, keyed by point index.
        ...(colors.length
          ? { color: (_d: XYDatum, { index }: { index: number }) => index }
          : { fill: color }),
      }),
    ],
    scales: presetAxes(
      {
        ...options,
        padding: {
          top: padding.top ?? SCATTER_INSET,
          right: padding.right ?? SCATTER_INSET,
          bottom: padding.bottom ?? SCATTER_INSET,
          left: padding.left ?? SCATTER_INSET,
        },
      },
      { x: data.map((d) => d.x), y: data.map((d) => d.y) },
    ),
    ...(colors.length
      ? {
          color: {
            domain: data.map((_d, index) => index),
            range: data.map((_d, index) => colors[index % colors.length]!),
          },
        }
      : {}),
    tooltip: options.tooltip === false ? false : tooltip,
  });
};

/**
 * A scatter plot, or a bubble chart with `sizes`. For a trend line or several
 * groups with a legend, build a definition with `dot` (and `linearRegressionY`)
 * and render it with `<ui-chart>`.
 *
 * ```html
 * <ui-scatter-chart [data]="heightWeight" xAxisLabel="Height" yAxisLabel="Weight" />
 * ```
 */
@Component({
  selector: 'ui-scatter-chart',
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
export class UiScatterChart extends UiCartesianPreset<XYDatum> {
  readonly data = input.required<readonly XYDatum[]>();
  readonly color = input('var(--primary)');
  readonly colors = input<readonly string[]>([]);
  readonly radius = input(4);
  readonly sizes = input<readonly number[]>([]);

  /** The tapped point's datum. */
  readonly pointTap = output<XYDatum>();

  protected readonly definition = computed(() =>
    scatterChartDefinition({
      ...this.commonOptions(),
      data: this.data(),
      color: this.color(),
      colors: this.colors(),
      radius: this.radius(),
      sizes: this.sizes(),
    }),
  );

  protected onSelect(point: ChartPoint | null): void {
    const datum = this.datumOf(point);
    if (datum) this.pointTap.emit(datum);
  }
}

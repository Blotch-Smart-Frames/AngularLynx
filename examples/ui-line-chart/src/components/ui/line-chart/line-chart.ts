import {
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { d3Curve, defineChart, dot, lineY } from '@tanstack/charts/universal';
import type { ChartMark, ChartPoint } from '@tanstack/charts/types';
import { curveMonotoneX } from 'd3-shape';

import { UiChart, tooltip } from '../chart/chart';
import {
  type CartesianPresetOptions,
  PRESET_CHART_BINDINGS,
  UiCartesianPreset,
  type XYDatum,
  presetAxes,
} from '../chart/chart-presets';

export type LineChartOptions = {
  readonly data: readonly XYDatum[];
  /** Any CSS color; theme tokens like `var(--primary)` follow dark mode. */
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly dotRadius?: number;
  readonly showDots?: boolean;
  /** Draws a monotone curve through the points instead of straight segments. */
  readonly smooth?: boolean;
} & CartesianPresetOptions;

/**
 * The definition `<ui-line-chart>` renders, for when you want to start from
 * the preset and add marks of your own:
 *
 * ```ts
 * const base = lineChartDefinition({ data });
 * const withTarget = defineChart({ ...base, marks: [...base.marks, ruleY([80])] });
 * ```
 */
export const lineChartDefinition = (options: LineChartOptions) => {
  const {
    data,
    color = 'var(--primary)',
    strokeWidth = 2,
    dotRadius = 3,
    showDots = true,
    smooth = false,
  } = options;
  const curve = smooth ? d3Curve(curveMonotoneX) : undefined;
  const marks: ChartMark<XYDatum, any, any, any, any, any, any>[] = [
    lineY(data, { x: 'x', y: 'y', stroke: color, strokeWidth, curve }),
  ];
  if (showDots && dotRadius > 0) {
    marks.push(dot(data, { x: 'x', y: 'y', r: dotRadius, fill: color }));
  }
  return defineChart({
    marks,
    scales: presetAxes(options, {
      x: data.map((d) => d.x),
      y: data.map((d) => d.y),
    }),
    tooltip: options.tooltip === false ? false : tooltip,
  });
};

/**
 * A single-series line chart. For several series, a reference line or any
 * other mark, build a definition and render it with `<ui-chart>`, starting
 * from {@link lineChartDefinition} if you like.
 *
 * ```html
 * <ui-line-chart [data]="revenue" [smooth]="true" yAxisLabel="Revenue" />
 * ```
 */
@Component({
  selector: 'ui-line-chart',
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
export class UiLineChart extends UiCartesianPreset<XYDatum> {
  readonly data = input.required<readonly XYDatum[]>();
  readonly color = input('var(--primary)');
  readonly strokeWidth = input(2);
  readonly dotRadius = input(3);
  readonly showDots = input(true, { transform: booleanAttribute });
  readonly smooth = input(false, { transform: booleanAttribute });

  /** The tapped point's datum. */
  readonly pointTap = output<XYDatum>();

  protected readonly definition = computed(() =>
    lineChartDefinition({
      ...this.commonOptions(),
      data: this.data(),
      color: this.color(),
      strokeWidth: this.strokeWidth(),
      dotRadius: this.dotRadius(),
      showDots: this.showDots(),
      smooth: this.smooth(),
    }),
  );

  protected onSelect(point: ChartPoint | null): void {
    const datum = this.datumOf(point);
    if (datum) this.pointTap.emit(datum);
  }
}

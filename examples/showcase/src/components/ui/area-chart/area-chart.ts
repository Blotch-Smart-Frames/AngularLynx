import {
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import {
  areaY,
  d3Curve,
  defineChart,
  dot,
  lineY,
} from '@tanstack/charts/universal';
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

export type AreaChartOptions = {
  readonly data: readonly XYDatum[];
  /** Any CSS color; theme tokens like `var(--primary)` follow dark mode. */
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly dotRadius?: number;
  readonly showDots?: boolean;
  /** Opacity of the fill under the line, `0`–`1`. */
  readonly fillOpacity?: number;
  /** The value the area fills to; it's always kept in view. */
  readonly baseline?: number;
  readonly smooth?: boolean;
} & CartesianPresetOptions;

/**
 * The definition `<ui-area-chart>` renders: a filled area down to the
 * baseline, the line on top, and optional dots. Values below the baseline fill
 * upward to it.
 */
export const areaChartDefinition = (options: AreaChartOptions) => {
  const {
    data,
    color = 'var(--primary)',
    strokeWidth = 2,
    dotRadius = 3,
    showDots = true,
    fillOpacity = 0.2,
    baseline = 0,
    smooth = false,
  } = options;
  const curve = smooth ? d3Curve(curveMonotoneX) : undefined;
  const marks: ChartMark<XYDatum, any, any, any, any, any, any>[] = [
    areaY(data, {
      x: 'x',
      y: 'y',
      y1: baseline,
      fill: color,
      fillOpacity,
      curve,
    }),
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
      yInclude: [baseline],
    }),
    tooltip: options.tooltip === false ? false : tooltip,
  });
};

/**
 * A single-series area chart. For stacked or several areas, build a
 * definition with `areaY` and render it with `<ui-chart>`.
 *
 * ```html
 * <ui-area-chart [data]="visitors" [smooth]="true" [fillOpacity]="0.3" />
 * ```
 */
@Component({
  selector: 'ui-area-chart',
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
export class UiAreaChart extends UiCartesianPreset<XYDatum> {
  readonly data = input.required<readonly XYDatum[]>();
  readonly color = input('var(--primary)');
  readonly strokeWidth = input(2);
  readonly dotRadius = input(3);
  readonly showDots = input(true, { transform: booleanAttribute });
  readonly fillOpacity = input(0.2);
  readonly baseline = input(0);
  readonly smooth = input(false, { transform: booleanAttribute });

  /** The tapped point's datum. */
  readonly pointTap = output<XYDatum>();

  protected readonly definition = computed(() =>
    areaChartDefinition({
      ...this.commonOptions(),
      data: this.data(),
      color: this.color(),
      strokeWidth: this.strokeWidth(),
      dotRadius: this.dotRadius(),
      showDots: this.showDots(),
      fillOpacity: this.fillOpacity(),
      baseline: this.baseline(),
      smooth: this.smooth(),
    }),
  );

  protected onSelect(point: ChartPoint | null): void {
    const datum = this.datumOf(point);
    if (datum) this.pointTap.emit(datum);
  }
}

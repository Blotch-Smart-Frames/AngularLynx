import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { areaY, defineChart, lineY } from '@tanstack/charts/universal';
import { UiAreaChart } from '../../components/ui/area-chart';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiChart, type XYDatum, tooltip } from '../../components/ui/chart';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Area Chart demo.
 *
 * An area chart is a line with the region down to a baseline filled in. The
 * `<ui-area-chart>` preset composes TanStack's `areaY` (the fill), `lineY` (the
 * edge) and `dot` marks; the multiple-series card composes the same marks by
 * hand on `<ui-chart>`, one area and one line per series.
 *
 * The charts fill the card's width and only set a height, so they fit any
 * screen without per-device pixel math.
 */
@Component({
  selector: 'app-area-chart-demo',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiIcon,
    UiAreaChart,
    UiChart,
  ],
  template: `
    <app-demo-screen
      heading="Area Chart"
      category="Components"
      description="A filled line chart preset built on TanStack Charts: a translucent area under the line, down to a baseline you choose."
    >
      <!-- ── Basic: single series via the preset ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-up" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass an array of points; the fill drops to y = 0 and the axes round
            themselves.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-area-chart
            [data]="revenue"
            [height]="180"
            label="Revenue by month"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Custom color, fill opacity and curve ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">
              Color and fill opacity
            </ui-card-title>
          </view>
          <ui-card-description>
            color sets the line, dots and fill; fillOpacity controls how solid
            the filled region reads, and smooth curves the edge.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-area-chart
            [data]="downloads"
            [height]="180"
            color="var(--chart-2)"
            [fillOpacity]="0.35"
            [smooth]="true"
            label="Downloads by month"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Negative values straddling the baseline (area-specific) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="minus" size="sm" />
            <ui-card-title class="text-lg">Negative values</ui-card-title>
          </view>
          <ui-card-description>
            The fill always reaches the baseline (0 here), so values below it
            fill upward to the zero line.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-area-chart
            [data]="delta"
            [height]="180"
            color="var(--chart-1)"
            [baseline]="0"
            label="Monthly change"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Multiple series: compose areaY + lineY on <ui-chart> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="menu" size="sm" />
            <ui-card-title class="text-lg">Multiple series</ui-card-title>
          </view>
          <ui-card-description>
            Compose an areaY and a lineY per series and render them with
            &lt;ui-chart&gt;. The translucent fills layer where they overlap.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="twoSeries"
            [height]="180"
            label="Revenue, this year and last year"
          />
          <!-- A hand-made legend: the swatch classes use the same --chart-*
               tokens as the marks, so both switch together in dark mode. -->
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-2.5 w-2.5 rounded-full bg-chart-1"></view>
              <text class="text-xs text-muted-foreground">This year</text>
            </view>
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-2.5 w-2.5 rounded-full bg-chart-2"></view>
              <text class="text-xs text-muted-foreground">Last year</text>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Interactive: tap a data point ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Tap a point</ui-card-title>
          </view>
          <ui-card-description>
            pointTap emits the &#123; x, y &#125; point nearest the tap.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-area-chart
            [data]="revenue"
            [height]="180"
            [dotRadius]="5"
            label="Revenue by month"
            (pointTap)="onPointTap($event)"
          />
          <view class="rounded-md bg-muted p-3 flex">
            <text class="text-xs text-muted-foreground">
              {{ tappedLabel() }}
            </text>
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class AreaChartDemo {
  // Month → value data. x is the month index; y is the metric.
  readonly revenue: readonly XYDatum[] = [
    { x: 1, y: 12 },
    { x: 2, y: 19 },
    { x: 3, y: 15 },
    { x: 4, y: 25 },
    { x: 5, y: 22 },
    { x: 6, y: 30 },
  ];

  readonly lastYear: readonly XYDatum[] = [
    { x: 1, y: 8 },
    { x: 2, y: 11 },
    { x: 3, y: 14 },
    { x: 4, y: 13 },
    { x: 5, y: 18 },
    { x: 6, y: 20 },
  ];

  readonly downloads: readonly XYDatum[] = [
    { x: 1, y: 40 },
    { x: 2, y: 33 },
    { x: 3, y: 52 },
    { x: 4, y: 48 },
    { x: 5, y: 61 },
    { x: 6, y: 75 },
  ];

  // A series that dips below zero, to show the fill straddling the baseline.
  readonly delta: readonly XYDatum[] = [
    { x: 1, y: -5 },
    { x: 2, y: 3 },
    { x: 3, y: -2 },
    { x: 4, y: 8 },
    { x: 5, y: 4 },
    { x: 6, y: -1 },
  ];

  /**
   * Two overlapping areas, each with its edge line on top (areas don't draw
   * one). `y1: 0` pins each fill to zero: without it, areaY stacks rows that
   * share an x, which would draw a stacked chart instead of two overlaid ones.
   *
   * The constant `z` names each series for the tooltip, and both marks of a
   * series share it, so `focus: 'group-x'` shows one row per year rather than
   * one per mark.
   */
  readonly twoSeries = defineChart({
    marks: [
      areaY(this.lastYear, {
        x: 'x',
        y: 'y',
        y1: 0,
        z: () => 'Last year',
        fill: 'var(--chart-2)',
        fillOpacity: 0.2,
      }),
      lineY(this.lastYear, {
        x: 'x',
        y: 'y',
        z: () => 'Last year',
        stroke: 'var(--chart-2)',
        strokeWidth: 2,
      }),
      areaY(this.revenue, {
        x: 'x',
        y: 'y',
        y1: 0,
        z: () => 'This year',
        fill: 'var(--chart-1)',
        fillOpacity: 0.2,
      }),
      lineY(this.revenue, {
        x: 'x',
        y: 'y',
        z: () => 'This year',
        stroke: 'var(--chart-1)',
        strokeWidth: 2,
      }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    focus: 'group-x',
    tooltip,
  });

  readonly #tapped = signal<XYDatum | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: month ${point.x}, value ${point.y}`
      : 'Tap any point on the chart above.';
  });

  protected onPointTap(point: XYDatum): void {
    this.#tapped.set(point);
  }
}

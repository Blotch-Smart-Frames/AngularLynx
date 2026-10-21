import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { defineChart, dot, lineY, ruleY } from '@tanstack/charts/universal';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiChart, type XYDatum, tooltip } from '../../components/ui/chart';
import { UiIcon } from '../../components/ui/icon';
import {
  UiLineChart,
  lineChartDefinition,
} from '../../components/ui/line-chart';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Line Chart demo.
 *
 * `<ui-line-chart>` is a preset: it turns its inputs into a TanStack Charts
 * definition and renders it with `<ui-chart>`. The first cards tune the preset;
 * the later ones show the two ways past it: compose marks yourself and render
 * them with `<ui-chart>` (multiple series), or start from the preset's own
 * definition via `lineChartDefinition()` and add marks (target line).
 *
 * The charts fill the card's width and only set a height, so they fit any
 * screen without per-device pixel math.
 */
@Component({
  selector: 'app-line-chart-demo',
  hostDirectives: [ScreenHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiIcon,
    UiChart,
    UiLineChart,
  ],
  template: `
    <app-demo-screen
      heading="Line Chart"
      category="Components"
      description="A line chart preset built on TanStack Charts. Touch a chart to read a value and tap to pin the tooltip; compose marks with ui-chart when the preset isn't enough."
    >
      <!-- ── Basic: single series via the preset ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass an array of &#123; x, y &#125; points; the preset picks rounded
            axis ranges for you.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-line-chart
            [data]="revenue"
            [height]="180"
            label="Revenue by month"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Custom color and thicker stroke ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">Color and thickness</ui-card-title>
          </view>
          <ui-card-description>
            color sets both the line and the dots, and takes theme tokens like
            var(--chart-2) that follow dark mode. strokeWidth and dotRadius tune
            the weight.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-line-chart
            [data]="downloads"
            [height]="180"
            color="var(--chart-2)"
            [strokeWidth]="3"
            [dotRadius]="4"
            label="Downloads by month"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Smooth curve and axis titles ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="activity" size="sm" />
            <ui-card-title class="text-lg">Smooth curve</ui-card-title>
          </view>
          <ui-card-description>
            smooth draws a monotone curve through the points instead of straight
            segments; xAxisLabel and yAxisLabel title the axes.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-line-chart
            [data]="revenue"
            [height]="180"
            [smooth]="true"
            [showDots]="false"
            xAxisLabel="Month"
            yAxisLabel="Revenue ($k)"
            label="Revenue by month, smoothed"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Multiple series: compose lineY marks on <ui-chart> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="menu" size="sm" />
            <ui-card-title class="text-lg">Multiple series</ui-card-title>
          </view>
          <ui-card-description>
            Past the preset, compose TanStack marks and render them with
            &lt;ui-chart&gt;: one lineY and dot per series on shared scales.
            focus: 'group-x' puts both years in the tooltip.
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

      <!-- ── Preset definition + an extra mark ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="target" size="sm" />
            <ui-card-title class="text-lg">Target line</ui-card-title>
          </view>
          <ui-card-description>
            Start from the preset with lineChartDefinition() and add marks of
            your own; here a dashed ruleY marks the target.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="withTarget"
            [height]="180"
            label="Revenue by month against a target of 25"
          />
          <view class="flex-row items-center gap-1.5 flex">
            <view class="h-0.5 w-3 rounded-full bg-chart-1"></view>
            <text class="text-xs text-muted-foreground">Target ($25k)</text>
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
          <ui-line-chart
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
export class LineChartDemo {
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

  /**
   * Two series, each a line plus its dots. The constant `z` names the series:
   * TanStack uses it as the tooltip row label, and `focus: 'group-x'` collects
   * one point per `z` at the touched month, so both years show together. The
   * scale factories fit their domains to every mark's values, so neither
   * series is clipped.
   */
  readonly twoSeries = defineChart({
    marks: [
      lineY(this.revenue, {
        x: 'x',
        y: 'y',
        z: () => 'This year',
        stroke: 'var(--chart-1)',
        strokeWidth: 2,
      }),
      dot(this.revenue, {
        x: 'x',
        y: 'y',
        z: () => 'This year',
        r: 3,
        fill: 'var(--chart-1)',
      }),
      lineY(this.lastYear, {
        x: 'x',
        y: 'y',
        z: () => 'Last year',
        stroke: 'var(--chart-2)',
        strokeWidth: 2,
      }),
      dot(this.lastYear, {
        x: 'x',
        y: 'y',
        z: () => 'Last year',
        r: 3,
        fill: 'var(--chart-2)',
      }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    focus: 'group-x',
    tooltip,
  });

  /**
   * The preset's definition with one more mark. A rule draws no data points,
   * so touching the chart still focuses only the revenue line. It sits inside
   * the preset's y range (10–30), which the preset fits to the data alone.
   */
  readonly withTarget = (() => {
    const base = lineChartDefinition({
      data: this.revenue,
      color: 'var(--primary)',
    });
    return defineChart({
      ...base,
      marks: [
        ...base.marks,
        ruleY([25], {
          stroke: 'var(--chart-1)',
          strokeOpacity: 1,
          strokeWidth: 1.5,
          strokeDasharray: '4 4',
        }),
      ],
    });
  })();

  readonly #tapped = signal<XYDatum | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: month ${point.x}, value ${point.y}`
      : 'Tap any point on the chart above.';
  });

  /**
   * A plain signal.set is safe from the native touch callback: it only updates
   * a <text> binding, not the element tree, and zoneless CD flushes it
   * asynchronously (unlike the @if toggles elsewhere that need setTimeout).
   */
  protected onPointTap(point: XYDatum): void {
    this.#tapped.set(point);
  }
}

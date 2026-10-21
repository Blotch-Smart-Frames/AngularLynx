import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { defineChart, lineY } from '@tanstack/charts/universal';
import { UiChart, tooltip } from '../components/ui/chart';
import { UiLineChart } from '../components/ui/line-chart';

type Point = {
  readonly x: number;
  readonly y: number;
};

// Month → value data. x is the month index; y is the metric.
const revenue: Point[] = [
  { x: 1, y: 12 },
  { x: 2, y: 19 },
  { x: 3, y: 15 },
  { x: 4, y: 25 },
  { x: 5, y: 22 },
  { x: 6, y: 30 },
];

const lastYear: Point[] = [
  { x: 1, y: 8 },
  { x: 2, y: 11 },
  { x: 3, y: 14 },
  { x: 4, y: 13 },
  { x: 5, y: 18 },
  { x: 6, y: 20 },
];

const downloads: Point[] = [
  { x: 1, y: 40 },
  { x: 2, y: 33 },
  { x: 3, y: 52 },
  { x: 4, y: 48 },
  { x: 5, y: 61 },
  { x: 6, y: 75 },
];

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiChart, UiLineChart],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Line Chart</text>
        <text class="text-sm text-muted-foreground">
          A line chart preset built on TanStack Charts. Touch a chart to see a
          point's values; tap to pin the tooltip.
        </text>

        <!-- Basic single-series chart -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Revenue (basic)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart [data]="revenue" [height]="180" label="Revenue" />
          </view>
        </view>

        <!-- Custom color + thicker stroke -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Custom color</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="downloads"
              [height]="180"
              color="var(--chart-2)"
              [strokeWidth]="3"
              [dotRadius]="4"
              label="Downloads"
            />
          </view>
        </view>

        <!-- Smooth (monotone-cubic) curve instead of straight segments -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Smooth curve</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="revenue"
              [height]="180"
              [smooth]="true"
              label="Revenue, smoothed"
            />
          </view>
        </view>

        <!-- Axis titles + vertical gridlines + inner padding -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Labeled axes &amp; grid
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="revenue"
              [height]="180"
              xAxisLabel="Month"
              yAxisLabel="Revenue ($k)"
              [showXGrid]="true"
              [padding]="{ left: 0.05, right: 0.05 }"
              label="Revenue by month"
            />
          </view>
        </view>

        <!-- Force the y-axis to start at zero instead of fitting the data -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Fixed y-axis (0…)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="revenue"
              [height]="180"
              [yMin]="0"
              label="Revenue from zero"
            />
          </view>
        </view>

        <!--
          Several series: past the preset, compose TanStack marks yourself and
          render the definition with <ui-chart>.
        -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Two series (ui-chart)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="twoSeries"
              [height]="180"
              label="Revenue, this year and last"
            />
          </view>
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
        </view>

        <!-- Interactive: tap a data point -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Tap a point</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="revenue"
              [height]="180"
              [dotRadius]="5"
              label="Revenue"
              (pointTap)="onPointTap($event)"
            />
          </view>
          <view class="rounded-md bg-muted p-3">
            <text class="text-xs text-muted-foreground">
              {{ tappedLabel() }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly revenue = revenue;
  readonly downloads = downloads;

  // Two lineY marks share the scales; each takes a palette color, which
  // follows dark mode like the rest of the theme.
  readonly twoSeries = defineChart({
    marks: [
      lineY(revenue, {
        x: 'x',
        y: 'y',
        stroke: 'var(--chart-1)',
        strokeWidth: 2,
      }),
      lineY(lastYear, {
        x: 'x',
        y: 'y',
        stroke: 'var(--chart-2)',
        strokeWidth: 2,
      }),
    ],
    scales: {
      x: { scale: scaleLinear().domain([1, 6]) },
      y: { scale: scaleLinear().domain([0, 40]), grid: true },
    },
    tooltip,
  });

  readonly #tapped = signal<Point | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: month ${point.x}, value ${point.y}`
      : 'Tap any point on the chart above.';
  });

  protected onPointTap(point: Point): void {
    this.#tapped.set(point);
  }
}

import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  defineChart,
  dot,
  linearRegressionY,
} from '@tanstack/charts/universal';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { UiChart, tooltip } from '../components/ui/chart';
import { UiScatterChart } from '../components/ui/scatter-chart';

type Point = {
  readonly x: number;
  readonly y: number;
};

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiChart, UiScatterChart],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Scatter Chart</text>
        <text class="text-sm text-muted-foreground">
          A scatter chart preset built on TanStack Charts, for points and
          bubbles. Touch a chart to see a point's values; tap to pin the
          tooltip.
        </text>

        <!-- Basic single-series chart via the convenience wrapper -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Measurements (basic)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-scatter-chart [data]="measurements" [height]="200" />
          </view>
        </view>

        <!-- Per-point categorical colors: two groups -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Two groups (colors)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-scatter-chart
              [data]="clusters"
              [height]="200"
              [colors]="clusterColors"
              [radius]="5"
            />
          </view>
        </view>

        <!-- Bubble chart: per-point sizes -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Bubble chart (sizes)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-scatter-chart
              [data]="measurements"
              [height]="200"
              [sizes]="bubbleSizes"
            />
          </view>
        </view>

        <!-- Axis titles + vertical gridlines -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Labeled axes &amp; grid
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-scatter-chart
              [data]="measurements"
              [height]="200"
              xAxisLabel="Dose"
              yAxisLabel="Response"
              [showXGrid]="true"
            />
          </view>
        </view>

        <!--
          Past the preset: compose TanStack marks yourself and render the
          definition with <ui-chart>. Here, the points plus a fitted trend line.
        -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Points with a trend line (ui-chart)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="withTrend"
              [height]="200"
              label="Measurements with a trend line"
            />
          </view>
        </view>

        <!-- Interactive: tap a point -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Tap a point</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-scatter-chart
              [data]="measurements"
              [height]="200"
              [radius]="6"
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
  // A positively-correlated cloud — dose vs response.
  readonly measurements: Point[] = [
    { x: 1, y: 3 },
    { x: 2, y: 4 },
    { x: 3, y: 4 },
    { x: 4, y: 6 },
    { x: 5, y: 5 },
    { x: 6, y: 8 },
    { x: 7, y: 7 },
    { x: 8, y: 10 },
    { x: 9, y: 9 },
    { x: 10, y: 12 },
  ];

  // Two visually-separate groups; the first five points are group A, the rest B.
  readonly clusters: Point[] = [
    { x: 1, y: 2 },
    { x: 2, y: 3 },
    { x: 1.5, y: 2.5 },
    { x: 2.5, y: 2 },
    { x: 1, y: 3 },
    { x: 7, y: 8 },
    { x: 8, y: 9 },
    { x: 7.5, y: 8.5 },
    { x: 8.5, y: 8 },
    { x: 7, y: 9 },
  ];

  // One color per point, indexed to group membership (blue = A, orange = B).
  // Data hues stay fixed across light/dark mode (they encode a group, not theme
  // chrome), so raw rgba() is the right call.
  readonly clusterColors = [
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
  ];

  // Per-point radii (px) — a bubble chart. Indexed 1:1 with `measurements`.
  readonly bubbleSizes = [4, 6, 5, 9, 7, 12, 8, 14, 10, 16];

  // The dots plus TanStack's least-squares regression line over the same
  // data. Declared after the data, which class fields initialize in order.
  readonly withTrend = defineChart({
    marks: [
      dot(this.measurements, { x: 'x', y: 'y', r: 4, fill: 'var(--primary)' }),
      linearRegressionY(this.measurements, {
        x: 'x',
        y: 'y',
        stroke: 'var(--chart-1)',
      }),
    ],
    scales: {
      x: { scale: scaleLinear().domain([0, 11]) },
      y: { scale: scaleLinear().domain([0, 14]), grid: true },
    },
    tooltip,
  });

  readonly #tapped = signal<Point | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: (${point.x}, ${point.y})`
      : 'Tap any point on the chart above.';
  });

  protected onPointTap(point: Point): void {
    this.#tapped.set(point);
  }
}

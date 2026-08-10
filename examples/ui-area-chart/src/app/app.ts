import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  type ChartPoint,
  UiCartesianChart,
} from '../components/ui/cartesian-chart';
import { UiAreaChart, UiAreaSeries } from '../components/ui/area-chart';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiAreaChart, UiCartesianChart, UiAreaSeries],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Area Chart</text>
        <text class="text-sm text-muted-foreground">
          A line chart with the region down to a baseline filled in — drawn from
          Lynx views only. It reuses the line series on top of a translucent
          fill, both on the same BaseCartesianChart.
        </text>

        <!-- Basic single-series area via the convenience wrapper -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Revenue (basic)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-area-chart [data]="revenue" [width]="280" [height]="180" />
          </view>
        </view>

        <!-- Custom color + denser fill -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Color and fill opacity
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-area-chart
              [data]="downloads"
              [width]="280"
              [height]="180"
              [color]="blue"
              [fillOpacity]="0.25"
            />
          </view>
        </view>

        <!-- Smooth (monotone-cubic) curve + fill instead of straight segments -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Smooth curve</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-area-chart
              [data]="revenue"
              [width]="280"
              [height]="180"
              [smooth]="true"
            />
          </view>
        </view>

        <!-- Negative values straddling the baseline (area-specific) -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Negative values (baseline 0)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-area-chart
              [data]="delta"
              [width]="280"
              [height]="180"
              [color]="green"
              [baseline]="0"
            />
          </view>
          <text class="text-xs text-muted-foreground">
            The fill hangs from the line down to y = 0, above and below it.
          </text>
        </view>

        <!-- Axis titles + vertical gridlines + inner padding -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Labeled axes &amp; grid
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-area-chart
              [data]="revenue"
              [width]="280"
              [height]="180"
              xAxisLabel="Month"
              yAxisLabel="Revenue ($k)"
              [showXGrid]="true"
              [padding]="{ left: 0.05, right: 0.05 }"
            />
          </view>
        </view>

        <!-- Multiple series overlaid via the base component -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Two series (base component)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-cartesian-chart
              [xDomain]="[1, 6]"
              [yDomain]="[0, 40]"
              [xTicks]="[1, 2, 3, 4, 5, 6]"
              [yTicks]="[0, 10, 20, 30, 40]"
              [width]="280"
              [height]="180"
            >
              <ui-area-series [data]="revenue" [color]="blue" />
              <ui-area-series [data]="lastYear" [color]="green" />
            </ui-cartesian-chart>
          </view>
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view
                class="h-2.5 w-2.5 rounded-full"
                [style]="'background-color: ' + blue"
              />
              <text class="text-xs text-muted-foreground">This year</text>
            </view>
            <view class="flex-row items-center gap-1.5 flex">
              <view
                class="h-2.5 w-2.5 rounded-full"
                [style]="'background-color: ' + green"
              />
              <text class="text-xs text-muted-foreground">Last year</text>
            </view>
          </view>
        </view>

        <!-- Interactive: tap a data point -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Tap a point</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-area-chart
              [data]="revenue"
              [width]="280"
              [height]="180"
              [dotRadius]="5"
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
  // Month → value data. x is the month index; y is the metric.
  readonly revenue: ChartPoint[] = [
    { x: 1, y: 12 },
    { x: 2, y: 19 },
    { x: 3, y: 15 },
    { x: 4, y: 25 },
    { x: 5, y: 22 },
    { x: 6, y: 30 },
  ];

  readonly lastYear: ChartPoint[] = [
    { x: 1, y: 8 },
    { x: 2, y: 11 },
    { x: 3, y: 14 },
    { x: 4, y: 13 },
    { x: 5, y: 18 },
    { x: 6, y: 20 },
  ];

  readonly downloads: ChartPoint[] = [
    { x: 1, y: 40 },
    { x: 2, y: 33 },
    { x: 3, y: 52 },
    { x: 4, y: 48 },
    { x: 5, y: 61 },
    { x: 6, y: 75 },
  ];

  // A series that dips below zero, to show the fill straddling the baseline.
  readonly delta: ChartPoint[] = [
    { x: 1, y: -5 },
    { x: 2, y: 3 },
    { x: 3, y: -2 },
    { x: 4, y: 8 },
    { x: 5, y: 4 },
    { x: 6, y: -1 },
  ];

  // Fixed brand hues for the data series — deliberately raw rgba() so they stay
  // constant across light/dark mode (they're data, not theme chrome).
  readonly blue = 'rgba(59, 130, 246, 1)';
  readonly green = 'rgba(34, 197, 94, 1)';

  readonly #tapped = signal<ChartPoint | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: month ${point.x}, value ${point.y}`
      : 'Tap any point on the chart above.';
  });

  protected onPointTap(point: ChartPoint): void {
    this.#tapped.set(point);
  }
}

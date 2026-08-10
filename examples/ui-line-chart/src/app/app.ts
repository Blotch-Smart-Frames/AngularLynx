import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiLineChart, UiLineSeries } from '../components/ui/line-chart';
import {
  UiCartesianChart,
  type ChartPoint,
} from '../components/ui/cartesian-chart';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiLineChart, UiCartesianChart, UiLineSeries],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Line Chart</text>
        <text class="text-sm text-muted-foreground">
          A line chart drawn entirely from Lynx views — no SVG or canvas. Built
          on the reusable BaseCartesianChart, so bar and area charts can follow.
        </text>

        <!-- Basic single-series chart via the convenience wrapper -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Revenue (basic)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart [data]="revenue" [width]="280" [height]="180" />
          </view>
        </view>

        <!-- Custom color + thicker stroke -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Custom color</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="downloads"
              [width]="280"
              [height]="180"
              [color]="blue"
              [strokeWidth]="3"
              [dotRadius]="4"
            />
          </view>
        </view>

        <!-- Smooth (monotone-cubic) curve instead of straight segments -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Smooth curve</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-line-chart
              [data]="revenue"
              [width]="280"
              [height]="180"
              [smooth]="true"
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
              [width]="280"
              [height]="180"
              xAxisLabel="Month"
              yAxisLabel="Revenue ($k)"
              [showXGrid]="true"
              [padding]="{ left: 0.05, right: 0.05 }"
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
              [width]="280"
              [height]="180"
              [yMin]="0"
            />
          </view>
        </view>

        <!-- Multiple series overlaid via the base component directly -->
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
              <ui-line-series [data]="revenue" [color]="blue" />
              <ui-line-series [data]="lastYear" [color]="green" />
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
            <ui-line-chart
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

  // Explicit series colors. Data colors stay fixed across light/dark mode
  // (they're brand hues, not theme chrome), so raw rgba() is the right call here.
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

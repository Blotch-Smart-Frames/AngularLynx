import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBarChart, UiBarSeries } from '../components/ui/bar-chart';
import {
  type ChartPoint,
  UiCartesianChart,
} from '../components/ui/cartesian-chart';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiBarChart, UiBarSeries, UiCartesianChart],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Bar Chart</text>
        <text class="text-sm text-muted-foreground">
          A bar chart drawn entirely from Lynx views — one rectangle per value,
          no SVG or canvas. Built on the same BaseCartesianChart as the line,
          area, and candlestick charts.
        </text>

        <!-- Basic single-series chart via the convenience wrapper -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Revenue (basic)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-bar-chart [data]="revenue" [width]="280" [height]="200" />
          </view>
        </view>

        <!-- Per-bar categorical colors + rounded corners -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Categorical colors
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-bar-chart
              [data]="revenue"
              [width]="280"
              [height]="200"
              [colors]="palette"
              [radius]="4"
            />
          </view>
        </view>

        <!-- Diverging bars: negative values grow downward from the baseline -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Profit &amp; loss (diverging)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-bar-chart
              [data]="profit"
              [width]="280"
              [height]="200"
              [colors]="profitColors()"
              [showXGrid]="false"
            />
          </view>
        </view>

        <!-- Axis titles + vertical gridlines -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Labeled axes &amp; grid
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-bar-chart
              [data]="revenue"
              [width]="280"
              [height]="200"
              xAxisLabel="Month"
              yAxisLabel="Revenue ($k)"
              [showXGrid]="true"
            />
          </view>
        </view>

        <!-- Full control over the axes via the base component directly -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Explicit axes (base component)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-cartesian-chart
              [xDomain]="[0, 7]"
              [yDomain]="[0, 100]"
              [xTicks]="[1, 2, 3, 4, 5, 6]"
              [yTicks]="[0, 25, 50, 75, 100]"
              [width]="280"
              [height]="200"
              [padding]="{ left: 0.09, right: 0.09 }"
            >
              <ui-bar-series [data]="revenue" [radius]="2" />
            </ui-cartesian-chart>
          </view>
        </view>

        <!-- Interactive: tap a bar -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Tap a bar</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-bar-chart
              [data]="revenue"
              [width]="280"
              [height]="200"
              (barTap)="onBarTap($event)"
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
  // Month index → revenue ($k). x is the month; a plain positive series.
  readonly revenue: ChartPoint[] = [
    { x: 1, y: 42 },
    { x: 2, y: 58 },
    { x: 3, y: 71 },
    { x: 4, y: 49 },
    { x: 5, y: 83 },
    { x: 6, y: 66 },
  ];

  // A mix of gains and losses to show bars growing both ways from the baseline.
  readonly profit: ChartPoint[] = [
    { x: 1, y: 18 },
    { x: 2, y: -12 },
    { x: 3, y: 25 },
    { x: 4, y: -8 },
    { x: 5, y: 14 },
    { x: 6, y: -20 },
  ];

  // Categorical palette. Data hues stay fixed across light/dark mode (they
  // distinguish categories, not theme chrome), so raw rgba() is the right call.
  readonly palette = [
    'rgba(59, 130, 246, 1)', // blue
    'rgba(16, 185, 129, 1)', // green
    'rgba(245, 158, 11, 1)', // amber
    'rgba(139, 92, 246, 1)', // violet
    'rgba(236, 72, 153, 1)', // pink
    'rgba(20, 184, 166, 1)', // teal
  ];

  // Green for gains, red for losses — one color per bar, derived from the sign.
  protected readonly profitColors = computed(() =>
    this.profit.map((p) =>
      p.y >= 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)',
    ),
  );

  readonly #tapped = signal<ChartPoint | null>(null);

  protected readonly tappedLabel = computed(() => {
    const bar = this.#tapped();
    return bar
      ? `Last tapped: month ${bar.x} — $${bar.y}k`
      : 'Tap any bar on the chart above.';
  });

  protected onBarTap(bar: ChartPoint): void {
    this.#tapped.set(bar);
  }
}

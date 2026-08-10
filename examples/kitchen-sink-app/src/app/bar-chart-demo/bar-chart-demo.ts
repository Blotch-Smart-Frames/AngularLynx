import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBarChart, UiBarSeries } from '../../components/ui/bar-chart';
import {
  type ChartPoint,
  UiCartesianChart,
} from '../../components/ui/cartesian-chart';
import { UiLineSeries } from '../../components/ui/line-chart';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Bar Chart demo.
 *
 * A bar is a single axis-aligned rectangle from a baseline to the value — the
 * simplest chart mark on Lynx (no wick, no rotation, no fill rasterization), so
 * bars draw straight onto the reusable `UiCartesianChart`. `UiBarChart` is the
 * single-series wrapper; the trend-line card drops to the base `UiCartesianChart`
 * and layers a `UiLineSeries` over a `UiBarSeries`, both reading the same shared
 * scales. Negative values grow downward from the baseline (see the P&L card).
 *
 * 280px fits inside a card on every current iPhone: screen p-4 (32px) +
 * card-content p-4 (32px) leaves ~311px on the narrowest 375px device.
 */
@Component({
  selector: 'app-bar-chart-demo',
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
    UiBarChart,
    UiBarSeries,
    UiCartesianChart,
    UiLineSeries,
  ],
  template: `
    <app-demo-screen
      heading="Bar Chart"
      category="Components"
      description="A bar chart drawn entirely from Lynx views — one rectangle per value, on the reusable BaseCartesianChart."
    >
      <!-- ── Basic: single series via the convenience wrapper ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-up" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass x/y points; each bar grows from the baseline to its value and
            the axes round themselves.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-bar-chart [data]="revenue" [width]="280" [height]="200" />
        </ui-card-content>
      </ui-card>

      <!-- ── Per-bar categorical colors + rounded corners ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="circle" size="sm" />
            <ui-card-title class="text-lg">Categorical colors</ui-card-title>
          </view>
          <ui-card-description>
            colors tints each bar (cycling if short); radius rounds the corners.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-bar-chart
            [data]="revenue"
            [width]="280"
            [height]="200"
            [colors]="palette"
            [radius]="4"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Diverging: negative values grow downward from the baseline ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Profit &amp; loss</ui-card-title>
          </view>
          <ui-card-description>
            Values below the baseline grow downward; here each bar is colored
            green for a gain, red for a loss.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-bar-chart
            [data]="profit"
            [width]="280"
            [height]="200"
            [colors]="profitColors()"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Bars + trend line, on the base component ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">Bars + trend line</ui-card-title>
          </view>
          <ui-card-description>
            Drop to the base &lt;ui-cartesian-chart&gt; and layer a
            &lt;ui-line-series&gt; over the bars — both share the same axes.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
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
            <ui-line-series
              [data]="trend"
              [color]="amber"
              [strokeWidth]="2"
              [showDots]="false"
              [smooth]="true"
            />
          </ui-cartesian-chart>
          <!-- Legend. Data hues are fixed (not theme chrome), so raw rgba(). -->
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view
                class="h-2.5 w-2.5 rounded-full"
                [style]="'background-color: ' + amber"
              />
              <text class="text-xs text-muted-foreground">3-month trend</text>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Interactive: tap a bar ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="plus" size="sm" />
            <ui-card-title class="text-lg">Tap a bar</ui-card-title>
          </view>
          <ui-card-description>
            Each bar is tappable; barTap emits the x/y point that was hit.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-bar-chart
            [data]="revenue"
            [width]="280"
            [height]="200"
            (barTap)="onBarTap($event)"
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
export class BarChartDemo {
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

  // Trailing 3-month average of the revenue, plotted as an overlay trend line.
  // The first two months have no full window, so the line starts at month 3.
  readonly trend: ChartPoint[] = this.revenue
    .map((_, i, all) =>
      i < 2
        ? null
        : { x: all[i].x, y: (all[i].y + all[i - 1].y + all[i - 2].y) / 3 },
    )
    .filter((point): point is ChartPoint => point !== null);

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

  readonly amber = 'rgba(245, 158, 11, 1)';

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

import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import {
  barY,
  d3Curve,
  defineChart,
  lineY,
  rollingWindow,
} from '@tanstack/charts/universal';
import { curveMonotoneX } from 'd3-shape';
import { type BarDatum, UiBarChart } from '../../components/ui/bar-chart';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiChart, tooltip } from '../../components/ui/chart';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/** A month's revenue in $k, in the shape an app would hold it. */
type MonthlyRevenue = {
  readonly month: string;
  readonly revenue: number;
};

/**
 * Bar Chart demo.
 *
 * `<ui-bar-chart>` is a preset over TanStack's `barY`: string x values become
 * categories on a band scale, and negative values grow down from the baseline
 * (see the P&L card). The trend-line card composes a `barY` and a `lineY` by
 * hand on `<ui-chart>`, with the average derived by TanStack's `rollingWindow`
 * transform rather than by hand.
 *
 * The charts fill the card's width and only set a height, so they fit any
 * screen without per-device pixel math.
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
    UiChart,
  ],
  template: `
    <app-demo-screen
      heading="Bar Chart"
      category="Components"
      description="A bar chart preset built on TanStack Charts: one bar per value, on category or numeric x axes."
    >
      <!-- ── Basic: single series via the preset ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-up" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass x/y points; string x values become categories. Each bar grows
            from the baseline to its value and the value axis rounds itself.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-bar-chart
            [data]="revenue"
            [height]="200"
            label="Revenue by month"
          />
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
            colors tints each bar, cycling when there are fewer colors than
            bars; radius rounds the corners.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-bar-chart
            [data]="revenue"
            [height]="200"
            [colors]="palette"
            [radius]="4"
            label="Revenue by month"
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
            [height]="200"
            [colors]="profitColors()"
            label="Profit and loss by month"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Bars + trend line, composed on <ui-chart> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="trending-up" size="sm" />
            <ui-card-title class="text-lg">Bars + trend line</ui-card-title>
          </view>
          <ui-card-description>
            Compose a barY and a lineY on one band scale and render them with
            &lt;ui-chart&gt;. rollingWindow() derives the 3-month average; touch
            a month to compare both.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="barsWithTrend"
            [height]="200"
            label="Revenue by month with its 3-month average"
          />
          <!-- A hand-made legend: the swatch classes use the same theme
               tokens as the marks, so both switch together in dark mode. -->
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-2.5 w-2.5 rounded-sm bg-primary"></view>
              <text class="text-xs text-muted-foreground">Revenue</text>
            </view>
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-2.5 w-2.5 rounded-full bg-chart-1"></view>
              <text class="text-xs text-muted-foreground">3-month average</text>
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
            barTap emits the x/y point of the bar that was tapped.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-bar-chart
            [data]="revenue"
            [height]="200"
            [radius]="4"
            label="Revenue by month"
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
  // Month → revenue ($k). String x values put the bars on a category axis.
  readonly revenue: readonly BarDatum[] = [
    { x: 'Jan', y: 42 },
    { x: 'Feb', y: 58 },
    { x: 'Mar', y: 71 },
    { x: 'Apr', y: 49 },
    { x: 'May', y: 83 },
    { x: 'Jun', y: 66 },
  ];

  // A mix of gains and losses to show bars growing both ways from the baseline.
  readonly profit: readonly BarDatum[] = [
    { x: 'Jan', y: 18 },
    { x: 'Feb', y: -12 },
    { x: 'Mar', y: 25 },
    { x: 'Apr', y: -8 },
    { x: 'May', y: 14 },
    { x: 'Jun', y: -20 },
  ];

  // The theme's five chart tokens: six bars against five colors shows the
  // cycling, and the tokens resolve to the dark palette in dark mode.
  readonly palette = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
  ];

  // Green for gains, red for losses, derived from the sign. These are fixed
  // rgba() rather than theme tokens because gain/loss must keep its meaning in
  // both modes (the dark theme's --destructive is too dark to read as red).
  protected readonly profitColors = computed(() =>
    this.profit.map((bar) =>
      bar.y >= 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)',
    ),
  );

  /**
   * The composed chart keeps its data in the app's own shape ({ month,
   * revenue }); marks map fields by name, so there's no series model to
   * convert into.
   */
  readonly monthly: readonly MonthlyRevenue[] = this.revenue.map((bar) => ({
    month: String(bar.x),
    revenue: bar.y,
  }));

  /**
   * Revenue bars with the trailing 3-month average on top. `rollingWindow`
   * with `partial: false` leaves out the first two months (no full window),
   * so the line starts at March. Both marks share the band scale, which
   * centers the line's points on the bars.
   *
   * The constant `z` names each mark for the tooltip; with `focus: 'group-x'`
   * touching a month shows its revenue and average together. The tooltip's
   * `items` formats the y values, since an average like 59.33 would otherwise
   * print with three decimals.
   */
  readonly barsWithTrend = defineChart({
    marks: [
      barY(this.monthly, {
        x: 'month',
        y: 'revenue',
        z: () => 'Revenue',
        fill: 'var(--primary)',
        radius: { end: 3 },
      }),
      lineY(
        rollingWindow(this.monthly, {
          size: 3,
          partial: false,
          outputs: { average: { value: 'revenue', reduce: 'mean' } },
        }),
        {
          x: 'month',
          y: 'average',
          z: () => '3-month average',
          stroke: 'var(--chart-1)',
          strokeWidth: 2.5,
          curve: d3Curve(curveMonotoneX),
        },
      ),
    ],
    scales: {
      x: { scale: () => scaleBand().padding(0.3) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    focus: 'group-x',
    tooltip: {
      use: tooltip,
      items: [
        {
          channel: 'y',
          text: (point) => `$${Math.round(Number(point.yValue))}k`,
        },
      ],
    },
  });

  readonly #tapped = signal<BarDatum | null>(null);

  protected readonly tappedLabel = computed(() => {
    const bar = this.#tapped();
    return bar
      ? `Last tapped: ${bar.x} — $${bar.y}k`
      : 'Tap any bar on the chart above.';
  });

  protected onBarTap(bar: BarDatum): void {
    this.#tapped.set(bar);
  }
}

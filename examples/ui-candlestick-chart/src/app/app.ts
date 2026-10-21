import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { defineChart, lineY } from '@tanstack/charts/universal';
import {
  type CandlestickDatum,
  UiCandlestickChart,
  candlestickChartDefinition,
} from '../components/ui/candlestick-chart';
import { UiChart } from '../components/ui/chart';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiCandlestickChart, UiChart],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">
          Candlestick Chart
        </text>
        <text class="text-sm text-muted-foreground">
          A candlestick (OHLC) chart preset built on TanStack Charts. Touch a
          candle to see its prices; tap to pin the tooltip.
        </text>

        <!-- Basic single-series chart via the convenience wrapper -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Prices (basic)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-candlestick-chart [data]="prices" [height]="200" />
          </view>
        </view>

        <!-- Custom up/down colors -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Custom colors</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-candlestick-chart
              [data]="prices"
              [height]="200"
              [upColor]="teal"
              [downColor]="rose"
            />
          </view>
        </view>

        <!-- Axis titles + vertical gridlines -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Labeled axes &amp; grid
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-candlestick-chart
              [data]="prices"
              [height]="200"
              xAxisLabel="Session"
              yAxisLabel="Price ($)"
              [showXGrid]="true"
            />
          </view>
        </view>

        <!-- Pin the y-axis range so several charts share one scale -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Fixed y-axis (90…120)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-candlestick-chart
              [data]="prices"
              [height]="200"
              [yMin]="90"
              [yMax]="120"
            />
          </view>
        </view>

        <!--
          Past the preset: start from its definition, add TanStack marks and
          render the result with <ui-chart>. Here, a moving average over the
          candles.
        -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Candles with a moving average (ui-chart)
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="withAverage"
              [height]="200"
              label="Prices with a three-day moving average"
            />
          </view>
        </view>

        <!-- Interactive: tap a candle -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Tap a candle</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-candlestick-chart
              [data]="prices"
              [height]="200"
              (candleTap)="onCandleTap($event)"
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
  // Session → OHLC data. x is the session index; a mix of rising and falling
  // candles so up/down coloring is visible.
  readonly prices: CandlestickDatum[] = [
    { x: 1, open: 100, high: 108, low: 98, close: 106 },
    { x: 2, open: 106, high: 110, low: 103, close: 104 },
    { x: 3, open: 104, high: 105, low: 96, close: 98 },
    { x: 4, open: 98, high: 102, low: 95, close: 101 },
    { x: 5, open: 101, high: 112, low: 100, close: 110 },
    { x: 6, open: 110, high: 115, low: 108, close: 109 },
    { x: 7, open: 109, high: 111, low: 102, close: 103 },
    { x: 8, open: 103, high: 107, low: 101, close: 107 },
  ];

  // Explicit up/down colors. Data hues stay fixed across light/dark mode (they
  // encode direction, not theme chrome), so raw rgba() is the right call.
  readonly teal = 'rgba(20, 184, 166, 1)';
  readonly rose = 'rgba(244, 63, 94, 1)';

  // The preset's own definition plus a line through each day's three-day
  // average close. Declared after the data, which class fields initialize in
  // order.
  readonly withAverage = (() => {
    const base = candlestickChartDefinition({ data: this.prices });
    const average = this.prices.slice(2).map((candle, i) => ({
      x: candle.x,
      y:
        this.prices.slice(i, i + 3).reduce((sum, day) => sum + day.close, 0) /
        3,
    }));
    return defineChart({
      ...base,
      marks: [
        ...base.marks,
        lineY(average, {
          x: 'x',
          y: 'y',
          stroke: 'var(--chart-4)',
          strokeWidth: 2,
        }),
      ],
    });
  })();

  readonly #tapped = signal<CandlestickDatum | null>(null);

  protected readonly tappedLabel = computed(() => {
    const c = this.#tapped();
    return c
      ? `Last tapped: session ${c.x} — O ${c.open} H ${c.high} L ${c.low} C ${c.close}`
      : 'Tap any candle on the chart above.';
  });

  protected onCandleTap(candle: CandlestickDatum): void {
    this.#tapped.set(candle);
  }
}

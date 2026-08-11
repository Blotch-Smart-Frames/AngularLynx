import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  type ChartPoint,
  UiCartesianChart,
} from '../../components/ui/cartesian-chart';
import {
  type CandlestickPoint,
  UiCandlestickChart,
  UiCandlestickSeries,
} from '../../components/ui/candlestick-chart';
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
 * Candlestick Chart demo.
 *
 * An OHLC candle is two axis-aligned rectangles: a thin wick (high→low) and a
 * body (open↔close), colored green when the period rose and red when it fell.
 * No rotation or fill rasterization is needed (unlike the line/area charts), so
 * candles draw straight onto the reusable `UiCartesianChart`. `UiCandlestickChart`
 * is the single-series wrapper; the moving-average card drops to the base
 * `UiCartesianChart` and layers a `UiLineSeries` over a `UiCandlestickSeries`,
 * both reading the same shared scales.
 *
 * 280px fits inside a card on every current iPhone: screen p-4 (32px) +
 * card-content p-4 (32px) leaves ~311px on the narrowest 375px device.
 */
@Component({
  selector: 'app-candlestick-chart-demo',
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
    UiCandlestickChart,
    UiCandlestickSeries,
    UiCartesianChart,
    UiLineSeries,
  ],
  template: `
    <app-demo-screen
      heading="Candlestick Chart"
      category="Components"
      description="An OHLC candlestick chart drawn entirely from Lynx views — a wick and a body rectangle per period, on the reusable BaseCartesianChart."
    >
      <!-- ── Basic: single series via the convenience wrapper ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-down" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass OHLC points; green candles rose over the period, red fell, and
            the axes round themselves.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-candlestick-chart [data]="prices" [width]="280" [height]="200" />
        </ui-card-content>
      </ui-card>

      <!-- ── Custom up/down colors ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">Custom colors</ui-card-title>
          </view>
          <ui-card-description>
            upColor and downColor set the fill for rising and falling candles.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-candlestick-chart
            [data]="prices"
            [width]="280"
            [height]="200"
            [upColor]="teal"
            [downColor]="rose"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Axis titles + vertical gridlines ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">
              Labeled axes &amp; grid
            </ui-card-title>
          </view>
          <ui-card-description>
            xAxisLabel / yAxisLabel add titles; showXGrid draws vertical
            gridlines at each session.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-candlestick-chart
            [data]="prices"
            [width]="280"
            [height]="200"
            xAxisLabel="Session"
            yAxisLabel="Price ($)"
            [showXGrid]="true"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Candles + moving-average line, on the base component ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Moving average</ui-card-title>
          </view>
          <ui-card-description>
            Drop to the base &lt;ui-cartesian-chart&gt; and layer a
            &lt;ui-line-series&gt; over the candles — both share the same axes.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-cartesian-chart
            [xDomain]="[0, 9]"
            [yDomain]="[90, 120]"
            [xTicks]="[1, 3, 5, 7]"
            [yTicks]="[90, 100, 110, 120]"
            [width]="280"
            [height]="200"
            [padding]="{ left: 0.06, right: 0.06 }"
          >
            <ui-candlestick-series [data]="prices" />
            <ui-line-series
              [data]="movingAverage"
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
              <text class="text-xs text-muted-foreground">3-session MA</text>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Interactive: tap a candle ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="plus" size="sm" />
            <ui-card-title class="text-lg">Tap a candle</ui-card-title>
          </view>
          <ui-card-description>
            Each candle body is tappable; candleTap emits the OHLC point that
            was hit.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-candlestick-chart
            [data]="prices"
            [width]="280"
            [height]="200"
            (candleTap)="onCandleTap($event)"
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
export class CandlestickChartDemo {
  // Session → OHLC data. x is the session index; a mix of rising and falling
  // candles so up/down coloring is visible.
  readonly prices: CandlestickPoint[] = [
    { x: 1, open: 100, high: 108, low: 98, close: 106 },
    { x: 2, open: 106, high: 110, low: 103, close: 104 },
    { x: 3, open: 104, high: 105, low: 96, close: 98 },
    { x: 4, open: 98, high: 102, low: 95, close: 101 },
    { x: 5, open: 101, high: 112, low: 100, close: 110 },
    { x: 6, open: 110, high: 115, low: 108, close: 109 },
    { x: 7, open: 109, high: 111, low: 102, close: 103 },
    { x: 8, open: 103, high: 107, low: 101, close: 107 },
  ];

  // Trailing 3-session average of the closes, plotted as an overlay line. The
  // first two sessions have no full window, so the line starts at session 3.
  readonly movingAverage: ChartPoint[] = this.prices
    .map((_, i, all) =>
      i < 2
        ? null
        : {
            x: all[i].x,
            y: (all[i].close + all[i - 1].close + all[i - 2].close) / 3,
          },
    )
    .filter((point): point is ChartPoint => point !== null);

  // Fixed data hues — deliberately raw rgba() so they stay constant across
  // light/dark mode (they encode direction / a series, not theme chrome).
  readonly teal = 'rgba(20, 184, 166, 1)';
  readonly rose = 'rgba(244, 63, 94, 1)';
  readonly amber = 'rgba(245, 158, 11, 1)';

  readonly #tapped = signal<CandlestickPoint | null>(null);

  protected readonly tappedLabel = computed(() => {
    const c = this.#tapped();
    return c
      ? `Last tapped: session ${c.x} — O ${c.open} H ${c.high} L ${c.low} C ${c.close}`
      : 'Tap any candle on the chart above.';
  });

  protected onCandleTap(candle: CandlestickPoint): void {
    this.#tapped.set(candle);
  }
}

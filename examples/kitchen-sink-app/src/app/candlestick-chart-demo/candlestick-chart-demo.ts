import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  d3Curve,
  defineChart,
  lineY,
  rollingWindow,
} from '@tanstack/charts/universal';
import { curveMonotoneX } from 'd3-shape';
import {
  type CandlestickDatum,
  UiCandlestickChart,
  candlestickChartDefinition,
} from '../../components/ui/candlestick-chart';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiChart } from '../../components/ui/chart';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Candlestick Chart demo.
 *
 * An OHLC candle is a TanStack `link` (the high–low wick) and a `rect` (the
 * open–close body), colored green when the period rose and red when it fell.
 * `<ui-candlestick-chart>` is that preset; the moving-average card starts from
 * its definition via `candlestickChartDefinition()` and adds a `lineY`, so the
 * line reuses the preset's axes, colors and OHLC tooltip as they are.
 *
 * The charts fill the card's width and only set a height, so they fit any
 * screen without per-device pixel math.
 */
@Component({
  selector: 'app-candlestick-chart-demo',
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
    UiCandlestickChart,
    UiChart,
  ],
  template: `
    <app-demo-screen
      heading="Candlestick Chart"
      category="Components"
      description="An OHLC candlestick chart preset built on TanStack Charts: a wick and a body per period. Touch a candle to read its open, high, low and close."
    >
      <!-- ── Basic: single series via the preset ── -->
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
          <ui-candlestick-chart
            [data]="prices"
            [height]="200"
            label="Price by session"
          />
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
            upColor and downColor set the wick and body for rising and falling
            candles.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-candlestick-chart
            [data]="prices"
            [height]="200"
            [upColor]="teal"
            [downColor]="rose"
            label="Price by session"
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
            gridlines at the session ticks.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-candlestick-chart
            [data]="prices"
            [height]="200"
            xAxisLabel="Session"
            yAxisLabel="Price ($)"
            [showXGrid]="true"
            label="Price by session"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Candles + moving average: the preset's definition + a lineY ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="activity" size="sm" />
            <ui-card-title class="text-lg">Moving average</ui-card-title>
          </view>
          <ui-card-description>
            Start from candlestickChartDefinition() and add a lineY, rendered
            with &lt;ui-chart&gt;. rollingWindow() averages the last three
            closes; the line shares the preset's axes.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="withMovingAverage"
            [height]="200"
            label="Price by session with a 3-session moving average"
          />
          <!-- A hand-made legend: the swatch class uses the same --chart-3
               token as the line, so both switch together in dark mode. -->
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-0.5 w-3 rounded-full bg-chart-3"></view>
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
            candleTap emits the OHLC point of the candle nearest the tap.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-candlestick-chart
            [data]="prices"
            [height]="200"
            label="Price by session"
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
  readonly prices: readonly CandlestickDatum[] = [
    { x: 1, open: 100, high: 108, low: 98, close: 106 },
    { x: 2, open: 106, high: 110, low: 103, close: 104 },
    { x: 3, open: 104, high: 105, low: 96, close: 98 },
    { x: 4, open: 98, high: 102, low: 95, close: 101 },
    { x: 5, open: 101, high: 112, low: 100, close: 110 },
    { x: 6, open: 110, high: 115, low: 108, close: 109 },
    { x: 7, open: 109, high: 111, low: 102, close: 103 },
    { x: 8, open: 103, high: 107, low: 101, close: 107 },
  ];

  // Fixed hues rather than theme tokens: up/down must keep its meaning (and
  // stay distinguishable from each other) in both light and dark mode.
  readonly teal = 'rgba(20, 184, 166, 1)';
  readonly rose = 'rgba(244, 63, 94, 1)';

  /**
   * The preset's candles plus a trailing 3-session average of the closes.
   * `rollingWindow` with `partial: false` leaves out the first two sessions
   * (no full window), so the line starts at session 3. Its rows keep the
   * source candle's fields, which is why the preset's OHLC tooltip still
   * reads correctly when a touch lands on the line. The average always lies
   * between the lows and highs, so the preset's y axis already fits it.
   */
  readonly withMovingAverage = (() => {
    const base = candlestickChartDefinition({ data: this.prices });
    return defineChart({
      ...base,
      marks: [
        ...base.marks,
        lineY(
          rollingWindow(this.prices, {
            size: 3,
            partial: false,
            outputs: { average: { value: 'close', reduce: 'mean' } },
          }),
          {
            x: 'x',
            y: 'average',
            stroke: 'var(--chart-3)',
            strokeWidth: 2,
            curve: d3Curve(curveMonotoneX),
          },
        ),
      ],
    });
  })();

  readonly #tapped = signal<CandlestickDatum | null>(null);

  protected readonly tappedLabel = computed(() => {
    const candle = this.#tapped();
    return candle
      ? `Last tapped: session ${candle.x} — O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close}`
      : 'Tap any candle on the chart above.';
  });

  protected onCandleTap(candle: CandlestickDatum): void {
    this.#tapped.set(candle);
  }
}

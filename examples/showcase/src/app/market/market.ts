import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxExposure,
  registerHostElement,
} from '@blotch/angular-lynx';
import { UiAreaChart } from '../../components/ui/area-chart';
import { UiBarChart } from '../../components/ui/bar-chart';
import { UiCandlestickChart } from '../../components/ui/candlestick-chart';
import { UiDockScroll } from '../../components/ui/dock';
import { UiScatterChart } from '../../components/ui/scatter-chart';
import {
  formatCarat,
  formatChange,
  formatMoney,
  formatNumber,
} from '../data/format';
import { gemById } from '../data/gems';
import { MONTHS, priceSeries, roughCandles } from '../data/market';
import { Ground } from '../ground/ground';
import { AtlasState } from '../state/atlas-state';

type Range = '1Y' | '3Y' | '10Y';
const RANGE_MONTHS: Record<Range, number> = {
  '1Y': 12,
  '3Y': 36,
  '10Y': MONTHS,
};
const RANGES: readonly Range[] = ['1Y', '3Y', '10Y'];

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Thousands of dollars, as the axes read them: `$30k`.
 */
const thousands = (value: number): string => `$${formatNumber(value)}k`;
const carats = (value: number): string => `${formatNumber(value)} ct`;
const dollars = (value: number): string => `$${formatNumber(value)}`;
const weeks = (value: number): string => `W${formatNumber(value)}`;

/**
 * The market: the stone's price per carat over time, the parcel by origin
 * and by size, and the rough. Every figure is illustrative, and the screen
 * says so. Each chart cuts in as it scrolls into view.
 */
@Component({
  selector: 'app-market',
  imports: [
    LYNX_ELEMENTS,
    LynxExposure,
    Ground,
    UiAreaChart,
    UiBarChart,
    UiCandlestickChart,
    UiDockScroll,
    UiScatterChart,
  ],
  host: { class: 'relative h-full w-full flex-col bg-background flex' },
  template: `
    <view appGround class="absolute top-0 right-0 bottom-0 left-0"></view>
    <scroll-view
      ui-dock-scroll
      class="h-full w-full"
      scroll-orientation="vertical"
    >
      <view class="flex flex-col pt-safe-3">
        <view
          class="flex flex-row items-end justify-between border-b border-foreground px-5 pb-3"
          style="min-height: 92px"
        >
          <view class="flex flex-col">
            <text class="font-wide text-[28px] leading-[32px] text-foreground"
              >MARKET</text
            >
            <text
              class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >
              {{ upper(atlas.gem().name) }} · ILLUSTRATIVE
            </text>
          </view>
          <!-- The range, as detents: hairline at rest, inverted when chosen. -->
          <view class="flex w-[168px] shrink-0 flex-row gap-1">
            @for (option of ranges; track option) {
              <view
                class="detent flex h-9 flex-1 items-center justify-center border border-foreground"
                [class.detent-on]="option === range()"
                accessibility-element="true"
                accessibility-traits="button"
                [accessibility-label]="option"
                [lynxAccessibilityTraits]="{ selected: option === range() }"
                (bindtap)="range.set(option)"
              >
                <text
                  class="font-narrow text-[11px] tracking-[2px]"
                  [class.text-foreground]="option !== range()"
                  [class.text-background]="option === range()"
                >
                  {{ option }}
                </text>
              </view>
            }
          </view>
        </view>

        <!-- Price per carat: the figure, its change, the curve. -->
        <view
          lynxExposure
          #price="lynxExposure"
          class="flex flex-col border-b border-foreground px-5 pt-4 pb-4"
          [class.band-hidden]="!reduceMotion()"
          [class.cut-in]="price.visible()"
        >
          <text
            class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
          >
            PRICE PER CARAT, {{ rangeUnit() }}
          </text>
          <view class="flex flex-row items-end justify-between pt-1">
            <text class="font-wide text-[22px] leading-[26px] text-foreground">
              {{ priceNow() }}
            </text>
            <text
              class="font-routed text-[13px] leading-[22px]"
              [style.color]="atlas.color()"
            >
              {{ priceChange() }}
            </text>
          </view>
          <ui-area-chart
            [data]="series()"
            [height]="190"
            [color]="atlas.color()"
            [smooth]="true"
            [showDots]="false"
            [fillOpacity]="0.22"
            [tickCount]="xTicks()"
            [xTickFormat]="xFormat()"
            [yTickFormat]="thousands"
            [yMin]="0"
            label="Price per carat over the chosen range"
          />
        </view>

        <!-- Carats by origin: one line, the chart does the talking. -->
        <view
          lynxExposure
          #origins="lynxExposure"
          class="flex flex-col border-b border-foreground px-5 pt-4 pb-4"
          [class.band-hidden]="!reduceMotion()"
          [class.cut-in]="origins.visible()"
        >
          <text
            class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
          >
            CARATS BY ORIGIN, TOP FIVE · {{ upper(totalCarats()) }} IN ALL
          </text>
          <ui-bar-chart
            [data]="caratsByOrigin()"
            [height]="170"
            [color]="atlas.color()"
            [radius]="0"
            [barWidthRatio]="0.62"
            [yTickFormat]="carats"
            label="Carats in the parcel, by origin"
          />
        </view>

        <!-- Carat against price: the whole parcel, this stone's lots in its color -->
        <view
          lynxExposure
          #sizes="lynxExposure"
          class="flex flex-col border-b border-foreground px-5 pt-4 pb-4"
          [class.band-hidden]="!reduceMotion()"
          [class.cut-in]="sizes.visible()"
        >
          <text
            class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
          >
            CARAT × PRICE · THE PARCEL, {{ parcelValue() }}
          </text>
          <view class="flex flex-row items-center gap-2 pt-1">
            <view
              class="h-2 w-2 rounded-full"
              [style.background-color]="atlas.color()"
            ></view>
            <text class="font-routed text-[12px] text-muted-foreground">
              {{ atlas.gem().name }} lots in its color; the rest in gray
            </text>
          </view>
          <ui-scatter-chart
            [data]="caratPrice()"
            [colors]="caratPriceColors()"
            [height]="190"
            [radius]="4"
            [xTickFormat]="carats"
            [yTickFormat]="thousands"
            [xMin]="0"
            [yMin]="0"
            label="Each lot's carat weight against its price"
          />
        </view>

        <!-- The rough: the figure, then the weekly candles. -->
        <view
          lynxExposure
          #rough="lynxExposure"
          class="flex flex-col border-b border-foreground px-5 pt-4 pb-4"
          [class.band-hidden]="!reduceMotion()"
          [class.cut-in]="rough.visible()"
        >
          <view class="flex flex-row items-end justify-between">
            <text
              class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >
              ROUGH, 26 WEEKS, $/CT
            </text>
            <text class="font-wide text-[22px] leading-[26px] text-foreground">
              {{ roughNow() }}
            </text>
          </view>
          <ui-candlestick-chart
            [data]="candles()"
            [height]="190"
            [upColor]="atlas.color()"
            downColor="var(--foreground)"
            [xTickFormat]="weeks"
            [yTickFormat]="dollars"
            label="Weekly rough prices, open, high, low and close"
          />
        </view>

        <view class="flex flex-row items-center px-5" style="height: 56px">
          <text
            class="font-routed text-[13px] leading-[18px] text-muted-foreground"
          >
            Prices here are illustrative: a seeded series around a plausible
            price per carat, not a quotation.
          </text>
        </view>
      </view>
      <view style="height: 128px"></view>
    </scroll-view>
  `,
  styles: [
    `
      /* Not opacity 0: Lynx never reports a fully transparent element as
         exposed, so a band hidden that way would never come into view. */
      .band-hidden {
        opacity: 0.02;
        transform: translateY(18px) scaleY(0.8);
      }
      @keyframes band-cut-in {
        from {
          opacity: 0.02;
          transform: translateY(18px) scaleY(0.8);
        }
        to {
          opacity: 1;
          transform: translateY(0) scaleY(1);
        }
      }
      .band-hidden.cut-in {
        opacity: 1;
        animation: band-cut-in 420ms ease-out both;
      }
      .detent {
        background-color: transparent;
        transition: background-color 120ms ease-out;
      }
      .detent-on {
        background-color: var(--foreground);
      }
    `,
  ],
})
export class MarketPage {
  protected readonly atlas = inject(AtlasState);
  protected readonly reduceMotion = inject(LynxAccessibilitySettings)
    .reduceMotion;

  protected readonly ranges = RANGES;
  protected readonly range = signal<Range>('3Y');

  protected readonly thousands = thousands;
  protected readonly carats = carats;
  protected readonly dollars = dollars;
  protected readonly weeks = weeks;

  readonly #fullSeries = computed(() => priceSeries(this.atlas.gem()));
  readonly #now = new Date();

  /**
   * The range's points, in thousands of dollars. Over a year the x axis is
   * the month; over longer, the calendar year, as a fraction, so the axis
   * can pick whole years.
   */
  protected readonly series = computed(() => {
    const months = RANGE_MONTHS[this.range()];
    const points = this.#fullSeries().slice(MONTHS - months);
    const year = this.#now.getFullYear();
    const month = this.#now.getMonth();
    return points.map((point, i) => {
      const monthsAgo = months - 1 - i;
      return {
        x: months === 12 ? i + 1 : year + (month - monthsAgo) / 12,
        y: point.y / 1000,
      };
    });
  });
  protected readonly rangeUnit = computed(() =>
    this.range() === '1Y' ? 'BY MONTH' : 'BY YEAR',
  );
  protected readonly xTicks = computed(() =>
    this.range() === '1Y' ? 6 : this.range() === '3Y' ? 4 : 5,
  );
  protected readonly xFormat = computed(() => {
    if (this.range() !== '1Y') {
      return (value: number) => String(Math.round(value));
    }
    const month = this.#now.getMonth();
    return (value: number) =>
      MONTH_NAMES[(month - 12 + Math.round(value) + 12) % 12]!;
  });

  protected readonly priceNow = computed(() => {
    const series = this.#fullSeries();
    return formatMoney(series[series.length - 1]!.y);
  });
  protected readonly priceChange = computed(() => {
    const series = this.series();
    const first = series[0]!.y;
    const last = series[series.length - 1]!.y;
    return `${formatChange((last - first) / first)} over ${this.range()}`;
  });

  // The five biggest, by the origin's first word, so every bar keeps its name.
  protected readonly caratsByOrigin = computed(() => {
    const total = new Map<string, number>();
    for (const lot of this.atlas.lots()) {
      const origin = gemById(lot.gemId).origin.split(' ')[0]!;
      total.set(origin, (total.get(origin) ?? 0) + lot.carat);
    }
    return [...total.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([x, y]) => ({ x, y: Math.round(y * 10) / 10 }));
  });
  protected readonly totalCarats = computed(() =>
    formatCarat(this.atlas.lots().reduce((sum, lot) => sum + lot.carat, 0)),
  );

  // The whole parcel, in thousands, with the chosen stone's lots in its color.
  protected readonly caratPrice = computed(() =>
    this.atlas.lots().map((lot) => ({ x: lot.carat, y: lot.price / 1000 })),
  );
  protected readonly caratPriceColors = computed(() => {
    const own = this.atlas.color();
    return this.atlas
      .lots()
      .map((lot) =>
        lot.gemId === this.atlas.gemId() ? own : 'var(--muted-foreground)',
      );
  });
  protected readonly parcelValue = computed(() =>
    formatMoney(this.atlas.lots().reduce((sum, lot) => sum + lot.price, 0)),
  );

  protected readonly candles = computed(() => roughCandles(this.atlas.gem()));
  protected readonly roughNow = computed(() => {
    const candles = this.candles();
    return formatMoney(candles[candles.length - 1]!.close);
  });

  protected upper(text: string): string {
    return text.toUpperCase();
  }
}

registerHostElement(MarketPage, 'view');

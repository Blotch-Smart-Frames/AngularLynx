import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  type ChartPoint,
  UiCartesianChart,
} from '../../components/ui/cartesian-chart';
import { UiAreaChart, UiAreaSeries } from '../../components/ui/area-chart';
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
 * Area Chart demo.
 *
 * An area chart is a line chart with the region down to a baseline filled in.
 * There is no filled-polygon primitive on Lynx (`clip-path` has no `polygon()`,
 * `<svg>` is unreliable), so the fill is rasterized into thin vertical `<view>`
 * strips and the reused `<ui-line-series>` is painted on top. `UiAreaChart` is
 * the single-series wrapper; the multi-series card drops to the reusable
 * `UiCartesianChart` base with one `UiAreaSeries` per series — the same
 * extension point the Line Chart uses.
 *
 * 280px fits inside a card on every current iPhone: screen p-4 (32px) +
 * card-content p-4 (32px) leaves ~311px on the narrowest 375px device.
 */
@Component({
  selector: 'app-area-chart-demo',
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
    UiAreaChart,
    UiCartesianChart,
    UiAreaSeries,
  ],
  template: `
    <app-demo-screen
      heading="Area Chart"
      category="Components"
      description="A filled line chart drawn entirely from Lynx views — a translucent fill under a reused line series, both on the reusable BaseCartesianChart."
    >
      <!-- ── Basic: single series via the convenience wrapper ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-up" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass an array of points; the fill drops to y = 0 and the axes round
            themselves.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-area-chart [data]="revenue" [width]="280" [height]="180" />
        </ui-card-content>
      </ui-card>

      <!-- ── Custom color and fill opacity ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">
              Color and fill opacity
            </ui-card-title>
          </view>
          <ui-card-description>
            color sets the line and dots; fillOpacity controls how solid the
            filled region reads.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-area-chart
            [data]="downloads"
            [width]="280"
            [height]="180"
            [color]="blue"
            [fillOpacity]="0.25"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Negative values straddling the baseline (area-specific) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="minus" size="sm" />
            <ui-card-title class="text-lg">Negative values</ui-card-title>
          </view>
          <ui-card-description>
            With a baseline of 0, the fill hangs from the line down to the zero
            line — above it and below it.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-area-chart
            [data]="delta"
            [width]="280"
            [height]="180"
            [color]="green"
            [baseline]="0"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Multiple series overlaid on the base component directly ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="menu" size="sm" />
            <ui-card-title class="text-lg">Multiple series</ui-card-title>
          </view>
          <ui-card-description>
            Drop to the base &lt;ui-cartesian-chart&gt; and add one
            &lt;ui-area-series&gt; per series — their translucent fills layer
            where they overlap.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
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
          <!-- Legend. Data hues are fixed brand colors (not theme chrome), so
               raw rgba() is correct here — they must not flip in dark mode. -->
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
        </ui-card-content>
      </ui-card>

      <!-- ── Interactive: tap a data point ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Tap a point</ui-card-title>
          </view>
          <ui-card-description>
            Each dot is tappable; pointTap emits the &#123; x, y &#125; that was
            hit.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-area-chart
            [data]="revenue"
            [width]="280"
            [height]="180"
            [dotRadius]="5"
            (pointTap)="onPointTap($event)"
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
export class AreaChartDemo {
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

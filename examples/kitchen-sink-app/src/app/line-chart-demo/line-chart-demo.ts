import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  type ChartPoint,
  UiCartesianChart,
} from '../../components/ui/cartesian-chart';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { UiLineChart, UiLineSeries } from '../../components/ui/line-chart';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Line Chart demo.
 *
 * The chart draws entirely from `<view>`/`<text>` — Lynx has no SVG, canvas, or
 * `<line>` — so each segment is a thin view rotated with `transform: rotate()`.
 * `UiLineChart` is the single-series convenience wrapper; the multi-series card
 * drops down to the reusable `UiCartesianChart` base with one `UiLineSeries`
 * per line, which is the extension point for future bar/area charts.
 *
 * Charts take explicit pixel `width`/`height` because the rotation math needs
 * pixel coordinates (responsive auto-measure is out of scope). 280px fits inside
 * a card on every current iPhone: screen p-4 (32px) + card-content p-4 (32px)
 * leaves ~311px on the narrowest 375px device.
 */
@Component({
  selector: 'app-line-chart-demo',
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
    UiLineChart,
    UiCartesianChart,
    UiLineSeries,
  ],
  template: `
    <app-demo-screen
      heading="Line Chart"
      category="Components"
      description="A line chart drawn entirely from Lynx views — no SVG or canvas. Built on a reusable BaseCartesianChart, so bar and area charts can follow."
    >
      <!-- ── Basic: single series via the convenience wrapper ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass an array of points; the wrapper picks rounded axis ranges for
            you.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-line-chart [data]="revenue" [width]="280" [height]="180" />
        </ui-card-content>
      </ui-card>

      <!-- ── Custom color and thicker stroke ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">Color and thickness</ui-card-title>
          </view>
          <ui-card-description>
            color sets both the line and the dots; strokeWidth and dotRadius
            tune the weight.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-line-chart
            [data]="downloads"
            [width]="280"
            [height]="180"
            [color]="blue"
            [strokeWidth]="3"
            [dotRadius]="4"
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
            &lt;ui-line-series&gt; per line — they share the same axes, so they
            line up automatically.
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
            <ui-line-series [data]="revenue" [color]="blue" />
            <ui-line-series [data]="lastYear" [color]="green" />
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
          <ui-line-chart
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
export class LineChartDemo {
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

  /**
   * A plain signal.set is safe from the native bindtap callback: it only updates
   * a <text> binding, not the element tree, and zoneless CD flushes it
   * asynchronously (unlike the @if toggles elsewhere that need setTimeout).
   */
  protected onPointTap(point: ChartPoint): void {
    this.#tapped.set(point);
  }
}

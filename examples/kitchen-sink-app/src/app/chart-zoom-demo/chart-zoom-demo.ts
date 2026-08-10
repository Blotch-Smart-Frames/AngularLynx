import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiBarChart } from '../../components/ui/bar-chart';
import {
  type CandlestickPoint,
  UiCandlestickChart,
} from '../../components/ui/candlestick-chart';
import { type ChartPoint } from '../../components/ui/cartesian-chart';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

type ChartType = 'candles' | 'bar';
type ZoomAxes = 'x' | 'y' | 'xy';

/**
 * Chart Zoom demo — the interactive showcase for `UiCartesianChart`'s pan/zoom.
 *
 * Like the gesture demo, it deliberately avoids the shared `DemoScreen` wrapper
 * (and any scroll-view): the chart itself owns the touch stream (a 1-finger drag
 * pans, a pinch zooms), so nesting it in a scroll-view would make the two fight
 * for the same vertical drag. `ScreenHost` gives the host a definite height so
 * the single chart card can claim the slack via `flex-1`.
 *
 * Everything the user sees update on zoom — the axis labels, the gridlines, and
 * (on the bar/candlestick charts) the mark widths — flows from one thing: the
 * chart re-maps its scales from a shrinking *visible window*. The bars/candles
 * stretch because their width is derived from the projected pixel spacing between
 * neighbors, which grows as the window shrinks.
 */
@Component({
  selector: 'app-chart-zoom-demo',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, UiText, UiBadge, UiBarChart, UiCandlestickChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <view class="h-full w-full flex-col gap-3 bg-background p-4 flex">
      <!-- Header -->
      <view class="flex-row items-center gap-2 flex">
        <ui-text variant="h3">Chart Zoom</ui-text>
        <ui-badge variant="secondary">Interactive</ui-badge>
      </view>
      <ui-text variant="muted">
        Pinch or use the +/− controls to zoom, drag to pan, and 1:1 to reset.
        The axes, gridlines, and bar/candle widths all update live.
      </ui-text>

      <!-- Chart-type toggle (segmented). Custom views, like the gesture demo —
           swapping the whole chart is the clearest way to show the shared
           foundation zooming both mark kinds. -->
      <view class="flex-row gap-2 flex">
        <view
          class="flex-1 items-center rounded-md border px-3 py-1.5 flex justify-center {{
            chartType() === 'candles'
              ? 'border-primary bg-primary'
              : 'border-border bg-card'
          }}"
          (bindtap)="chartType.set('candles')"
        >
          <text
            class="text-sm font-medium {{
              chartType() === 'candles'
                ? 'text-primary-foreground'
                : 'text-foreground'
            }}"
            >Candles</text
          >
        </view>
        <view
          class="flex-1 items-center rounded-md border px-3 py-1.5 flex justify-center {{
            chartType() === 'bar'
              ? 'border-primary bg-primary'
              : 'border-border bg-card'
          }}"
          (bindtap)="chartType.set('bar')"
        >
          <text
            class="text-sm font-medium {{
              chartType() === 'bar'
                ? 'text-primary-foreground'
                : 'text-foreground'
            }}"
            >Bar</text
          >
        </view>
      </view>

      <!-- Axis-lock toggle — demonstrates zoomAxes. 'X' alone stretches the
           candles/bars apart horizontally without touching the value scale. -->
      <view class="flex-row items-center gap-2 flex">
        <text class="text-xs text-muted-foreground">Axes</text>
        @for (opt of axisOptions; track opt.value) {
          <view
            class="items-center rounded-md border px-3 py-1 flex justify-center {{
              axes() === opt.value
                ? 'border-primary bg-secondary'
                : 'border-border bg-card'
            }}"
            (bindtap)="axes.set(opt.value)"
          >
            <text class="text-xs font-medium text-foreground">{{
              opt.label
            }}</text>
          </view>
        }
      </view>

      <!-- The zoomable chart. flex-1 claims the remaining height so it stays
           large on any device. Swapped by the toggle above; each is recreated at
           rest (fully zoomed out) when you switch. -->
      <view
        class="flex-1 items-center rounded-xl border border-dashed border-border bg-card p-3 flex justify-center"
      >
        @if (chartType() === 'candles') {
          <ui-candlestick-chart
            [data]="prices"
            [width]="300"
            [height]="240"
            [zoomable]="true"
            [zoomAxes]="axes()"
            [showXGrid]="true"
          />
        } @else {
          <ui-bar-chart
            [data]="revenue"
            [width]="300"
            [height]="240"
            [zoomable]="true"
            [zoomAxes]="axes()"
            [showXGrid]="true"
          />
        }
      </view>
    </view>
  `,
})
export class ChartZoomDemo {
  readonly chartType = signal<ChartType>('candles');
  readonly axes = signal<ZoomAxes>('xy');

  readonly axisOptions: ReadonlyArray<{ value: ZoomAxes; label: string }> = [
    { value: 'xy', label: 'Both' },
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
  ];

  // A longer OHLC series than the basic demo so there's plenty to zoom into.
  readonly prices: CandlestickPoint[] = [
    { x: 1, open: 100, high: 108, low: 98, close: 106 },
    { x: 2, open: 106, high: 110, low: 103, close: 104 },
    { x: 3, open: 104, high: 105, low: 96, close: 98 },
    { x: 4, open: 98, high: 102, low: 95, close: 101 },
    { x: 5, open: 101, high: 112, low: 100, close: 110 },
    { x: 6, open: 110, high: 115, low: 108, close: 109 },
    { x: 7, open: 109, high: 111, low: 102, close: 103 },
    { x: 8, open: 103, high: 107, low: 101, close: 107 },
    { x: 9, open: 107, high: 113, low: 105, close: 112 },
    { x: 10, open: 112, high: 118, low: 110, close: 111 },
    { x: 11, open: 111, high: 114, low: 104, close: 106 },
    { x: 12, open: 106, high: 109, low: 100, close: 108 },
  ];

  // Month index → revenue ($k); a plain positive series for the bar variant.
  readonly revenue: ChartPoint[] = [
    { x: 1, y: 42 },
    { x: 2, y: 58 },
    { x: 3, y: 71 },
    { x: 4, y: 49 },
    { x: 5, y: 83 },
    { x: 6, y: 66 },
    { x: 7, y: 74 },
    { x: 8, y: 91 },
    { x: 9, y: 63 },
    { x: 10, y: 88 },
    { x: 11, y: 52 },
    { x: 12, y: 79 },
  ];
}

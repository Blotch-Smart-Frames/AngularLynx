import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiScatterChart,
  UiScatterSeries,
} from '../../components/ui/scatter-chart';
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
 * Scatter Chart demo.
 *
 * A scatter mark is a single dot (a `<view>` with a 50% border-radius) at each
 * (x, y) — the simplest chart mark of all, so dots draw straight onto the
 * reusable `UiCartesianChart`. `UiScatterChart` is the single-series wrapper; the
 * regression card drops to the base `UiCartesianChart` and layers a
 * `UiLineSeries` under a `UiScatterSeries`, both reading the same shared scales.
 * Per-point `colors` make a categorical scatter and per-point `sizes` a bubble
 * chart.
 *
 * 280px fits inside a card on every current iPhone: screen p-4 (32px) +
 * card-content p-4 (32px) leaves ~311px on the narrowest 375px device.
 */
@Component({
  selector: 'app-scatter-chart-demo',
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
    UiScatterChart,
    UiScatterSeries,
    UiCartesianChart,
    UiLineSeries,
  ],
  template: `
    <app-demo-screen
      heading="Scatter Chart"
      category="Components"
      description="A scatter plot drawn entirely from Lynx views — one dot per point, on the reusable BaseCartesianChart."
    >
      <!-- ── Basic: single series via the convenience wrapper ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="circle" size="sm" />
            <ui-card-title class="text-lg">Basic</ui-card-title>
          </view>
          <ui-card-description>
            Pass x/y points; each is drawn as a dot and the axes round
            themselves (with a small inset so edge dots aren't clipped).
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-scatter-chart
            [data]="measurements"
            [width]="280"
            [height]="200"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Per-point categorical colors: two groups ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Two groups</ui-card-title>
          </view>
          <ui-card-description>
            colors tints each dot by index — here the first five points are one
            group, the rest another.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-scatter-chart
            [data]="clusters"
            [width]="280"
            [height]="200"
            [colors]="clusterColors"
            [radius]="5"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Bubble chart: per-point sizes ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Bubble chart</ui-card-title>
          </view>
          <ui-card-description>
            sizes gives each dot its own radius, encoding a third value as the
            bubble's area.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-scatter-chart
            [data]="measurements"
            [width]="280"
            [height]="200"
            [sizes]="bubbleSizes"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Scatter + regression line, on the base component ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-card-title class="text-lg">Regression line</ui-card-title>
          </view>
          <ui-card-description>
            Drop to the base &lt;ui-cartesian-chart&gt; and layer a
            &lt;ui-line-series&gt; under the dots — both share the same axes.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-cartesian-chart
            [xDomain]="[0, 11]"
            [yDomain]="[0, 14]"
            [xTicks]="[0, 2, 4, 6, 8, 10]"
            [yTicks]="[0, 4, 8, 12]"
            [width]="280"
            [height]="200"
          >
            <ui-line-series
              [data]="regression"
              [color]="amber"
              [strokeWidth]="2"
              [showDots]="false"
            />
            <ui-scatter-series [data]="measurements" [radius]="4" />
          </ui-cartesian-chart>
          <!-- Legend. Data hues are fixed (not theme chrome), so raw rgba(). -->
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view
                class="h-2.5 w-2.5 rounded-full"
                [style]="'background-color: ' + amber"
              />
              <text class="text-xs text-muted-foreground">
                Least-squares fit
              </text>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Interactive: tap a point ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="plus" size="sm" />
            <ui-card-title class="text-lg">Tap a point</ui-card-title>
          </view>
          <ui-card-description>
            Each dot is tappable; pointTap emits the x/y point that was hit.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-scatter-chart
            [data]="measurements"
            [width]="280"
            [height]="200"
            [radius]="6"
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
export class ScatterChartDemo {
  // A positively-correlated cloud — dose vs response, good for a regression line.
  readonly measurements: ChartPoint[] = [
    { x: 1, y: 3 },
    { x: 2, y: 4 },
    { x: 3, y: 4 },
    { x: 4, y: 6 },
    { x: 5, y: 5 },
    { x: 6, y: 8 },
    { x: 7, y: 7 },
    { x: 8, y: 10 },
    { x: 9, y: 9 },
    { x: 10, y: 12 },
  ];

  // Two visually-separate groups; the first five points are group A, the rest B.
  readonly clusters: ChartPoint[] = [
    { x: 1, y: 2 },
    { x: 2, y: 3 },
    { x: 1.5, y: 2.5 },
    { x: 2.5, y: 2 },
    { x: 1, y: 3 },
    { x: 7, y: 8 },
    { x: 8, y: 9 },
    { x: 7.5, y: 8.5 },
    { x: 8.5, y: 8 },
    { x: 7, y: 9 },
  ];

  // One color per point, indexed to group membership (blue = A, orange = B).
  // Data hues stay fixed across light/dark mode (they encode a group, not theme
  // chrome), so raw rgba() is the right call.
  readonly clusterColors = [
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(59, 130, 246, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
    'rgba(249, 115, 22, 1)',
  ];

  // Per-point radii (px) — a bubble chart. Indexed 1:1 with `measurements`.
  readonly bubbleSizes = [4, 6, 5, 9, 7, 12, 8, 14, 10, 16];

  readonly amber = 'rgba(245, 158, 11, 1)';

  // Least-squares fit of the measurements, as two endpoints spanning the x-range.
  readonly regression: ChartPoint[] = (() => {
    const pts = this.measurements;
    const n = pts.length;
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    const xs = pts.map((p) => p.x);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return [
      { x: lo, y: slope * lo + intercept },
      { x: hi, y: slope * hi + intercept },
    ];
  })();

  readonly #tapped = signal<ChartPoint | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: (${point.x}, ${point.y})`
      : 'Tap any point on the chart above.';
  });

  protected onPointTap(point: ChartPoint): void {
    this.#tapped.set(point);
  }
}

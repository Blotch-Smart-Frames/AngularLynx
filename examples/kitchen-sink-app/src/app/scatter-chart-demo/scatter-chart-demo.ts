import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import {
  defineChart,
  dot,
  linearRegressionY,
} from '@tanstack/charts/universal';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiChart, type XYDatum, tooltip } from '../../components/ui/chart';
import { UiIcon } from '../../components/ui/icon';
import { UiScatterChart } from '../../components/ui/scatter-chart';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Scatter Chart demo.
 *
 * `<ui-scatter-chart>` is a preset over TanStack's `dot` mark: per-point
 * `colors` make a categorical scatter and per-point `sizes` a bubble chart. The
 * regression card composes `dot` with `linearRegressionY` on `<ui-chart>`,
 * which fits the line (and its confidence band) from the same rows, so there
 * are no hand-computed endpoints to keep in sync with the data.
 *
 * The charts fill the card's width and only set a height, so they fit any
 * screen without per-device pixel math.
 */
@Component({
  selector: 'app-scatter-chart-demo',
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
    UiChart,
    UiScatterChart,
  ],
  template: `
    <app-demo-screen
      heading="Scatter Chart"
      category="Components"
      description="A scatter plot preset built on TanStack Charts: one dot per point, with per-point colors and sizes."
    >
      <!-- ── Basic: single series via the preset ── -->
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
            [height]="200"
            label="Response by dose"
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
            [height]="200"
            [colors]="clusterColors"
            [radius]="5"
            label="Two clusters of points"
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
            bubble's size.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-scatter-chart
            [data]="measurements"
            [height]="200"
            [sizes]="bubbleSizes"
            color="var(--chart-2)"
            label="Response by dose, sized by sample count"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Scatter + regression line, composed on <ui-chart> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="trending-up" size="sm" />
            <ui-card-title class="text-lg">Regression line</ui-card-title>
          </view>
          <ui-card-description>
            Compose dot with linearRegressionY and render them with
            &lt;ui-chart&gt;: it fits a least-squares line and its 95%
            confidence band from the same points.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="withRegression"
            [height]="200"
            label="Response by dose with a least-squares fit"
          />
          <!-- A hand-made legend: the swatch classes use the same theme
               tokens as the marks, so both switch together in dark mode. -->
          <view class="flex-row gap-4 flex">
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-2.5 w-2.5 rounded-full bg-primary"></view>
              <text class="text-xs text-muted-foreground">Measurements</text>
            </view>
            <view class="flex-row items-center gap-1.5 flex">
              <view class="h-0.5 w-3 rounded-full bg-chart-1"></view>
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
            pointTap emits the x/y point nearest the tap.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-scatter-chart
            [data]="measurements"
            [height]="200"
            [radius]="6"
            label="Response by dose"
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
  readonly measurements: readonly XYDatum[] = [
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
  readonly clusters: readonly XYDatum[] = [
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

  // One color per point, indexed to group membership. Theme tokens, so each
  // group keeps a distinct hue from the dark palette in dark mode.
  readonly clusterColors = [
    ...Array<string>(5).fill('var(--chart-1)'),
    ...Array<string>(5).fill('var(--chart-2)'),
  ];

  // Per-point radii (px) — a bubble chart. Indexed 1:1 with `measurements`.
  readonly bubbleSizes = [4, 6, 5, 9, 7, 12, 8, 14, 10, 16];

  /**
   * The dots plus a fitted line. `linearRegressionY` draws the 95% band and
   * the line from the measurements themselves; only the line's samples take
   * focus, so touching it shows the fitted value at that dose. The dots are
   * listed last so they paint over the band and win a touch on a dot.
   */
  readonly withRegression = defineChart({
    marks: [
      linearRegressionY(this.measurements, {
        x: 'x',
        y: 'y',
        stroke: 'var(--chart-1)',
        strokeWidth: 2,
      }),
      dot(this.measurements, { x: 'x', y: 'y', r: 4, fill: 'var(--primary)' }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true, axis: { label: 'Dose' } },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: 'Response' },
      },
    },
    tooltip,
  });

  readonly #tapped = signal<XYDatum | null>(null);

  protected readonly tappedLabel = computed(() => {
    const point = this.#tapped();
    return point
      ? `Last tapped: (${point.x}, ${point.y})`
      : 'Tap any point on the chart above.';
  });

  protected onPointTap(point: XYDatum): void {
    this.#tapped.set(point);
  }
}

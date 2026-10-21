import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import type { ChartPoint } from '@tanstack/charts/types';
import {
  areaY,
  barX,
  barY,
  defineChart,
  dot,
  linearRegressionY,
  lineY,
  stackRowsY,
} from '@tanstack/charts/universal';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiChart, UiChartTooltip, tooltip } from '../../components/ui/chart';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/** One region's sales (in units of 1k) in one month: long-format rows. */
type RegionSales = {
  readonly month: string;
  readonly region: string;
  readonly sales: number;
};

/** Monthly active users (in 1k) per platform per quarter. */
type PlatformUsers = {
  readonly quarter: string;
  readonly platform: string;
  readonly users: number;
};

type ScreenVisits = {
  readonly screen: string;
  readonly visits: number;
};

type SessionLength = {
  readonly week: number;
  readonly minutes: number;
  readonly device: string;
};

/** A legend entry: the name and the Tailwind class of its `--chart-*` swatch. */
type LegendItem = {
  readonly name: string;
  readonly swatch: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const REGIONS = ['North', 'South', 'West'];
// Sales per month, one column per region in REGIONS order.
const REGION_SALES = [
  [12, 8, 5],
  [15, 9, 7],
  [14, 12, 9],
  [18, 11, 12],
  [21, 14, 13],
  [24, 16, 15],
];

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const PLATFORMS = ['iOS', 'Android', 'Web'];
// Users per quarter, one column per platform in PLATFORMS order.
const PLATFORM_USERS = [
  [12, 9, 5],
  [15, 11, 6],
  [18, 14, 6],
  [22, 16, 7],
];

/**
 * The series colors, as theme tokens. The chart resolves `var(--chart-n)` to
 * the light or dark palette when it draws, and the legends below use the
 * matching `bg-chart-n` classes, so marks and legend switch together.
 */
const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];
const SERIES_SWATCHES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3'];

const legendFor = (names: readonly string[]): LegendItem[] =>
  names.map((name, index) => ({ name, swatch: SERIES_SWATCHES[index]! }));

/**
 * Chart demo: `<ui-chart>` and TanStack Charts' primitives.
 *
 * The line, area, bar, scatter and candlestick charts are presets: each turns
 * its inputs into a TanStack Charts definition and renders it with
 * `<ui-chart>`. This screen skips the presets and writes definitions directly
 * (marks, scales, transforms and focus options), for the charts a preset
 * can't express: series keyed by a field, stacks, horizontal bars, per-group
 * regressions, and a tooltip body of your own.
 *
 * Every definition here is built once from constant data, so it's a plain
 * field. A definition that depends on signals would be a `computed()`, since
 * its identity is what tells the chart to re-render.
 */
@Component({
  selector: 'app-chart-demo',
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
    UiChartTooltip,
  ],
  template: `
    <app-demo-screen
      heading="Chart"
      category="Components"
      description="ui-chart renders any TanStack Charts definition. Compose marks, scales and transforms when a preset isn't enough; the presets are built the same way."
    >
      <!-- ── Several series from one mark, keyed by a field ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chart-line" size="sm" />
            <ui-card-title class="text-lg">Several series</ui-card-title>
          </view>
          <ui-card-description>
            One lineY over long-format rows: z: 'region' splits it into a line
            per region and the color scale paints each. focus: 'group-x' puts
            every region at the touched month in the tooltip.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="regionLines"
            [height]="200"
            label="Sales by month for North, South and West"
            (focusChange)="onFocusChange($event)"
          />
          <view class="flex-row flex-wrap gap-4 flex">
            @for (item of regionLegend; track item.name) {
              <view class="flex-row items-center gap-1.5 flex">
                <view
                  [class]="'h-2.5 w-2.5 rounded-full ' + item.swatch"
                ></view>
                <text class="text-xs text-muted-foreground">{{
                  item.name
                }}</text>
              </view>
            }
          </view>
          <view class="rounded-md bg-muted p-3 flex">
            <text class="text-xs text-muted-foreground">{{
              focusLabel()
            }}</text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Stacked area: a transform plus two marks ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="activity" size="sm" />
            <ui-card-title class="text-lg">Stacked area</ui-card-title>
          </view>
          <ui-card-description>
            stackRowsY() adds each row's stack bounds (y1, y2), so an areaY can
            fill between them and a lineY can trace each layer's top edge.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="regionStack"
            [height]="200"
            label="Sales by month, stacked by region"
          />
          <view class="flex-row flex-wrap gap-4 flex">
            @for (item of regionLegend; track item.name) {
              <view class="flex-row items-center gap-1.5 flex">
                <view
                  [class]="'h-2.5 w-2.5 rounded-full ' + item.swatch"
                ></view>
                <text class="text-xs text-muted-foreground">{{
                  item.name
                }}</text>
              </view>
            }
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Stacked bars with a custom tooltip body ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chart-column" size="sm" />
            <ui-card-title class="text-lg">Custom tooltip</ui-card-title>
          </view>
          <ui-card-description>
            barY stacks rows that share an x on its own. An &lt;ng-template
            uiChartTooltip&gt; replaces the tooltip's body; this one adds the
            quarter's total.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="platformStack"
            [height]="200"
            label="Monthly active users by quarter, stacked by platform"
          >
            <ng-template uiChartTooltip let-tooltip>
              <text class="text-xs font-medium text-card-foreground">{{
                tooltip.primaryPoint.xValue
              }}</text>
              @for (point of tooltip.points; track point.key) {
                <view class="flex-row items-center gap-1.5 flex">
                  <view
                    class="h-2 w-2 rounded-sm"
                    [style]="'background-color: ' + point.color"
                  ></view>
                  <text class="text-xs text-muted-foreground">{{
                    point.groupLabel
                  }}</text>
                  <text class="text-xs font-medium text-card-foreground"
                    >{{ point.yValue }}k</text
                  >
                </view>
              }
              <view
                class="flex-row items-center gap-1.5 border-t border-border pt-1 flex"
              >
                <text class="text-xs text-muted-foreground">Total</text>
                <text class="text-xs font-semibold text-card-foreground"
                  >{{ totalOf(tooltip.points) }}k</text
                >
              </view>
            </ng-template>
          </ui-chart>
          <view class="flex-row flex-wrap gap-4 flex">
            @for (item of platformLegend; track item.name) {
              <view class="flex-row items-center gap-1.5 flex">
                <view
                  [class]="'h-2.5 w-2.5 rounded-full ' + item.swatch"
                ></view>
                <text class="text-xs text-muted-foreground">{{
                  item.name
                }}</text>
              </view>
            }
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Horizontal bars: barX on a band y scale ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chart-bar" size="sm" />
            <ui-card-title class="text-lg">Horizontal bars</ui-card-title>
          </view>
          <ui-card-description>
            barX swaps the axes: the band scale goes on y, the values on x.
            radius: &#123; end: 4 &#125; rounds only the value end, and the
            tooltip's items name its rows.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <ui-chart
            [definition]="screenBars"
            [height]="200"
            label="Visits by screen"
          />
        </ui-card-content>
      </ui-card>

      <!-- ── Scatter with a regression line per group ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="trending-up" size="sm" />
            <ui-card-title class="text-lg">Regression by group</ui-card-title>
          </view>
          <ui-card-description>
            dot colored by device, plus linearRegressionY with z: 'device',
            which fits one least-squares line (and confidence band) per group.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <ui-chart
            [definition]="sessionFits"
            [height]="200"
            label="Session length by week for phones and tablets, with trend lines"
          />
          <view class="flex-row flex-wrap gap-4 flex">
            @for (item of deviceLegend; track item.name) {
              <view class="flex-row items-center gap-1.5 flex">
                <view
                  [class]="'h-2.5 w-2.5 rounded-full ' + item.swatch"
                ></view>
                <text class="text-xs text-muted-foreground">{{
                  item.name
                }}</text>
              </view>
            }
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class ChartDemo {
  readonly regionLegend = legendFor(REGIONS);
  readonly platformLegend = legendFor(PLATFORMS);
  readonly deviceLegend = legendFor(['Phones', 'Tablets']);

  readonly sales: readonly RegionSales[] = MONTHS.flatMap((month, row) =>
    REGIONS.map((region, column) => ({
      month,
      region,
      sales: REGION_SALES[row]![column]!,
    })),
  );

  readonly users: readonly PlatformUsers[] = QUARTERS.flatMap((quarter, row) =>
    PLATFORMS.map((platform, column) => ({
      quarter,
      platform,
      users: PLATFORM_USERS[row]![column]!,
    })),
  );

  readonly screens: readonly ScreenVisits[] = [
    { screen: 'Home', visits: 420 },
    { screen: 'Search', visits: 310 },
    { screen: 'Profile', visits: 240 },
    { screen: 'Cart', visits: 180 },
    { screen: 'Settings', visits: 90 },
  ];

  readonly sessions: readonly SessionLength[] = [
    { week: 1, minutes: 4, device: 'Phones' },
    { week: 2, minutes: 5.5, device: 'Phones' },
    { week: 3, minutes: 5, device: 'Phones' },
    { week: 4, minutes: 7, device: 'Phones' },
    { week: 5, minutes: 7.5, device: 'Phones' },
    { week: 6, minutes: 9, device: 'Phones' },
    { week: 1, minutes: 8, device: 'Tablets' },
    { week: 2, minutes: 8.5, device: 'Tablets' },
    { week: 3, minutes: 10, device: 'Tablets' },
    { week: 4, minutes: 10.5, device: 'Tablets' },
    { week: 5, minutes: 12, device: 'Tablets' },
    { week: 6, minutes: 12.5, device: 'Tablets' },
  ];

  /**
   * One mark draws all three lines: `z` groups the rows into paths and also
   * names each point's series for the tooltip. The explicit color scale pins
   * each region to a token, so the legend stays right whatever order the rows
   * arrive in. A point scale spaces the months evenly, as categories.
   */
  readonly regionLines = defineChart({
    marks: [
      lineY(this.sales, {
        x: 'month',
        y: 'sales',
        z: 'region',
        strokeWidth: 2,
        points: true,
      }),
    ],
    scales: {
      x: { scale: () => scalePoint().padding(0.3) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    color: { domain: REGIONS, range: SERIES_COLORS },
    focus: 'group-x',
    tooltip,
  });

  /**
   * `stackRowsY` is an eager transform: it returns the rows with each one's
   * stack bounds added, `y1` (lower) and `y2` (upper). The implicit stacking
   * `areaY` does on its own would fill the layers too, but the lines need the
   * upper bounds as data, so both marks read these rows.
   */
  readonly stackedSales = stackRowsY(this.sales, {
    x: 'month',
    y: 'sales',
    z: 'region',
  });

  /**
   * The layers and their top edges. Both marks share `z`, so the grouped
   * tooltip lists each region once, with its own (unstacked) value.
   */
  readonly regionStack = defineChart({
    marks: [
      areaY(this.stackedSales, {
        x: 'month',
        y1: 'y1',
        y2: 'y2',
        z: 'region',
        fillOpacity: 0.3,
      }),
      lineY(this.stackedSales, {
        x: 'month',
        y: 'y2',
        z: 'region',
        strokeWidth: 2,
      }),
    ],
    scales: {
      // No padding: the stack fills the plot edge to edge.
      x: { scale: scalePoint },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    color: { domain: REGIONS, range: SERIES_COLORS },
    focus: 'group-x',
    tooltip,
  });

  /**
   * barY stacks rows with the same x by their `z` without any transform; the
   * round corners go on the top of each stack only. The tooltip body comes
   * from the template, which gets the whole quarter's points via group-x.
   */
  readonly platformStack = defineChart({
    marks: [
      barY(this.users, {
        x: 'quarter',
        y: 'users',
        z: 'platform',
        radius: { end: 4 },
      }),
    ],
    scales: {
      x: { scale: () => scaleBand().padding(0.3) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    color: { domain: PLATFORMS, range: SERIES_COLORS },
    focus: 'group-x',
    tooltip,
  });

  /**
   * The categories go on a band scale on y; barX grows each bar from 0 along
   * x. Without a series (`z`) the default tooltip would label its rows by
   * channel ("x", "y"), so `items` names them.
   */
  readonly screenBars = defineChart({
    marks: [
      barX(this.screens, {
        x: 'visits',
        y: 'screen',
        fill: 'var(--chart-2)',
        radius: { end: 4 },
      }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true, grid: true },
      y: { scale: () => scaleBand().padding(0.25) },
    },
    tooltip: {
      use: tooltip,
      items: [
        { channel: 'y', label: 'Screen' },
        { channel: 'x', label: 'Visits' },
      ],
    },
  });

  /**
   * The regression mark draws a confidence band and a fitted line per `z`
   * group, colored through the same scale as the dots. Dots are listed last
   * so they paint over the bands and win a touch.
   */
  readonly sessionFits = defineChart({
    marks: [
      linearRegressionY(this.sessions, {
        x: 'week',
        y: 'minutes',
        z: 'device',
        strokeWidth: 2,
      }),
      dot(this.sessions, { x: 'week', y: 'minutes', color: 'device', r: 4 }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true, axis: { label: 'Week' } },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: { label: 'Minutes' },
      },
    },
    color: { domain: ['Phones', 'Tablets'], range: SERIES_COLORS.slice(0, 2) },
    tooltip,
  });

  readonly #focused = signal<ChartPoint | null>(null);

  protected readonly focusLabel = computed(() => {
    const point = this.#focused();
    return point
      ? `Focused: ${point.groupLabel}, ${String(point.xValue)} — ${String(point.yValue)}k`
      : 'Scrub across the chart: focusChange reports the focused point.';
  });

  /**
   * Only a <text> binding changes, so setting the signal straight from the
   * touch callback is safe (no elements are added or removed).
   */
  protected onFocusChange(point: ChartPoint | null): void {
    this.#focused.set(point);
  }

  /**
   * The quarter's total: the stacked segments' own values, summed.
   */
  protected totalOf(points: readonly ChartPoint[]): number {
    return points.reduce((sum, point) => sum + Number(point.yValue), 0);
  }
}

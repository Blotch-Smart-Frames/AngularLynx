import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import type { ChartPoint } from '@tanstack/charts/types';
import {
  areaY,
  barX,
  barY,
  d3Curve,
  defineChart,
  dot,
  linearRegressionY,
  lineY,
  ruleY,
  stack,
} from '@tanstack/charts/universal';
import { curveMonotoneX } from 'd3-shape';
import { UiChart, UiChartTooltip, tooltip } from '../components/ui/chart';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

const revenue = months.map((month, i) => ({
  month,
  value: [42, 58, 71, 49, 83, 66][i]!,
}));

// One row per month and series: TanStack charts plot "long" data, with the
// series as a column (z / color) rather than one array per series.
const platforms = months.flatMap((month, i) => [
  { month, platform: 'iOS', users: [32, 38, 41, 47, 52, 58][i]! },
  { month, platform: 'Android', users: [28, 31, 37, 36, 44, 49][i]! },
  { month, platform: 'Web', users: [12, 14, 13, 18, 21, 19][i]! },
]);

const languages = [
  { name: 'TypeScript', share: 38 },
  { name: 'Kotlin', share: 24 },
  { name: 'Swift', share: 21 },
  { name: 'C++', share: 11 },
  { name: 'Other', share: 6 },
];

const measurements = [
  { x: 1, y: 2.1 },
  { x: 2, y: 3.9 },
  { x: 3, y: 3.2 },
  { x: 4, y: 5.8 },
  { x: 5, y: 5.1 },
  { x: 6, y: 7.4 },
  { x: 7, y: 6.6 },
  { x: 8, y: 8.9 },
  { x: 9, y: 8.2 },
  { x: 10, y: 10.4 },
];

// Sixty days of a steady trend with a weekly wobble, for pan and zoom.
const daily = Array.from({ length: 60 }, (_, day) => ({
  day,
  value: 50 + day * 0.6 + 8 * Math.sin(day / 1.1),
}));

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiChart, UiChartTooltip],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Chart</text>
        <text class="text-sm text-muted-foreground">
          Any TanStack Charts definition, drawn natively. Compose marks, scales
          and transforms; touch to inspect, tap to pin.
        </text>

        <!-- Marks and scales: a band scale lays the bars out by category -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Bars</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="bars"
              [height]="180"
              label="Revenue by month"
              (pointSelect)="selected.set($event)"
            />
          </view>
          <view class="rounded-md bg-muted p-3">
            <text class="text-xs text-muted-foreground">{{
              selectedLabel()
            }}</text>
          </view>
        </view>

        <!-- Several series from one mark, grouped in the tooltip -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Series</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="series"
              [height]="180"
              label="Monthly users by platform"
            />
          </view>
          <view class="flex-row gap-4 flex">
            @for (item of legend; track item.label) {
              <view class="flex-row items-center gap-1.5 flex">
                <view
                  [class]="'h-2.5 w-2.5 rounded-full ' + item.swatch"
                ></view>
                <text class="text-xs text-muted-foreground">{{
                  item.label
                }}</text>
              </view>
            }
          </view>
        </view>

        <!-- A stacking layout: each layer sits on the ones below -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Stacked area</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="stacked"
              [height]="180"
              label="Users by platform, stacked"
            />
          </view>
        </view>

        <!-- Swap the axes: barX with a band scale on y -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground"
            >Horizontal bars</text
          >
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="horizontal"
              [height]="180"
              label="Share of code by language"
            />
          </view>
        </view>

        <!-- Polar coordinates: pie() turns totals into arcs -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Donut</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="donut"
              [height]="200"
              label="Share of code by language"
            />
          </view>
        </view>

        <!-- A transform mark: a least-squares fit over the same data -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">
            Scatter with a trend line
          </text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="trend"
              [height]="180"
              label="Measurements with a fitted line"
            />
          </view>
        </view>

        <!-- Native tooltip content from a template -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground"
            >Custom tooltip</text
          >
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="bars"
              [height]="180"
              label="Revenue by month"
            >
              <ng-template uiChartTooltip let-tooltip>
                <text class="text-xs font-medium text-card-foreground">
                  {{ tooltip.primaryPoint.xValue }}
                </text>
                <text class="text-lg font-bold text-card-foreground">
                  {{ '$' + tooltip.primaryPoint.yValue + 'k' }}
                </text>
              </ng-template>
            </ui-chart>
          </view>
        </view>

        <!-- The viewport of a continuous axis, driven by drag and the buttons -->
        <view class="flex-col gap-2 flex">
          <text class="text-sm font-medium text-foreground">Pan and zoom</text>
          <view class="rounded-lg border border-border bg-card p-4">
            <ui-chart
              [definition]="zoomable"
              [height]="200"
              [zoomable]="true"
              zoomAxes="x"
              label="Daily value, zoomable"
            />
          </view>
          <text class="text-xs text-muted-foreground">
            Zoom in with +, then drag sideways to pan.
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly bars = defineChart({
    marks: [
      barY(revenue, {
        x: 'month',
        y: 'value',
        fill: 'var(--primary)',
        radius: 4,
      }),
      ruleY([0]),
    ],
    scales: {
      x: { scale: () => scaleBand().padding(0.25) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    tooltip,
  });

  // `z` splits the rows into one line per platform and `color` gives each a
  // palette color; `group-x` focuses every platform at the touched month.
  readonly series = defineChart({
    marks: [
      lineY(platforms, {
        x: 'month',
        y: 'users',
        z: 'platform',
        color: 'platform',
        strokeWidth: 2,
        curve: d3Curve(curveMonotoneX),
      }),
    ],
    scales: {
      x: { scale: () => scalePoint<string>().padding(0.2) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    focus: 'group-x',
    tooltip,
  });

  readonly legend = [
    { label: 'iOS', swatch: 'bg-chart-1' },
    { label: 'Android', swatch: 'bg-chart-2' },
    { label: 'Web', swatch: 'bg-chart-3' },
  ];

  readonly stacked = defineChart({
    marks: [
      areaY(platforms, {
        x: 'month',
        y: 'users',
        color: 'platform',
        layout: stack({ order: ['iOS', 'Android', 'Web'] }),
        fillOpacity: 0.85,
      }),
      ruleY([0]),
    ],
    scales: {
      x: { scale: () => scalePoint<string>() },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    focus: 'group-x',
    tooltip,
  });

  readonly horizontal = defineChart({
    marks: [
      barX(languages, {
        x: 'share',
        y: 'name',
        fill: 'var(--chart-2)',
        radius: 3,
      }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true, grid: true },
      y: { scale: () => scaleBand().padding(0.2) },
    },
    tooltip,
  });

  readonly donut = defineChart({
    marks: [
      polar({
        inset: 8,
        radiusRatio: 0.9,
        marks: [
          radialArc(pie(languages, { value: 'share' }), {
            innerRadius: ({ radius }) => radius * 0.6,
            cornerRadius: 4,
            color: 'name',
            key: 'name',
          }),
        ],
        scales: { angle: null, radius: null },
      }),
    ],
    scales: { x: null, y: null },
    tooltip,
  });

  readonly trend = defineChart({
    marks: [
      dot(measurements, { x: 'x', y: 'y', r: 4, fill: 'var(--chart-1)' }),
      linearRegressionY(measurements, {
        x: 'x',
        y: 'y',
        stroke: 'var(--primary)',
      }),
    ],
    scales: {
      x: { scale: scaleLinear, nice: true },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    tooltip,
  });

  // Zooming works on the continuous axes a definition configures, through
  // their scale's viewport.
  readonly zoomable = defineChart({
    marks: [
      lineY(daily, {
        x: 'day',
        y: 'value',
        stroke: 'var(--chart-2)',
        strokeWidth: 2,
      }),
    ],
    scales: {
      x: { scale: scaleLinear().domain([0, 59]) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
    tooltip,
  });

  readonly selected = signal<ChartPoint | null>(null);

  protected readonly selectedLabel = computed(() => {
    const point = this.selected();
    return point
      ? `Tapped ${point.xValue}: $${point.yValue}k`
      : 'Tap a bar to select it.';
  });
}

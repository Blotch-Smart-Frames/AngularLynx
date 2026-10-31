import {
  Component,
  Injector,
  type Type,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { defineChart, dot } from '@tanstack/charts/universal';
import { describe, expect, it } from 'vitest';
import { UiChart, tooltip } from './chart';
import {
  type CartesianPresetOptions,
  PRESET_CHART_BINDINGS,
  UiCartesianPreset,
  type XYDatum,
  linearAxis,
  minSpacing,
  presetAxes,
} from './chart-presets';

/**
 * The configured domain of an axis config's scale instance.
 */
const domainOf = (axis: { scale: unknown }): number[] =>
  (axis.scale as { domain: () => number[] }).domain();

describe('linearAxis', () => {
  const base = { tickCount: 5, grid: true };

  it('fits the data and rounds out to nice values', () => {
    expect(domainOf(linearAxis({ ...base, values: [3, 47] }))).toEqual([0, 50]);
  });

  it('keeps fixed ends exact and rounds only the free one', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [3, 47], min: 1, max: 2 })),
    ).toEqual([1, 2]);
    expect(domainOf(linearAxis({ ...base, values: [3, 47], min: 1 }))).toEqual([
      1, 50,
    ]);
  });

  it('includes extra values, such as a baseline', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [5, 10], include: [0] })),
    ).toEqual([0, 10]);
  });

  it('gives flat and empty data a span around the value', () => {
    expect(domainOf(linearAxis({ ...base, values: [10, 10] }))).toEqual([
      4, 16,
    ]);
    expect(domainOf(linearAxis({ ...base, values: [0] }))).toEqual([-1, 1]);
    expect(domainOf(linearAxis({ ...base, values: [] }))).toEqual([0, 1]);
    expect(domainOf(linearAxis({ ...base, values: [Number.NaN] }))).toEqual([
      0, 1,
    ]);
  });

  it('orders reversed fixed ends', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [], min: 10, max: 0 })),
    ).toEqual([0, 10]);
  });

  it('widens by a margin, then by padding fractions', () => {
    expect(
      domainOf(linearAxis({ ...base, values: [], min: 0, max: 10, margin: 1 })),
    ).toEqual([-1, 11]);
    // 10% each side of a 0–8 domain: the plot spans 10 units, inset 1 each side.
    const [lo, hi] = domainOf(
      linearAxis({ ...base, values: [], min: 0, max: 8, padding: [0.1, 0.1] }),
    );
    expect(lo).toBeCloseTo(-1);
    expect(hi).toBeCloseTo(9);
    // Padding that leaves no plot is ignored.
    expect(
      domainOf(
        linearAxis({
          ...base,
          values: [],
          min: 0,
          max: 8,
          padding: [0.6, 0.6],
        }),
      ),
    ).toEqual([0, 8]);
  });

  it('configures grid, label and ticks', () => {
    const format = (value: number) => `${value}%`;
    const axis = linearAxis({
      ...base,
      values: [0, 1],
      label: 'Share',
      format,
      grid: false,
    });
    expect(axis.grid).toBe(false);
    expect(axis.axis).toEqual({ label: 'Share', ticks: { count: 5, format } });
    expect(
      (
        linearAxis({ ...base, values: [0, 1], label: '' }).axis as {
          label?: string;
        }
      ).label,
    ).toBeUndefined();
  });
});

describe('minSpacing', () => {
  it('finds the smallest gap between distinct values', () => {
    expect(minSpacing([5, 1, 3, 3, 4])).toBe(1);
    expect(minSpacing([0, 10])).toBe(10);
  });

  it('defaults to 1 without a gap', () => {
    expect(minSpacing([])).toBe(1);
    expect(minSpacing([2])).toBe(1);
    expect(minSpacing([2, 2])).toBe(1);
  });
});

describe('presetAxes', () => {
  it('maps the shared options onto both axes', () => {
    const axes = presetAxes(
      {
        tickCount: 3,
        showGrid: false,
        showXGrid: true,
        xAxisLabel: 'X',
        yAxisLabel: 'Y',
        padding: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
        xMin: 0,
        xMax: 8,
        yMin: 0,
        yMax: 8,
      },
      { x: [], y: [], xMargin: 0 },
    );
    expect(axes.x.grid).toBe(true);
    expect(axes.y.grid).toBe(false);
    expect(axes.x.axis).toMatchObject({ label: 'X', ticks: { count: 3 } });
    expect(axes.y.axis).toMatchObject({ label: 'Y' });
    expect(domainOf(axes.x)[0]).toBeCloseTo(-1);
    expect(domainOf(axes.y)[1]).toBeCloseTo(9);
  });

  it('defaults to five ticks, a y grid and no padding', () => {
    const axes = presetAxes({}, { x: [0, 10], y: [0, 10], yInclude: [-5] });
    expect(axes.x.grid).toBe(false);
    expect(axes.y.grid).toBe(true);
    expect(domainOf(axes.x)).toEqual([0, 10]);
    expect(domainOf(axes.y)).toEqual([-10, 10]);
  });
});

/**
 * The smallest preset: a dot per datum on the shared axes, built the way the
 * library's presets (`<ui-line-chart>`, …) build theirs.
 */
@Component({
  selector: 'test-dot-chart',
  imports: [UiChart],
  template: `
    <ui-chart
      #chart
      [definition]="definition()"
      ${PRESET_CHART_BINDINGS}
      (pointSelect)="pointTap.emit(datumOf($event))"
    />
  `,
})
class DotChart extends UiCartesianPreset<XYDatum> {
  readonly data = input.required<readonly XYDatum[]>();
  /** The tapped datum, or `null` for a tap on empty space. */
  readonly pointTap = output<XYDatum | null>();

  protected readonly definition = computed(() => {
    const options = this.commonOptions();
    const data = this.data();
    return defineChart({
      marks: [dot(data, { x: 'x', y: 'y' })],
      scales: presetAxes(options, {
        x: data.map((d) => d.x),
        y: data.map((d) => d.y),
      }),
      tooltip: options.tooltip === false ? false : tooltip,
    });
  });
}

@Component({
  imports: [DotChart],
  template: `
    <test-dot-chart
      [data]="data"
      [width]="300"
      [height]="160"
      label="Sales"
      class="mt-2"
      [xAxisLabel]="xAxisLabel()"
      yAxisLabel="Units"
      [zoomable]="true"
      zoomAxes="x"
      (pointTap)="tapped.push($event)"
    />
  `,
})
class PresetHost {
  readonly data: readonly XYDatum[] = [
    { x: 0, y: 100 },
    { x: 5, y: 300 },
    { x: 10, y: 500 },
  ];
  readonly xAxisLabel = signal('Day');
  /** Every `pointTap`, in order. */
  readonly tapped: (XYDatum | null)[] = [];
  readonly preset = viewChild.required(DotChart);
}

/**
 * The chart's own view, which takes every touch.
 */
const chartRoot = (container: Element) =>
  container.querySelector('[accessibility-label]')!;

/**
 * Where the chart drew each dot, read from its marks layer.
 */
const dotsDrawn = (container: Element) =>
  [
    ...container
      .querySelectorAll('svg')[1]!
      .getAttribute('content')!
      .matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g),
  ].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));

/**
 * Touches a spot and lifts the finger right there: a tap.
 */
const tap = async (root: Element, at: { x: number; y: number }) => {
  fireEvent.touchstart(root, { touches: [at] });
  fireEvent.touchend(root, { touches: [at] });
  await waitForUpdate();
};

describe('UiCartesianPreset', () => {
  it('starts every preset from the same defaults', () => {
    // Angular builds a preset through the base's factory, with the preset's
    // own type, so no preset runs that factory's default: build the base alone.
    const base = Injector.create({
      providers: [
        {
          provide: UiCartesianPreset,
          useClass: UiCartesianPreset as unknown as Type<
            UiCartesianPreset<XYDatum>
          >,
        },
      ],
    }).get(UiCartesianPreset);
    const options = (
      base as unknown as { commonOptions(): CartesianPresetOptions }
    ).commonOptions();
    expect(options).toEqual({
      tickCount: 5,
      showGrid: true,
      showXGrid: false,
      xAxisLabel: '',
      yAxisLabel: '',
      padding: {},
      xMin: undefined,
      xMax: undefined,
      yMin: undefined,
      yMax: undefined,
      xTickFormat: undefined,
      yTickFormat: undefined,
      tooltip: true,
    });
    expect(base.height()).toBe(200);
    expect(base.label()).toBe('Chart');
    expect(base.zoomable()).toBe(false);
    expect(base.zoomAxes()).toBe('xy');
  });

  it('passes the shared inputs through to its chart', async () => {
    const { container, componentRef, getByText } = await render(PresetHost);
    const root = chartRoot(container);
    expect(root.getAttribute('accessibility-label')).toBe('Sales');
    // The chart's box, which the root view fills.
    expect(root.parentElement!.getAttribute('style')).toContain(
      'height: 160px',
    );
    expect(getByText('Units')).toBeTruthy();
    expect(getByText('Day')).toBeTruthy();

    (componentRef.instance as PresetHost).xAxisLabel.set('Week');
    await waitForUpdate();
    expect(getByText('Week')).toBeTruthy();
  });

  // Angular gives a component's host every static attribute written on it,
  // so a preset that passed its class on to its chart as well applied it
  // twice (issue #181).
  it("puts its class on one element, the preset's own box", async () => {
    const { container } = await render(PresetHost);
    const box = chartRoot(container).parentElement!;
    expect([...container.querySelectorAll('.mt-2')]).toEqual([
      box.parentElement,
    ]);
    expect(box.parentElement!.classList).toContain('w-full');
  });

  it('hands a tap over as the datum, or null off the points', async () => {
    const { container, componentRef } = await render(PresetHost);
    const host = componentRef.instance as PresetHost;
    const root = chartRoot(container);
    const middle = dotsDrawn(container)[1]!;
    await tap(root, { x: middle.x + 1, y: middle.y + 1 });
    await tap(root, { x: -100, y: -100 });
    expect(host.tapped).toEqual([host.data[1], null]);
  });

  it('zooms its chart in and out, and resets it', async () => {
    const { componentRef, queryByText } = await render(PresetHost);
    const preset = (componentRef.instance as PresetHost).preset();
    // The x axis spans 0–10; zoomed in around the middle, its last tick goes.
    expect(queryByText('10')).not.toBeNull();
    preset.zoomIn();
    await waitForUpdate();
    expect(queryByText('10')).toBeNull();
    preset.zoomOut();
    await waitForUpdate();
    expect(queryByText('10')).not.toBeNull();

    preset.zoomIn();
    preset.resetZoom();
    await waitForUpdate();
    expect(queryByText('10')).not.toBeNull();
  });
});

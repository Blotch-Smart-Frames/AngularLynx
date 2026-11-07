import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import { createChartTooltipContent } from '@tanstack/charts/tooltip/model';
import type {
  ChartDefinition,
  ChartTooltipOptions,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it } from 'vitest';
import {
  type CandlestickDatum,
  UiCandlestickChart,
  candlestickChartDefinition,
} from './candlestick-chart';

const data = [
  { x: 0, open: 100, high: 104, low: 98, close: 102 },
  { x: 1, open: 102, high: 103, low: 97, close: 99 },
];

const render2 = (definition: ChartDefinition<any, any, any>) => {
  const scene = createChartRuntime().render(definition, {
    width: 300,
    height: 200,
  });
  const found: SceneNode[] = [];
  const walk = (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        if (!node.focus) walk(node.children);
      } else if (node.kind !== 'label') found.push(node);
    }
  };
  walk(scene.nodes);
  return { scene, found };
};

describe('candlestickChartDefinition', () => {
  it('draws a wick and a body per candle, colored by direction', () => {
    const { scene, found } = render2(candlestickChartDefinition({ data }));
    const bodies = found.filter((n) => n.kind === 'rect');
    expect(bodies.map((body) => body.style?.fill)).toEqual([
      'rgba(34, 197, 94, 1)',
      'rgba(239, 68, 68, 1)',
    ]);
    // The y axis spans the lows and highs.
    expect(scene.scales['y']!.domain[0]).toBeLessThanOrEqual(97);
    expect(scene.scales['y']!.domain[1]).toBeGreaterThanOrEqual(104);
    expect(found.some((n) => n.kind === 'rule' || n.kind === 'polyline')).toBe(
      true,
    );
  });

  it('lists all four prices in the tooltip', () => {
    const definition = candlestickChartDefinition({
      data,
      upColor: 'green',
      downColor: 'red',
    });
    const { scene } = render2(definition);
    const point = scene.points.find((p) => (p.datum as { x: number }).x === 1)!;
    const content = createChartTooltipContent(
      [point],
      scene,
      false,
      definition.tooltip as unknown as ChartTooltipOptions,
      point,
    );
    expect(content).toEqual({
      title: '1',
      color: 'red',
      rows: [
        { label: 'Open', value: '102' },
        { label: 'High', value: '103' },
        { label: 'Low', value: '97' },
        { label: 'Close', value: '99' },
      ],
    });
    const custom = (
      definition.tooltip as unknown as Required<ChartTooltipOptions>
    ).content;
    const context = {
      pinned: false,
      xLabel: 'x',
      yLabel: 'y',
      formatX: (v: unknown) => `x${v}`,
      formatY: (v: unknown) => `y${v}`,
    };
    expect(custom([], context)).toEqual({ title: undefined, rows: [] });
    // Points of other marks (say, a moving average added on top) get x/y rows.
    expect(
      custom(
        [{ datum: { x: 1, y: 2 }, xValue: 1, yValue: 2 } as never],
        context,
      ),
    ).toEqual({ title: 'x1', rows: [{ label: 'y', value: 'y2' }] });
    expect(
      custom([{ datum: null, xValue: 3, yValue: 4 } as never], context),
    ).toMatchObject({
      title: 'x3',
    });
    const up = scene.points.find((p) => (p.datum as { x: number }).x === 0)!;
    expect(
      createChartTooltipContent(
        [up],
        scene,
        false,
        definition.tooltip as unknown as ChartTooltipOptions,
        up,
      ),
    ).toMatchObject({ color: 'green' });
  });

  it('can drop the tooltip, and clamps the body ratio', () => {
    const definition = candlestickChartDefinition({
      data,
      tooltip: false,
      bodyWidthRatio: 5,
    });
    expect(definition.tooltip).toBe(false);
    expect(render2(definition).found.length).toBeGreaterThan(0);
  });
});

@Component({
  imports: [UiCandlestickChart],
  template: `
    <ui-candlestick-chart
      [data]="data"
      [width]="300"
      [upColor]="upColor()"
      downColor="red"
      (candleTap)="tapped.push($event)"
    />
  `,
})
class CandlestickChartHost {
  readonly data = data;
  readonly upColor = signal('green');
  /** Every `candleTap`, in order. */
  readonly tapped: CandlestickDatum[] = [];
}

/**
 * The SVG the chart's marks layer draws.
 */
const marksSvg = (container: Element) =>
  container.querySelectorAll('svg')[1]!.getAttribute('content')!;

/**
 * The middle of each candle body the chart drew.
 */
const bodiesDrawn = (container: Element) =>
  [
    ...marksSvg(container).matchAll(
      /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"[^>]*fill=/g,
    ),
  ].map(([, x, y, width, height]) => ({
    x: Number(x) + Number(width) / 2,
    y: Number(y) + Number(height) / 2,
  }));

/**
 * Touches a spot of the chart and lifts the finger right there: a tap.
 */
const tap = async (container: Element, at: { x: number; y: number }) => {
  const root = container.querySelector('[accessibility-label]')!;
  fireEvent.touchstart(root, { touches: [at] });
  fireEvent.touchend(root, { touches: [at] });
  await waitForUpdate();
};

describe('UiCandlestickChart', () => {
  it('colors each candle by direction with its inputs', async () => {
    const { componentRef, container } = await render(CandlestickChartHost);
    expect(bodiesDrawn(container)).toHaveLength(2);
    expect(marksSvg(container)).toContain('fill="green"');
    expect(marksSvg(container)).toContain('fill="red"');

    (componentRef.instance as CandlestickChartHost).upColor.set('blue');
    await waitForUpdate();
    expect(marksSvg(container)).toContain('fill="blue"');
  });

  it("emits a tapped candle's datum, and nothing for a tap off the candles", async () => {
    const { componentRef, container } = await render(CandlestickChartHost);
    const host = componentRef.instance as CandlestickChartHost;
    await tap(container, bodiesDrawn(container)[0]!);
    expect(host.tapped).toEqual([data[0]]);

    await tap(container, { x: -100, y: -100 });
    expect(host.tapped).toEqual([data[0]]);
  });
});

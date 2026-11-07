import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  SceneNode,
  SceneRect,
} from '@tanstack/charts/types';
import { describe, expect, it } from 'vitest';
import { type BarDatum, UiBarChart, barChartDefinition } from './bar-chart';

/**
 * Every bar in a definition's scene.
 */
const bars = (definition: ChartDefinition<any, any, any>) => {
  const scene = createChartRuntime().render(definition, {
    width: 300,
    height: 200,
  });
  const found: SceneRect[] = [];
  const walk = (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        if (!node.focus) walk(node.children);
      } else if (node.kind === 'rect') found.push(node);
    }
  };
  walk(scene.nodes);
  return { scene, found };
};

describe('barChartDefinition', () => {
  const week = [
    { x: 'Mon', y: 5 },
    { x: 'Tue', y: 8 },
    { x: 'Wed', y: 3 },
  ];

  it('puts category labels on a band scale', () => {
    const { scene, found } = bars(
      barChartDefinition({ data: week, radius: 4 }),
    );
    expect(found).toHaveLength(3);
    expect(scene.scales['x']!.bandwidth).toBeGreaterThan(0);
    expect(found[0]!.style?.fill).toBe('var(--primary)');
  });

  it('cycles per-bar colors on categories', () => {
    const { found } = bars(
      barChartDefinition({ data: week, colors: ['red', 'blue'] }),
    );
    expect(found.map((bar) => bar.style?.fill)).toEqual(['red', 'blue', 'red']);
  });

  it('sizes bars on a band scale by barWidthRatio, clamped to 0–1', () => {
    const wide = bars(
      barChartDefinition({
        data: week,
        barWidthRatio: 2,
        showXGrid: true,
        xAxisLabel: 'Day',
      }),
    );
    const narrow = bars(barChartDefinition({ data: week, barWidthRatio: 0.2 }));
    expect(narrow.found[0]!.width).toBeLessThan(wide.found[0]!.width);
  });

  const series = [
    { x: 0, y: 4 },
    { x: 1, y: -2 },
    { x: 3, y: 6 },
  ];

  it('places numeric bars at their values, the ratio of the smallest gap wide', () => {
    const { scene, found } = bars(
      barChartDefinition({ data: series, barWidthRatio: 0.5 }),
    );
    const x = scene.scales['x']!;
    expect(x.bandwidth).toBe(0);
    // The x axis has half a gap of room either side for the edge bars.
    expect(x.domain[0]).toBeLessThanOrEqual(-0.5);
    const unit = Math.abs(x.map(1) - x.map(0));
    // rect trims a hair off each edge, so allow a couple of pixels.
    expect(Math.abs(found[0]!.width - unit * 0.5)).toBeLessThan(2);
    // Negative values grow down from the baseline.
    expect(Math.abs(found[1]!.y - scene.scales['y']!.map(0))).toBeLessThan(1);
  });

  it('colors numeric bars through the color scale', () => {
    const { found } = bars(
      barChartDefinition({
        data: series,
        colors: ['red', 'blue'],
        tooltip: false,
      }),
    );
    expect(found.map((bar) => bar.style?.fill)).toEqual(['red', 'blue', 'red']);
  });
});

@Component({
  imports: [UiBarChart],
  template: `
    <ui-bar-chart
      [data]="data"
      [width]="300"
      [color]="color()"
      [radius]="4"
      (barTap)="tapped.push($event)"
    />
  `,
})
class BarChartHost {
  readonly data: readonly BarDatum[] = [
    { x: 'Mon', y: 5 },
    { x: 'Tue', y: 8 },
  ];
  readonly color = signal('red');
  /** Every `barTap`, in order. */
  readonly tapped: BarDatum[] = [];
}

/**
 * The SVG the chart's marks layer draws.
 */
const marksSvg = (container: Element) =>
  container.querySelectorAll('svg')[1]!.getAttribute('content')!;

/**
 * The middle of each bar the chart drew.
 */
const barsDrawn = (container: Element) =>
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

describe('UiBarChart', () => {
  it('draws a bar per datum with its inputs', async () => {
    const { componentRef, container, getByText } = await render(BarChartHost);
    expect(barsDrawn(container)).toHaveLength(2);
    expect(marksSvg(container)).toContain('fill="red"');
    expect(marksSvg(container)).toContain('rx="4"');
    expect(getByText('Mon')).toBeTruthy();

    (componentRef.instance as BarChartHost).color.set('blue');
    await waitForUpdate();
    expect(marksSvg(container)).toContain('fill="blue"');
  });

  it("emits a tapped bar's datum, and nothing for a tap off the bars", async () => {
    const { componentRef, container } = await render(BarChartHost);
    const host = componentRef.instance as BarChartHost;
    await tap(container, barsDrawn(container)[1]!);
    expect(host.tapped).toEqual([host.data[1]]);

    await tap(container, { x: -100, y: -100 });
    expect(host.tapped).toEqual([host.data[1]]);
  });
});

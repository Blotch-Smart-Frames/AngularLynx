import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  SceneDot,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it } from 'vitest';
import type { XYDatum } from '../chart/chart-presets';
import { UiScatterChart, scatterChartDefinition } from './scatter-chart';

const data = [
  { x: 150, y: 50 },
  { x: 160, y: 65 },
  { x: 170, y: 70 },
];

/**
 * Every dot in a definition's scene.
 */
const dots = (definition: ChartDefinition<any, any, any>) => {
  const scene = createChartRuntime().render(definition, {
    width: 300,
    height: 200,
  });
  const found: SceneDot[] = [];
  const walk = (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        if (!node.focus) walk(node.children);
      } else if (node.kind === 'dot') found.push(node);
    }
  };
  walk(scene.nodes);
  return { scene, found };
};

describe('scatterChartDefinition', () => {
  it('draws a dot per point, inset from the frame', () => {
    const { scene, found } = dots(scatterChartDefinition({ data }));
    expect(found).toHaveLength(3);
    expect(found[0]!.radius).toBe(4);
    expect(found[0]!.style?.fill).toBe('var(--primary)');
    // The 4% inset widens the x domain past the data.
    expect(scene.scales['x']!.domain[0]).toBeLessThan(150);
  });

  it('sizes points individually for a bubble chart', () => {
    const { found } = dots(
      scatterChartDefinition({ data, sizes: [2, 8], radius: 5 }),
    );
    expect(found.map((dot) => dot.radius)).toEqual([2, 8, 5]);
  });

  it('cycles per-point colors and keeps explicit padding', () => {
    const { scene, found } = dots(
      scatterChartDefinition({
        data,
        colors: ['red', 'blue'],
        xMin: 150,
        xMax: 170,
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
        tooltip: false,
      }),
    );
    expect(found.map((dot) => dot.style?.fill)).toEqual(['red', 'blue', 'red']);
    expect(scene.scales['x']!.domain).toEqual([150, 170]);
  });
});

@Component({
  imports: [UiScatterChart],
  template: `
    <ui-scatter-chart
      [data]="data"
      [width]="300"
      [radius]="radius()"
      (pointTap)="tapped.push($event)"
    />
  `,
})
class ScatterChartHost {
  readonly data = data;
  readonly radius = signal(7);
  /** Every `pointTap`, in order. */
  readonly tapped: XYDatum[] = [];
}

/**
 * The SVG the chart's marks layer draws.
 */
const marksSvg = (container: Element) =>
  container.querySelectorAll('svg')[1]!.getAttribute('content')!;

/**
 * Where the chart drew each dot, and how big.
 */
const dotsDrawn = (container: Element) =>
  [
    ...marksSvg(container).matchAll(
      /<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/g,
    ),
  ].map(([, x, y, r]) => ({ x: Number(x), y: Number(y), r: Number(r) }));

/**
 * Touches a spot of the chart and lifts the finger right there: a tap.
 */
const tap = async (container: Element, at: { x: number; y: number }) => {
  const root = container.querySelector('[accessibility-label]')!;
  fireEvent.touchstart(root, { touches: [at] });
  fireEvent.touchend(root, { touches: [at] });
  await waitForUpdate();
};

describe('UiScatterChart', () => {
  it('draws a dot per datum with its inputs', async () => {
    const { componentRef, container } = await render(ScatterChartHost);
    expect(dotsDrawn(container).map((dot) => dot.r)).toEqual([7, 7, 7]);

    (componentRef.instance as ScatterChartHost).radius.set(3);
    await waitForUpdate();
    expect(dotsDrawn(container).map((dot) => dot.r)).toEqual([3, 3, 3]);
  });

  it("emits a tapped point's datum, and nothing for a tap off the points", async () => {
    const { componentRef, container } = await render(ScatterChartHost);
    const host = componentRef.instance as ScatterChartHost;
    const last = dotsDrawn(container)[2]!;
    await tap(container, { x: last.x, y: last.y });
    expect(host.tapped).toEqual([data[2]]);

    await tap(container, { x: -100, y: -100 });
    expect(host.tapped).toEqual([data[2]]);
  });
});

import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type { ChartDefinition, SceneNode } from '@tanstack/charts/types';
import { describe, expect, it } from 'vitest';
import type { XYDatum } from '../chart/chart-presets';
import { UiLineChart, lineChartDefinition } from './line-chart';

const data = [
  { x: 0, y: 10 },
  { x: 5, y: 30 },
  { x: 10, y: 20 },
];

/**
 * Every drawn shape in a definition's scene, labels excluded.
 */
const shapes = (definition: ChartDefinition<any, any, any>) => {
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

describe('lineChartDefinition', () => {
  it('draws the line and a dot per point', () => {
    const { found } = shapes(lineChartDefinition({ data }));
    expect(found.filter((n) => n.kind === 'polyline')).toHaveLength(1);
    expect(found.filter((n) => n.kind === 'dot')).toHaveLength(3);
    const line = found.find((n) => n.kind === 'polyline')!;
    expect(line.style).toMatchObject({
      stroke: 'var(--primary)',
      strokeWidth: 2,
    });
  });

  it('can leave the dots out', () => {
    for (const options of [{ showDots: false }, { dotRadius: 0 }]) {
      const { found } = shapes(lineChartDefinition({ data, ...options }));
      expect(found.some((n) => n.kind === 'dot')).toBe(false);
    }
  });

  it('draws a curve through the points when smooth', () => {
    const { found } = shapes(
      lineChartDefinition({ data, smooth: true, color: 'red' }),
    );
    const line = found.find((n) => n.kind === 'polyline') as { path?: string };
    expect(line.path).toContain('C');
  });

  it('fits the axes to the data and honors the shared options', () => {
    const { scene } = shapes(
      lineChartDefinition({
        data,
        yMin: 0,
        yMax: 40,
        showGrid: false,
        tooltip: false,
      }),
    );
    expect(scene.scales['y']!.domain).toEqual([0, 40]);
    expect(scene.scales['x']!.domain).toEqual([0, 10]);
  });

  it('includes the tooltip unless turned off', () => {
    expect(lineChartDefinition({ data }).tooltip).toBeTruthy();
    expect(lineChartDefinition({ data, tooltip: false }).tooltip).toBe(false);
  });
});

@Component({
  imports: [UiLineChart],
  template: `
    <ui-line-chart
      [data]="data"
      [width]="300"
      [showDots]="showDots()"
      color="red"
      yAxisLabel="Revenue"
      (pointTap)="tapped.push($event)"
    />
  `,
})
class LineChartHost {
  readonly data = data;
  readonly showDots = signal(true);
  /** Every `pointTap`, in order. */
  readonly tapped: XYDatum[] = [];
}

/**
 * The SVG the chart's marks layer draws.
 */
const marksSvg = (container: Element) =>
  container.querySelectorAll('svg')[1]!.getAttribute('content')!;

/**
 * Where the chart drew each dot.
 */
const dotsDrawn = (container: Element) =>
  [
    ...marksSvg(container).matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g),
  ].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));

/**
 * Touches a spot of the chart and lifts the finger right there: a tap.
 */
const tap = async (container: Element, at: { x: number; y: number }) => {
  const root = container.querySelector('[accessibility-label]')!;
  fireEvent.touchstart(root, { touches: [at] });
  fireEvent.touchend(root, { touches: [at] });
  await waitForUpdate();
};

describe('UiLineChart', () => {
  it('draws its data with its inputs', async () => {
    const { componentRef, container, getByText } = await render(LineChartHost);
    expect(marksSvg(container)).toContain('stroke="red"');
    expect(dotsDrawn(container)).toHaveLength(3);
    expect(getByText('Revenue')).toBeTruthy();

    (componentRef.instance as LineChartHost).showDots.set(false);
    await waitForUpdate();
    expect(dotsDrawn(container)).toHaveLength(0);
  });

  it("emits a tapped point's datum, and nothing for a tap off the points", async () => {
    const { componentRef, container } = await render(LineChartHost);
    const host = componentRef.instance as LineChartHost;
    const middle = dotsDrawn(container)[1]!;
    await tap(container, { x: middle.x + 1, y: middle.y + 1 });
    expect(host.tapped).toEqual([data[1]]);

    await tap(container, { x: -100, y: -100 });
    expect(host.tapped).toEqual([data[1]]);
  });
});

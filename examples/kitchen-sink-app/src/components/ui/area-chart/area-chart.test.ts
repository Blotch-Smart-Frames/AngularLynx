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
import { UiAreaChart, areaChartDefinition } from './area-chart';

const data = [
  { x: 0, y: 4 },
  { x: 1, y: -2 },
  { x: 2, y: 6 },
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

describe('areaChartDefinition', () => {
  it('fills to the baseline under the line, with dots', () => {
    const { found } = shapes(areaChartDefinition({ data, fillOpacity: 0.3 }));
    const area = found.find((n) => n.kind === 'area')!;
    expect(area.style).toMatchObject({
      fill: 'var(--primary)',
      fillOpacity: 0.3,
    });
    expect(found.filter((n) => n.kind === 'polyline')).toHaveLength(1);
    expect(found.filter((n) => n.kind === 'dot')).toHaveLength(3);
  });

  it('keeps the baseline in view', () => {
    const { scene } = shapes(
      areaChartDefinition({
        data: [
          { x: 0, y: 5 },
          { x: 1, y: 8 },
        ],
        baseline: -10,
      }),
    );
    expect(scene.scales['y']!.domain[0]).toBeLessThanOrEqual(-10);
  });

  it('can leave out the dots, curve the line and drop the tooltip', () => {
    const definition = areaChartDefinition({
      data,
      showDots: false,
      smooth: true,
      tooltip: false,
    });
    const { found } = shapes(definition);
    expect(found.some((n) => n.kind === 'dot')).toBe(false);
    expect(
      (found.find((n) => n.kind === 'polyline') as { path?: string }).path,
    ).toContain('C');
    expect(definition.tooltip).toBe(false);
  });
});

@Component({
  imports: [UiAreaChart],
  template: `
    <ui-area-chart
      [data]="data"
      [width]="300"
      [baseline]="baseline()"
      [fillOpacity]="0.3"
      (pointTap)="tapped.push($event)"
    />
  `,
})
class AreaChartHost {
  readonly data = data;
  readonly baseline = signal(0);
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

/**
 * The texts of the chart's labels, such as its ticks.
 */
const labelTexts = (container: Element) =>
  [...container.querySelectorAll('text')].map((text) => text.textContent);

describe('UiAreaChart', () => {
  it('fills under its line with its inputs, keeping the baseline in view', async () => {
    const { componentRef, container } = await render(AreaChartHost);
    expect(marksSvg(container)).toContain('fill-opacity="0.3"');
    expect(dotsDrawn(container)).toHaveLength(3);
    expect(labelTexts(container)).not.toContain('-20');

    (componentRef.instance as AreaChartHost).baseline.set(-20);
    await waitForUpdate();
    expect(labelTexts(container)).toContain('-20');
  });

  it("emits a tapped point's datum, and nothing for a tap off the points", async () => {
    const { componentRef, container } = await render(AreaChartHost);
    const host = componentRef.instance as AreaChartHost;
    const first = dotsDrawn(container)[0]!;
    await tap(container, { x: first.x + 1, y: first.y + 1 });
    expect(host.tapped).toEqual([data[0]]);

    await tap(container, { x: -100, y: -100 });
    expect(host.tapped).toEqual([data[0]]);
  });
});

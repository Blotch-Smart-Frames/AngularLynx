import { render } from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  ChartPoint,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiAreaChart } from './area-chart';

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

describe('UiAreaChart', () => {
  type Internals = {
    definition: () => ChartDefinition<any, any, any>;
    onSelect(point: ChartPoint | null): void;
  };

  it('builds its definition from its inputs', async () => {
    const { componentRef } = await render(UiAreaChart);
    const chart = componentRef.instance as UiAreaChart;
    setInputSignal(chart.data, data);
    setInputSignal(chart.baseline, -20);
    const { scene } = shapes((chart as unknown as Internals).definition());
    expect(scene.scales['y']!.domain[0]).toBeLessThanOrEqual(-20);
  });

  it('emits the tapped datum', async () => {
    const { componentRef } = await render(UiAreaChart);
    const chart = componentRef.instance as UiAreaChart;
    const tapped = vi.fn();
    chart.pointTap.subscribe(tapped);
    const internals = chart as unknown as Internals;
    internals.onSelect({ datum: data[0] } as ChartPoint);
    internals.onSelect(null);
    expect(tapped.mock.calls).toEqual([[data[0]]]);
  });
});

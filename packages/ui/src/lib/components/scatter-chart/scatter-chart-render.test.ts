import { render } from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  ChartPoint,
  SceneDot,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiScatterChart } from './scatter-chart';

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

describe('UiScatterChart', () => {
  type Internals = {
    definition: () => ChartDefinition<any, any, any>;
    onSelect(point: ChartPoint | null): void;
  };

  it('builds its definition from its inputs', async () => {
    const { componentRef } = await render(UiScatterChart);
    const chart = componentRef.instance as UiScatterChart;
    setInputSignal(chart.data, data);
    setInputSignal(chart.radius, 7);
    const { found } = dots((chart as unknown as Internals).definition());
    expect(found[0]!.radius).toBe(7);
  });

  it('emits the tapped datum', async () => {
    const { componentRef } = await render(UiScatterChart);
    const chart = componentRef.instance as UiScatterChart;
    const tapped = vi.fn();
    chart.pointTap.subscribe(tapped);
    const internals = chart as unknown as Internals;
    internals.onSelect({ datum: data[2] } as ChartPoint);
    internals.onSelect(null);
    expect(tapped.mock.calls).toEqual([[data[2]]]);
  });
});

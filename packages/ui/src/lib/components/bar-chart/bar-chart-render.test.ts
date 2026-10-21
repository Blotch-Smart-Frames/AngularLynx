import { render } from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  ChartPoint,
  SceneNode,
  SceneRect,
} from '@tanstack/charts/types';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiBarChart } from './bar-chart';

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

describe('UiBarChart', () => {
  type Internals = {
    definition: () => ChartDefinition<any, any, any>;
    onSelect(point: ChartPoint | null): void;
  };

  it('builds its definition from its inputs', async () => {
    const { componentRef } = await render(UiBarChart);
    const chart = componentRef.instance as UiBarChart;
    setInputSignal(chart.data, [{ x: 'a', y: 1 }]);
    setInputSignal(chart.color, 'red');
    const { found } = bars((chart as unknown as Internals).definition());
    expect(found[0]!.style?.fill).toBe('red');
  });

  it('emits the tapped datum', async () => {
    const { componentRef } = await render(UiBarChart);
    const chart = componentRef.instance as UiBarChart;
    const tapped = vi.fn();
    chart.barTap.subscribe(tapped);
    const internals = chart as unknown as Internals;
    internals.onSelect({ datum: { x: 'a', y: 1 } } as ChartPoint);
    internals.onSelect(null);
    expect(tapped.mock.calls).toEqual([[{ x: 'a', y: 1 }]]);
  });
});

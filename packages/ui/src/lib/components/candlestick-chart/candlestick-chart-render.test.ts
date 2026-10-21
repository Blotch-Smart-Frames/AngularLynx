import { render } from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  ChartPoint,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiCandlestickChart } from './candlestick-chart';

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

describe('UiCandlestickChart', () => {
  type Internals = {
    definition: () => ChartDefinition<any, any, any>;
    onSelect(point: ChartPoint | null): void;
  };

  it('builds its definition from its inputs', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const chart = componentRef.instance as UiCandlestickChart;
    setInputSignal(chart.data, data);
    setInputSignal(chart.upColor, 'blue');
    const { found } = render2((chart as unknown as Internals).definition());
    expect(found.filter((n) => n.kind === 'rect')[0]!.style?.fill).toBe('blue');
  });

  it('emits the tapped datum', async () => {
    const { componentRef } = await render(UiCandlestickChart);
    const chart = componentRef.instance as UiCandlestickChart;
    const tapped = vi.fn();
    chart.candleTap.subscribe(tapped);
    const internals = chart as unknown as Internals;
    internals.onSelect({ datum: data[0] } as ChartPoint);
    internals.onSelect(null);
    expect(tapped.mock.calls).toEqual([[data[0]]]);
  });
});

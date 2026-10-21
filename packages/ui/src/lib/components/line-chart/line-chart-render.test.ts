import { render } from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  ChartPoint,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiLineChart } from './line-chart';

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

describe('UiLineChart', () => {
  type Internals = {
    definition: () => ChartDefinition<any, any, any>;
    onSelect(point: ChartPoint | null): void;
    chart: unknown;
  };

  it('builds its definition from its inputs', async () => {
    const { componentRef } = await render(UiLineChart);
    const chart = componentRef.instance as UiLineChart;
    setInputSignal(chart.data, data);
    setInputSignal(chart.showDots, false);
    setInputSignal(chart.yAxisLabel, 'Revenue');
    const { found, scene } = shapes(
      (chart as unknown as Internals).definition(),
    );
    expect(found.some((n) => n.kind === 'dot')).toBe(false);
    expect(scene.nodes).toBeDefined();
  });

  it('emits the tapped datum', async () => {
    const { componentRef } = await render(UiLineChart);
    const chart = componentRef.instance as UiLineChart;
    const tapped = vi.fn();
    chart.pointTap.subscribe(tapped);
    const internals = chart as unknown as Internals;
    internals.onSelect({ datum: data[1] } as ChartPoint);
    internals.onSelect(null);
    expect(tapped.mock.calls).toEqual([[data[1]]]);
  });

  it('forwards the zoom API to its chart', async () => {
    const { componentRef } = await render(UiLineChart);
    const chart = componentRef.instance as UiLineChart;
    const inner = { zoomIn: vi.fn(), zoomOut: vi.fn(), resetZoom: vi.fn() };
    // Signal queries aren't wired under plain Vitest (JIT), so stand in for
    // the inner <ui-chart>.
    (chart as unknown as Internals).chart = () => inner;
    chart.zoomIn();
    chart.zoomOut();
    chart.resetZoom();
    expect(inner.zoomIn).toHaveBeenCalled();
    expect(inner.zoomOut).toHaveBeenCalled();
    expect(inner.resetZoom).toHaveBeenCalled();
  });
});

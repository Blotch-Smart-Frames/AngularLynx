import { createChartRuntime } from '@tanstack/charts/runtime';
import type { ChartDefinition, SceneNode } from '@tanstack/charts/types';
import { describe, expect, it } from 'vitest';
import { areaChartDefinition } from './area-chart';

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

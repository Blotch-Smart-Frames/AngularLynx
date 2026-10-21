import { createChartRuntime } from '@tanstack/charts/runtime';
import type {
  ChartDefinition,
  SceneDot,
  SceneNode,
} from '@tanstack/charts/types';
import { describe, expect, it } from 'vitest';
import { scatterChartDefinition } from './scatter-chart';

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

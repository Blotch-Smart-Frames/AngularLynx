import { getQueriesForElement } from '@blotch/angular-lynx-testing-library';
import { createChartRuntime } from '@tanstack/charts/runtime';
import type { ChartDefinition, SceneNode } from '@tanstack/charts/types';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { ChartDemo } from './chart-demo';

// renderOnce() rather than render(): the page frames itself in
// <app-demo-screen>, whose header is input()-bound (see
// src/test-utils/render-once.ts).
let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

/**
 * Compiles a definition the way <ui-chart> does and counts its drawn shapes
 * by kind. The test environment has no layout, so the charts on the page never
 * get a size to draw at; the definitions are checked here instead.
 */
const shapeCounts = (definition: ChartDefinition<any, any, any>) => {
  const scene = createChartRuntime().render(definition, {
    width: 320,
    height: 200,
  });
  const counts: Record<string, number> = {};
  const walk = (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        // Focus groups are the hover highlights, not the chart itself.
        if (!node.focus) walk(node.children);
      } else if (node.kind !== 'label') {
        counts[node.kind] = (counts[node.kind] ?? 0) + 1;
      }
    }
  };
  walk(scene.nodes);
  return { scene, counts };
};

describe('ChartDemo', () => {
  it('renders the heading and every section title', async () => {
    const { container, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { getByText } = getQueriesForElement(container);
    expect(getByText('Several series')).toBeTruthy();
    expect(getByText('Stacked area')).toBeTruthy();
    expect(getByText('Custom tooltip')).toBeTruthy();
    expect(getByText('Horizontal bars')).toBeTruthy();
    expect(getByText('Regression by group')).toBeTruthy();
  });

  it('renders a legend entry per series', async () => {
    const { container, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { getAllByText, getByText } = getQueriesForElement(container);
    // The region legend appears under both the line and the stacked area.
    expect(getAllByText('North')).toHaveLength(2);
    expect(getByText('Android')).toBeTruthy();
    expect(getByText('Tablets')).toBeTruthy();
  });

  it('draws one line per region from a single mark', async () => {
    const { instance, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { counts } = shapeCounts(instance.regionLines);
    expect(counts['polyline']).toBe(3);
  });

  it('stacks the regions into areas topped by lines', async () => {
    const { instance, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { counts } = shapeCounts(instance.regionStack);
    expect(counts['area']).toBe(3);
    expect(counts['polyline']).toBe(3);
    // Each layer starts where the one below it ends.
    const jan = instance.stackedSales.filter((row) => row.month === 'Jan');
    expect(jan.map((row) => [row.y1, row.y2])).toEqual([
      [0, 12],
      [12, 20],
      [20, 25],
    ]);
  });

  it('draws a bar segment per platform per quarter', async () => {
    const { instance, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { counts } = shapeCounts(instance.platformStack);
    expect(counts['rect']).toBe(12);
  });

  it('draws a horizontal bar per screen on a band y axis', async () => {
    const { instance, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { scene, counts } = shapeCounts(instance.screenBars);
    expect(counts['rect']).toBe(5);
    expect(scene.scales['y']!.domain).toEqual([
      'Home',
      'Search',
      'Profile',
      'Cart',
      'Settings',
    ]);
  });

  it('fits a regression line per device', async () => {
    const { instance, destroy } = await renderOnce(ChartDemo);
    destroyDemo = destroy;
    const { counts } = shapeCounts(instance.sessionFits);
    expect(counts['polyline']).toBe(2);
    expect(counts['dot']).toBe(12);
  });
});

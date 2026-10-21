import { describe, expect, it, vi } from 'vitest';
import { createChartRuntime } from '@tanstack/charts/runtime';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import type { ChartDefinition, ChartPoint } from '@tanstack/charts/types';
import { defineChart, dot, lineY } from '@tanstack/charts/universal';
import { adjacentFocusPoint, createChartFocusModel } from './chart-focus';

const data = [
  { x: 0, y: 1 },
  { x: 1, y: 3 },
  { x: 2, y: 2 },
];
const scales = {
  x: { scale: () => scaleLinear().domain([0, 2]) },
  y: { scale: () => scaleLinear().domain([0, 4]) },
};

const modelFor = (definition: ChartDefinition<any, any, any>) => {
  const scene = createChartRuntime().render(definition, {
    width: 200,
    height: 100,
  });
  return { scene, model: createChartFocusModel(scene, definition) };
};

describe('createChartFocusModel', () => {
  it('resolves a touch to the nearest point', () => {
    const definition = defineChart({
      marks: [dot(data, { x: 'x', y: 'y' })],
      scales,
    });
    const { scene, model } = modelFor(definition);
    const target = scene.points[1]!;
    expect(model.resolve(target.x + 2, target.y - 2)).toEqual([target]);
  });

  it('resolves nothing out of reach', () => {
    const definition = defineChart({
      marks: [dot(data, { x: 'x', y: 'y' })],
      scales,
      maxFocusDistance: 1,
    });
    const { model } = modelFor(definition);
    expect(model.resolve(-500, -500)).toEqual([]);
  });

  it("groups a mark's series at one x with the group-x preset", () => {
    const series = [
      ...data.map((d) => ({ ...d, s: 'a' })),
      ...data.map((d) => ({ ...d, y: d.y + 1, s: 'b' })),
    ];
    const definition = defineChart({
      marks: [lineY(series, { x: 'x', y: 'y', z: 's' })],
      scales,
      focus: 'group-x',
    });
    const { scene, model } = modelFor(definition);
    const point = scene.points.find((p) => p.xValue === 1)!;
    const group = model.resolve(point.x, point.y);
    expect(group.length).toBe(2);
    expect(model.group(point).length).toBe(2);
  });

  it('turns focus off with focus: false', () => {
    const definition = defineChart({
      marks: [dot(data, { x: 'x', y: 'y' })],
      scales,
      focus: false,
    });
    const { scene, model } = modelFor(definition);
    expect(model.resolve(scene.points[0]!.x, scene.points[0]!.y)).toEqual([]);
    expect(model.navigation).toEqual([]);
  });

  it("uses the definition's spatial index", () => {
    // Typed loosely: the index returns points of whatever datum the chart has.
    const findNearest = vi.fn((): ChartPoint<any, any, any> | null => null);
    const definition = defineChart({
      marks: [dot(data, { x: 'x', y: 'y' })],
      scales,
      spatialIndex: () => ({ findNearest }),
    });
    const { model } = modelFor(definition);
    expect(model.resolve(-500, -500)).toEqual([]);
    expect(findNearest).toHaveBeenCalledWith(-500, -500, 48);
  });

  it('restores a point from an older scene by identity', () => {
    const definition = defineChart({
      marks: [dot(data, { x: 'x', y: 'y' })],
      scales,
    });
    const first = modelFor(definition);
    const second = modelFor(definition);
    const restored = second.model.restore(first.scene.points[2]!);
    expect(restored).toBe(second.scene.points[2]);
  });

  it('orders points left to right for stepping through them', () => {
    const definition = defineChart({
      marks: [dot([data[2]!, data[0]!, data[1]!], { x: 'x', y: 'y' })],
      scales,
    });
    const { model } = modelFor(definition);
    expect(model.navigation.map((p) => p.xValue)).toEqual([0, 1, 2]);
  });
});

describe('adjacentFocusPoint', () => {
  const definition = defineChart({
    marks: [dot(data, { x: 'x', y: 'y' })],
    scales,
  });
  const { model } = modelFor(definition);
  const [first, second, third] = model.navigation;

  it('starts at either end without a current point', () => {
    expect(adjacentFocusPoint(model, null, 1)).toBe(first);
    expect(adjacentFocusPoint(model, null, -1)).toBe(third);
  });

  it('steps and stops at the ends', () => {
    expect(adjacentFocusPoint(model, first!, 1)).toBe(second);
    expect(adjacentFocusPoint(model, first!, -1)).toBe(first);
    expect(adjacentFocusPoint(model, third!, 1)).toBe(third);
  });

  it('returns null when there is nothing to step to', () => {
    const empty = { ...model, navigation: [] };
    expect(adjacentFocusPoint(empty, null, 1)).toBeNull();
  });
});

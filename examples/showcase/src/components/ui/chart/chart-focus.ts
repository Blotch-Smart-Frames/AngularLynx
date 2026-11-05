import {
  resolveChartFocusStrategy,
  resolveChartPointerFocus,
  restoreChartFocusPoint,
  sameChartPointIdentity,
} from '@tanstack/charts/cursor/host';
import { focusDisabled } from '@tanstack/charts/focus/disabled';
import {
  findNearestPoint,
  viewportInteractionPoints,
} from '@tanstack/charts/scene';
import type {
  ChartDefinition,
  ChartFocusStrategy,
  ChartPoint,
  ChartScene,
} from '@tanstack/charts/types';

/**
 * Which data points a touch lands on, and the order a screen reader steps
 * through them.
 *
 * A port of TanStack's React Native focus model: it runs the definition's focus
 * strategy (nearest point, a whole x column for `focus: 'x'`, …) over the
 * scene's points rather than hit-testing painted shapes, which a single
 * rasterized `<svg>` couldn't do anyway. One chart-level touch handler plus this
 * model is also what TanStack recommends for native hosts, instead of a
 * responder per mark.
 */
export type ChartFocusModel = {
  /** The focused group for a touch at scene coordinates, or `[]`. */
  resolve(x: number, y: number): readonly ChartPoint[];
  /** The group that focusing `point` shows (its whole x column, say). */
  group(point: ChartPoint): readonly ChartPoint[];
  /** Points in reading order, for stepping with accessibility actions. */
  readonly navigation: readonly ChartPoint[];
  /** The same datum's point in a newer scene, or `null` if it's gone. */
  restore(point: ChartPoint): ChartPoint | null;
};

/** TanStack's default reach for pointer focus, in scene pixels. */
const DEFAULT_MAX_FOCUS_DISTANCE = 48;

export const createChartFocusModel = (
  scene: ChartScene<any, any, any>,
  definition: ChartDefinition<any, any, any>,
): ChartFocusModel => {
  const points = viewportInteractionPoints(scene);
  const strategy: ChartFocusStrategy<any, any, any> | undefined =
    definition.focus === false
      ? focusDisabled
      : resolveChartFocusStrategy(definition.focus);
  const spatialIndex =
    definition.focus === false
      ? undefined
      : definition.spatialIndex?.(points, { scene });
  const maxDistance = definition.maxFocusDistance ?? DEFAULT_MAX_FOCUS_DISTANCE;

  return {
    resolve(x, y) {
      const focused = resolveChartPointerFocus(
        scene,
        strategy,
        x,
        y,
        maxDistance,
        points,
      );
      if (focused) return focused;
      const point = spatialIndex
        ? spatialIndex.findNearest(x, y, maxDistance)
        : findNearestPoint(scene, x, y, maxDistance, points);
      const visible = point ? restoreChartFocusPoint(points, point) : null;
      return visible ? [visible] : [];
    },
    group(point) {
      return strategy?.group(points, { point }) ?? [point];
    },
    navigation: strategy?.navigation(points) ?? readingOrder(points),
    restore(point) {
      return restoreChartFocusPoint(points, point);
    },
  };
};

/** The point `direction` steps away from `current` in navigation order. */
export const adjacentFocusPoint = (
  model: ChartFocusModel,
  current: ChartPoint | null,
  direction: -1 | 1,
): ChartPoint | null => {
  const { navigation } = model;
  const index = current
    ? navigation.findIndex((point) => sameChartPointIdentity(point, current))
    : -1;
  const next =
    index < 0
      ? direction > 0
        ? 0
        : navigation.length - 1
      : Math.max(0, Math.min(navigation.length - 1, index + direction));
  return navigation[next] ?? null;
};

/**
 * Left to right, then top to bottom; ties keep scene order.
 */
const readingOrder = (points: readonly ChartPoint[]): ChartPoint[] =>
  points
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) =>
        a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index,
    )
    .map(({ point }) => point);

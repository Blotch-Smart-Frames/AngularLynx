import type { ChartDefinition, ResolvedScale } from '@tanstack/charts/types';

/**
 * Pan and zoom for `<ui-chart>`, as a visible window over each continuous
 * axis. TanStack Charts already has the concept: a scale's `viewport.domain` is
 * "a semantic window over the scale's complete domain", which it maps into the
 * plot and clips to. So zooming never touches the data or the marks; the chart
 * only rewrites that one option and re-renders. Windows are plain numbers; a
 * time axis converts to and from epoch milliseconds at the edges.
 */

/** An inclusive `[low, high]` window in data units. */
export type ChartWindow = readonly [number, number];

export type ChartZoomAxes = 'x' | 'y' | 'xy';

/** A viewport domain as TanStack takes it: numbers, or `Date`s on a time axis. */
export type ChartViewportDomain =
  | readonly [number, number]
  | readonly [Date, Date];

/** The visible window per axis; a missing axis is fully zoomed out. */
export type ChartViewport = {
  readonly x?: ChartViewportDomain;
  readonly y?: ChartViewportDomain;
};

const clampValue = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

/**
 * Keeps `window` inside `base`: never wider than it, never past either edge.
 * Span is preserved where possible (the window slides rather than resizes), so
 * panning into an edge stops instead of secretly zooming.
 */
export const clampWindow = (
  base: ChartWindow,
  window: ChartWindow,
): ChartWindow => {
  const span = Math.min(window[1] - window[0], base[1] - base[0]);
  const lo = clampValue(window[0], base[0], base[1] - span);
  return [lo, lo + span];
};

/** Slides `current` by `delta` data units, stopping at the edges of `base`. */
export const panWindow = (
  base: ChartWindow,
  current: ChartWindow,
  delta: number,
): ChartWindow => clampWindow(base, [current[0] + delta, current[1] + delta]);

/**
 * Zooms `current` by `factor` (>1 in, <1 out) around the data value `focal`,
 * which keeps its place on screen. The span stays within
 * `[baseSpan / maxZoom, baseSpan / minZoom]`.
 */
export const zoomWindow = (
  base: ChartWindow,
  current: ChartWindow,
  factor: number,
  focal: number,
  maxZoom: number,
  minZoom = 1,
): ChartWindow => {
  const baseSpan = base[1] - base[0];
  const span = current[1] - current[0];
  const minSpan = maxZoom > 0 ? baseSpan / maxZoom : baseSpan;
  const maxSpan = minZoom > 0 ? baseSpan / minZoom : baseSpan;
  const nextSpan = clampValue(span / (factor || 1), minSpan, maxSpan);
  const fraction = span === 0 ? 0.5 : (focal - current[0]) / span;
  const lo = focal - fraction * nextSpan;
  return clampWindow(base, [lo, lo + nextSpan]);
};

/** Whether `window` covers (practically) all of `base`, i.e. is at rest. */
export const isFullWindow = (
  base: ChartWindow,
  window: ChartWindow,
): boolean => {
  const baseSpan = base[1] - base[0];
  return baseSpan === 0 || window[1] - window[0] >= baseSpan * (1 - 1e-6);
};

/**
 * The complete domain of a rendered continuous axis, as numbers, or `null` for
 * an axis that can't zoom: a band/point scale, a missing scale, or a degenerate
 * domain. With a viewport applied, the scene still reports the full domain as
 * `viewport.contentDomain`.
 */
export const axisContentWindow = (
  scale: ResolvedScale | undefined,
): ChartWindow | null => {
  if (!scale || scale.bandwidth > 0) return null;
  const domain = scale.viewport?.contentDomain ?? scale.domain;
  if (domain.length !== 2) return null;
  const lo = toNumber(domain[0]);
  const hi = toNumber(domain[1]);
  if (lo === null || hi === null || lo === hi) return null;
  return lo < hi ? [lo, hi] : [hi, lo];
};

/** The window currently shown on a zoomable axis: its viewport, else all of it. */
export const axisVisibleWindow = (
  scale: ResolvedScale | undefined,
): ChartWindow | null => {
  const content = axisContentWindow(scale);
  const viewport = scale?.viewport?.domain;
  if (!content || !viewport) return content;
  const lo = toNumber(viewport[0]);
  const hi = toNumber(viewport[1]);
  return lo === null || hi === null
    ? content
    : [Math.min(lo, hi), Math.max(lo, hi)];
};

/**
 * `window` in the axis's own value type: `Date`s for a time scale, so the
 * viewport compares like with like against its domain.
 */
export const toViewportDomain = (
  window: ChartWindow,
  scale: ResolvedScale,
): ChartViewportDomain =>
  scale.domain[0] instanceof Date
    ? [new Date(window[0]), new Date(window[1])]
    : [window[0], window[1]];

const toNumber = (value: unknown): number | null => {
  const number = value instanceof Date ? value.getTime() : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/**
 * `definition` with each windowed axis's `viewport` set. Only axes the
 * definition configures (`scales.x` / `scales.y`) can carry a viewport, which
 * every zoomable preset does. A responsive definition (`chart: (size) => …`)
 * gets the viewport applied to the spec its builder returns.
 */
export const withViewport = <
  TDefinition extends ChartDefinition<any, any, any>,
>(
  definition: TDefinition,
  viewport: ChartViewport,
): TDefinition => {
  if (!viewport.x && !viewport.y) return definition;
  if ('chart' in definition && typeof definition.chart === 'function') {
    const build = definition.chart as (context: unknown) => TDefinition;
    return {
      ...definition,
      chart: (context: unknown) => withViewport(build(context), viewport),
    };
  }
  const scales = (definition as { scales?: Record<string, object> }).scales;
  if (!scales) return definition;
  const next: Record<string, object> = { ...scales };
  for (const axis of ['x', 'y'] as const) {
    const domain = viewport[axis];
    const options = scales[axis];
    if (domain && options) next[axis] = { ...options, viewport: { domain } };
  }
  return { ...definition, scales: next };
};

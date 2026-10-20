import { resolveCssColor } from './css-color';
import { pressOf, stepPress } from './glass-press';
import type { GlassShapeFrame } from './glass-renderer';

/**
 * What a `<blur-view>` is to the glass code:
 * - `container`: a `glass-container`, which draws its glass children as one
 *   group so nearby shapes merge.
 * - `standalone`: a `glass` element outside any container, its own group.
 * - `member`: a `glass` element its parent container draws.
 */
export type GlassRole = 'container' | 'standalone' | 'member';

export const glassRole = (element: Element): GlassRole | null => {
  const effect = element.getAttribute('blur-effect');
  if (effect === 'glass-container') return 'container';
  if (effect !== 'glass') return null;
  const parent = element.parentElement?.getAttribute('blur-effect');
  return parent === 'glass-container' ? 'member' : 'standalone';
};

/**
 * The shapes a container groups. iOS only merges the glass views placed
 * directly in the container, so only direct children count here too.
 */
export const containerShapes = (container: Element): HTMLElement[] =>
  Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child.getAttribute('blur-effect') === 'glass',
  );

/**
 * A corner radius as the shader needs it: one value in pixels, no larger than
 * half the shorter side. Computed styles give pixels or a percentage, and
 * `rounded-full` (9999px) clamps to a circle or a pill.
 */
export const cornerRadius = (
  value: string,
  width: number,
  height: number,
): number => {
  const shorter = Math.min(width, height);
  const radius = value.endsWith('%')
    ? (parseFloat(value) / 100) * shorter
    : parseFloat(value) || 0;
  return Math.min(radius, shorter / 2);
};

// How much an interactive shape swells while pressed, as on iOS.
const PRESS_GROWTH = 0.06;

/**
 * Reads one shape for a frame, relative to the group canvas at `origin`.
 * Advances its press animation by `elapsed` milliseconds; only containers let
 * a pressed shape `grow`, since a standalone shape's canvas is its own box
 * and Lynx clips anything drawn outside it.
 */
export const readShape = (
  element: HTMLElement,
  origin: DOMRect,
  elapsed: number,
  grow: boolean,
): GlassShapeFrame & { press: number } => {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const press = pressOf(element);
  const pressed = press ? stepPress(press, elapsed) : 0;
  const swell = grow ? 1 + PRESS_GROWTH * pressed : 1;
  return {
    centerX: rect.left - origin.left + rect.width / 2,
    centerY: rect.top - origin.top + rect.height / 2,
    halfWidth: (rect.width / 2) * swell,
    halfHeight: (rect.height / 2) * swell,
    radius:
      cornerRadius(style.borderTopLeftRadius, rect.width, rect.height) * swell,
    frost: element.getAttribute('glass-style') === 'clear' ? 0 : 1,
    tint: resolveCssColor(
      element.ownerDocument,
      element.getAttribute('glass-tint-color'),
    ),
    press: pressed,
  };
};

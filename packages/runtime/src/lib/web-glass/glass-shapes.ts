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

/** How much an interactive shape swells while pressed, as on iOS. */
export const PRESS_GROWTH = 0.06;

/**
 * Reads one shape for a frame, relative to the group canvas at `origin`.
 * Advances its press animation by `elapsed` milliseconds; only containers let
 * a pressed shape `grow` here, since a standalone shape's canvas is its own
 * box. The manager swells a standalone shape's element instead.
 *
 * The shape's box and `origin` are in screen pixels, drawn at `zoom` screen
 * pixels per CSS pixel (see drawn-scale.ts); the frame is in CSS pixels, like
 * its corner radius.
 */
export const readShape = (
  element: HTMLElement,
  origin: DOMRect,
  zoom: number,
  elapsed: number,
  grow: boolean,
): GlassShapeFrame & { press: number } => {
  const box = element.getBoundingClientRect();
  const left = (box.left - origin.left) / zoom;
  const top = (box.top - origin.top) / zoom;
  const width = box.width / zoom;
  const height = box.height / zoom;
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const press = pressOf(element);
  const pressed = press ? stepPress(press, elapsed) : 0;
  const swell = grow ? 1 + PRESS_GROWTH * pressed : 1;
  return {
    centerX: left + width / 2,
    centerY: top + height / 2,
    halfWidth: (width / 2) * swell,
    halfHeight: (height / 2) * swell,
    radius: cornerRadius(style.borderTopLeftRadius, width, height) * swell,
    frost: element.getAttribute('glass-style') === 'clear' ? 0 : 1,
    tint: resolveCssColor(
      element.ownerDocument,
      element.getAttribute('glass-tint-color'),
    ),
    press: pressed,
  };
};

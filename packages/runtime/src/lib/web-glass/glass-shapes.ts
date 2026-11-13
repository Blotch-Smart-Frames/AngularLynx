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

// How much longer an interactive shape's longer side is while it's pressed,
// in px. UIKit's glass swells by the same amount whatever its size (measured
// on a 56px round button and a 69px capsule): a round button grows by a
// quarter, a bar across the screen by a few percent.
const PRESS_SWELL = 15;
// The most a shape grows: a control much smaller than a fingertip would
// otherwise double.
const MAX_PRESS_GROWTH = 0.3;

/**
 * The scale an interactive shape is drawn at for how far it's pressed: the
 * manager scales the element itself, content and all, as UIKit's glass does,
 * so the shape read here (see readShape) and its content grow together.
 */
export const pressScale = (element: HTMLElement): number => {
  const longer = Math.max(element.offsetWidth, element.offsetHeight);
  const growth = longer ? Math.min(PRESS_SWELL / longer, MAX_PRESS_GROWTH) : 0;
  return 1 + growth * (pressOf(element)?.value ?? 0);
};

/**
 * Reads one shape for a frame, relative to the group canvas at `origin`, and
 * advances its press animation by `elapsed` milliseconds.
 *
 * The shape's box and `origin` are in screen pixels, drawn at `zoom` screen
 * pixels per CSS pixel (see drawn-scale.ts); the frame is in CSS pixels. The
 * box is the element's as it's drawn, so a pressed shape's is the swollen
 * one, and its corner radius, a CSS length, is scaled to match.
 */
export const readShape = (
  element: HTMLElement,
  origin: DOMRect,
  zoom: number,
  elapsed: number,
): GlassShapeFrame & { press: number } => {
  const box = element.getBoundingClientRect();
  const left = (box.left - origin.left) / zoom;
  const top = (box.top - origin.top) / zoom;
  const width = box.width / zoom;
  const height = box.height / zoom;
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const press = pressOf(element);
  const pressed = press ? stepPress(press, elapsed) : 0;
  // How much the element itself is scaled: 1 unless it's pressed.
  const own = element.offsetWidth ? width / element.offsetWidth : 1;
  return {
    centerX: left + width / 2,
    centerY: top + height / 2,
    halfWidth: width / 2,
    halfHeight: height / 2,
    radius:
      cornerRadius(style.borderTopLeftRadius, width / own, height / own) * own,
    frost: element.getAttribute('glass-style') === 'clear' ? 0 : 1,
    tint: resolveCssColor(
      element.ownerDocument,
      element.getAttribute('glass-tint-color'),
    ),
    press: pressed,
  };
};

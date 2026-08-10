import type { ElementRef } from '../../types/lynx';

/**
 * SVG is a native Lynx element — the engine parses the SVG content
 * (set via the `content` attribute) on a background thread and renders
 * it as a single native view. No individual SVG child nodes are created.
 */
export const createSvgElement = (pageId: number): ElementRef => {
  return __CreateElement('svg', pageId);
};

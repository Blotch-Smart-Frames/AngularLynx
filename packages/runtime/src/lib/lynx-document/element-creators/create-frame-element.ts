import type { ElementRef } from '../../types/lynx';

/**
 * Native frame element — embeds a nested Lynx page (similar to HTML iframe).
 * Attributes (src, data, global-props) and events (bindload) are set via
 * standard __SetAttribute/__AddEvent by Angular template bindings.
 */
export const createFrameElement = (pageId: number): ElementRef => {
  return __CreateFrame(pageId);
};

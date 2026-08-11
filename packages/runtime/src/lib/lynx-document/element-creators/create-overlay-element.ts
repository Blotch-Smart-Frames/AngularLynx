import type { ElementRef } from '../../types/lynx';

/**
 * Native overlay — renders outside the Lynx document flow on a separate
 * rendering layer. Used for modals, bottom sheets, and dialogs that need
 * to cover the entire embedded page. Controlled via the `visible` attribute.
 */
export const createOverlayElement = (pageId: number): ElementRef => {
  return __CreateElement('overlay', pageId);
};

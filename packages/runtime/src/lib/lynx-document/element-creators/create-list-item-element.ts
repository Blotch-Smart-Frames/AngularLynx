import type { ElementRef } from '../../types/lynx';

/**
 * list requires native list-item elements via __CreateElement, not plain views.
 * The native componentAtIndex callback returns this element ID to the engine,
 * which expects a list-item type — using __CreateView crashes the native side.
 */
export const createListItemElement = (pageId: number): ElementRef => {
  return __CreateElement('list-item', pageId);
};

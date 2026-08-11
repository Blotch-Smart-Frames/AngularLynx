import type { ElementRef } from '../../types/lynx';

/**
 * No __SetConfig needed — bounces defaults to true per the API.
 * All scroll-view properties (scroll-orientation, enable-scroll, etc.)
 * are attributes, set via __SetAttribute by Angular template bindings.
 */
export const createScrollViewElement = (pageId: number): ElementRef => {
  return __CreateScrollView(pageId);
};

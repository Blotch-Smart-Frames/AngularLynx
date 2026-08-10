import type { ElementRef } from '../../types/lynx';

export const createTitleBarViewElement = (pageId: number): ElementRef => {
  return __CreateElement('title-bar-view', pageId);
};

import type { ElementRef } from '../../types/lynx';

export const createViewPagerElement = (pageId: number): ElementRef => {
  return __CreateElement('viewpager', pageId);
};

export const createViewPagerItemElement = (pageId: number): ElementRef => {
  return __CreateElement('viewpager-item', pageId);
};

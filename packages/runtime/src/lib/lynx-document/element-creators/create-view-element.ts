import type { ElementRef } from '../../types/lynx';

export const createViewElement = (pageId: number): ElementRef => {
  return __CreateView(pageId);
};

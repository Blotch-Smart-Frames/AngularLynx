import type { ElementRef } from '../../types/lynx';

export const createTextElement = (pageId: number): ElementRef => {
  return __CreateText(pageId);
};

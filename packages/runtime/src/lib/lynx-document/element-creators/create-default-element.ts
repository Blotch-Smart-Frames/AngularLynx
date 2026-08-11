import type { ElementRef } from '../../types/lynx';

export const createDefaultElement = (
  tag: string,
  pageId: number,
): ElementRef => {
  console.warn(`Unknown element tag "${tag}". Falling back to view element.`);
  return __CreateView(pageId);
};

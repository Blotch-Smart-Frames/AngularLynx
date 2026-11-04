import type { ElementRef } from '../../types/lynx';

export const createDefaultElement = (
  tag: string,
  pageId: number,
): ElementRef => {
  // angular-three's renderer asks for an element for each of its tags (an
  // `ngt-mesh`, an `ngt-canvas` host) before it decides whether the tag is a
  // three.js object, which never reaches the page: not worth a warning each.
  if (!tag.startsWith('ngt-')) {
    console.warn(`Unknown element tag "${tag}". Falling back to view element.`);
  }
  return __CreateView(pageId);
};

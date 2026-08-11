import type { ElementRef } from '../../types/lynx';

// Use __CreateElement('if') instead of __CreateIf().
// The Lynx web platform only implements the generic __CreateElement and does not
// expose the specialized __CreateIf/__CreateFor/__CreateBlock globals, so using
// those would throw at runtime on web. React Lynx (the production reference) also
// never calls the specialized forms — __CreateElement with a tag string is the
// idiomatic, cross-platform path.
export const createIfElement = (pageId: number): ElementRef => {
  return __CreateElement('if', pageId);
};

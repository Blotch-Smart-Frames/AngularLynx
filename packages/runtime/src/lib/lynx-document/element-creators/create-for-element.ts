import type { ElementRef } from '../../types/lynx';

// Use __CreateElement('for') instead of __CreateFor() — see create-if-element.ts
// for the full rationale. Same cross-platform compatibility requirement applies here.
export const createForElement = (pageId: number): ElementRef => {
  return __CreateElement('for', pageId);
};

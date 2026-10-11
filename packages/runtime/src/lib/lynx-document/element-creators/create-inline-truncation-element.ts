import type { ElementRef } from '../../types/lynx';

/**
 * Child of `<text>` that replaces the default ellipsis with custom content
 * when the text is truncated by `text-maxline`. Lynx's text layout only
 * recognizes it by this tag — as a view fallback it would render inline as
 * ordinary content instead of appearing only on truncation.
 */
export const createInlineTruncationElement = (pageId: number): ElementRef => {
  return __CreateElement('inline-truncation', pageId);
};

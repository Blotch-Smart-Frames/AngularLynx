import type { ElementRef } from '../../types/lynx';

/**
 * Angular uses comment nodes as insertion anchors for dynamic views
 * (createComponent, @if, @for, @switch). Lynx has no comment primitive, so we
 * use an invisible <view> (display:none) — still a valid tree participant that
 * supports __InsertElementBefore / __GetParent / __NextElement, unlike
 * __CreateNonElement which crashes on those.
 *
 * Extracted so both LynxDocument.createComment and createNativeRefByTag build
 * the anchor identically. The display:none is applied here directly (not through
 * a cached setStyle), so a recreated anchor stays invisible even though that
 * style is NOT in the element's recreation style cache.
 */
export const createCommentElement = (pageId: number): ElementRef => {
  const element = __CreateView(pageId);
  __AddInlineStyle(element, 'display', 'none');
  return element;
};

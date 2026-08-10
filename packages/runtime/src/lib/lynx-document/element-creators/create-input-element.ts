import type { ElementRef } from '../../types/lynx';

/**
 * XElements — use generic __CreateElement (no dedicated creation functions).
 * Require native-side input plugin to be registered by the app host.
 */
export const createInputElement = (
  tag: 'input' | 'textarea',
  pageId: number,
): ElementRef => {
  const element = __CreateElement(tag, pageId);

  // Native Lynx inputs have no intrinsic height or border (unlike HTML inputs),
  // so provide sensible defaults so the element is always visible.
  __AddInlineStyle(element, 'height', tag === 'textarea' ? '80px' : '40px');
  __AddInlineStyle(element, 'border', '1px solid');

  return element;
};

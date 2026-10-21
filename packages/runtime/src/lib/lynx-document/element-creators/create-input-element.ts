import type { ElementRef } from '../../types/lynx';

/**
 * XElements — use generic __CreateElement (no dedicated creation functions).
 * Require native-side input plugin to be registered by the app host.
 *
 * No default styles, as in React Lynx: a field is one line of text tall on
 * every platform (iOS and Android measure it from the font), and it has no
 * border. Inline defaults would beat the app's classes, so `h-[120px]` or
 * `border-zinc-200` on an `<input>` would never apply.
 */
export const createInputElement = (
  tag: 'input' | 'textarea',
  pageId: number,
): ElementRef => {
  return __CreateElement(tag, pageId);
};

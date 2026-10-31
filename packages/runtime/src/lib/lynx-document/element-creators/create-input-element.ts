import type { ElementRef } from '../../types/lynx';
import { stackWebTextarea } from '../web-textarea';

/**
 * XElements — use generic __CreateElement (no dedicated creation functions).
 * Require native-side input plugin to be registered by the app host.
 *
 * No default styles, as in React Lynx: a field is one line of text tall on
 * every platform (iOS and Android measure it from the font), and it has no
 * border. Inline defaults would beat the app's classes, so `h-[120px]` or
 * `border-zinc-200` on an `<input>` would never apply.
 *
 * On Lynx for Web a textarea also needs web-elements' `z-index` handling for
 * inputs (see web-textarea.ts). `__WEB__` is a compile-time define, so native
 * bundles drop the call; only the main thread creates real elements.
 */
export const createInputElement = (
  tag: 'input' | 'textarea',
  pageId: number,
): ElementRef => {
  const element = __CreateElement(tag, pageId);
  if (__WEB__ && __MAIN_THREAD__ && tag === 'textarea') {
    stackWebTextarea(element);
  }
  return element;
};

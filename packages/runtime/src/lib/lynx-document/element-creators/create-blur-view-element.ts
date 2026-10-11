import type { ElementRef } from '../../types/lynx';

/**
 * Native backdrop blur (Lynx 4.0+). Blurs whatever is rendered BEHIND the
 * element, like CSS `backdrop-filter: blur()`, which Lynx doesn't support as a
 * style. On iOS 26+ `blur-effect="glass"` renders Apple's Liquid Glass
 * material. It must be a real `blur-view`: the unknown-tag view fallback would
 * silently ignore every blur attribute and render a plain view with no blur.
 */
export const createBlurViewElement = (pageId: number): ElementRef => {
  return __CreateElement('blur-view', pageId);
};

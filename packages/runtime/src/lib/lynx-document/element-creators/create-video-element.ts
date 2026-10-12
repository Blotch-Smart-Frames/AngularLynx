import type { ElementRef } from '../../types/lynx';

/**
 * Native video player (experimental, Lynx 4.1+). Playback is driven by UI
 * methods (`play`, `pause`, `stop`, `seek`) invoked through SelectorQuery, not
 * by attributes — there is no `autoplay`.
 */
export const createVideoElement = (pageId: number): ElementRef => {
  return __CreateElement('video', pageId);
};

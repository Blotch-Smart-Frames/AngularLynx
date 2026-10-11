import type { ElementRef } from '../../types/lynx';

/**
 * Clay desktop (Windows/macOS) container that renders its subtree into a
 * platform overlay surface ABOVE embedded native views (e.g. a `<webview>`),
 * which normally paint over regular Lynx content. Has no effect on mobile.
 */
export const createCoverViewElement = (pageId: number): ElementRef => {
  return __CreateElement('cover-view', pageId);
};

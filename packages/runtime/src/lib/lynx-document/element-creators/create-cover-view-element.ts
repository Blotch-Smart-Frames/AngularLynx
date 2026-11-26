import type { ElementRef } from '../../types/lynx';
import { createDesktopOnlyElement } from './create-desktop-only-element';

/**
 * Clay desktop (Windows/macOS) container that renders its subtree into a
 * platform overlay surface ABOVE embedded native views (e.g. a `<webview>`),
 * which normally paint over regular Lynx content. iOS, Android and the web
 * have no `<cover-view>`, so it's a `<view>` there (see
 * createDesktopOnlyElement).
 */
export const createCoverViewElement = (pageId: number): ElementRef => {
  return createDesktopOnlyElement('cover-view', pageId);
};

import type { ElementRef } from '../../types/lynx';
import { createDesktopOnlyElement } from './create-desktop-only-element';

/**
 * A window's drag handle on Lynx's desktop renderers, and a `<view>` on iOS,
 * Android and the web, which have no `<title-bar-view>` (see
 * createDesktopOnlyElement).
 */
export const createTitleBarViewElement = (pageId: number): ElementRef => {
  return createDesktopOnlyElement('title-bar-view', pageId);
};

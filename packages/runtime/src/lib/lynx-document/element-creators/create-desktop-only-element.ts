import type { ElementRef } from '../../types/lynx';

/**
 * Whether this is one of Lynx's desktop renderers (Clay, on Windows and
 * macOS). On the native main thread, where elements are created, there is no
 * global `SystemInfo`, only `lynx.SystemInfo` (see isAndroid); the web has
 * the global.
 */
const isDesktop = (): boolean => {
  const info =
    (typeof lynx !== 'undefined'
      ? (lynx as { SystemInfo?: { platform?: string } }).SystemInfo
      : undefined) ??
    (typeof SystemInfo !== 'undefined' ? SystemInfo : undefined);
  return info?.platform === 'windows' || info?.platform === 'macOS';
};

/**
 * Creates an element only Lynx's desktop renderers have (`<title-bar-view>`,
 * `<cover-view>`), or a `<view>` everywhere else.
 *
 * iOS, Android and the web preview register no UI for these tags. iOS then
 * draws nothing for the element, its children included, and Android can drop
 * the elements after it (#678), so the title an app puts in its title bar
 * vanishes on a phone. What these elements add on the desktop, dragging the
 * window or drawing above native views, has no meaning on a phone, so a
 * `<view>` keeps their content and layout and loses nothing a phone could do.
 * Harmony is left out too: it doesn't list either element.
 */
export const createDesktopOnlyElement = (
  tag: string,
  pageId: number,
): ElementRef => {
  if (__WEB__ || !isDesktop()) return __CreateView(pageId);
  return __CreateElement(tag, pageId);
};

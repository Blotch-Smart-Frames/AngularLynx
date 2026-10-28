/**
 * The id the page gets on Android, so that every `blur-view` can name the
 * page as the view it blurs (`android-capture-target`).
 *
 * Android's blur-view isn't a real backdrop blur. It redraws one ancestor view
 * into a bitmap and blurs that, and while it redraws, every blur-view in that
 * ancestor skips drawing itself (so it doesn't blur its own output). Left to
 * itself, it picks the nearest ancestor that is `overflow: hidden` or contains
 * it. For a blur-view inside another blur-view, such as a glass shape in a
 * `glass-container` or a button on a frosted panel, that ancestor is the outer
 * blur-view: the redraw holds nothing, and the inner blur-view shows nothing.
 * Redrawing the page instead blurs what is on screen behind the blur-view,
 * which is what iOS does. Only the blur-view's own area is redrawn.
 */
export const ANDROID_BLUR_CAPTURE_TARGET = 'angular-lynx-page';

/**
 * The platform Lynx is rendering on, as SystemInfo names it. On the native
 * main thread, where elements are created, there is no global `SystemInfo`,
 * only `lynx.SystemInfo`; the background thread and web have the global.
 */
export const nativePlatform = (): string | undefined => {
  const info =
    (typeof lynx !== 'undefined'
      ? (lynx as { SystemInfo?: { platform?: string } }).SystemInfo
      : undefined) ??
    (typeof SystemInfo !== 'undefined' ? SystemInfo : undefined);
  return info?.platform;
};

/** Whether this is Lynx's Android renderer (see nativePlatform). */
export const isAndroid = (): boolean => nativePlatform() === 'Android';

import type { ElementRef } from '../../types/lynx';

/**
 * No defaults to set: like React Lynx, an `<image>` starts with Lynx's own
 * `mode`, `scaleToFill`, which iOS, Android and the web all share (and which
 * matches the web's `object-fit: fill`). Setting a different one would have to
 * go through `__SetAttribute`: `__SetConfig` only stores a table for
 * `__GetConfig`, and never reaches the native image or `x-image`.
 */
export const createImageElement = (pageId: number): ElementRef => {
  return __CreateImage(pageId);
};

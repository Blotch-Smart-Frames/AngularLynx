import type { ElementRef } from '../types/lynx';
import { applyBlurViewLayout } from './blur-view-layout';
import { GlassManager } from './glass-manager';

/**
 * Gives a `<blur-view>` on Lynx for Web what web-elements' `<x-blur-view>`
 * lacks: a view's layout (see blur-view-layout.ts), and Liquid Glass.
 *
 * On iOS 26, `blur-effect="glass"` and `"glass-container"` render UIKit's
 * glass. Lynx for Web turns `<blur-view>` into an `<x-blur-view>` custom
 * element that only implements `blur-radius`, so glass elements would show at
 * most a frosted blur, and merging and refraction not at all. This draws them
 * with WebGL instead (see glass-group.ts), from the same attributes.
 *
 * Called for every `<blur-view>` the main thread creates. On web that thread
 * runs in an iframe while its elements live in the page, so everything here
 * goes through the element's own window, never this realm's globals.
 */
export const attachWebGlass = (element: ElementRef): void => {
  const node = element as Partial<HTMLElement>;
  const win = node.ownerDocument?.defaultView;
  if (!win) return;
  // Every blur view needs it, glass or not, and before its first paint, which
  // this microtask after creation still is.
  applyBlurViewLayout(node as HTMLElement);
  // Only a real element in a browser can host the glass.
  if (!win.IntersectionObserver) return;
  try {
    GlassManager.for(win).register(node as HTMLElement);
  } catch {
    // Glass is decoration: never let it break rendering.
  }
};

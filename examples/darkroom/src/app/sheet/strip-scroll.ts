import { type ElementRef, type Signal, effect, untracked } from '@angular/core';

/** An element's UI methods, called with `invoke()`. */
type WithUiMethods = {
  invoke?(method: string, params: Record<string, unknown>): unknown;
};

/**
 * Keeps a strip's chosen frame, and the marker ring round it, in view: when
 * the choice changes, and when the sheet opens on a frame far along the
 * strip (a restored session, a later photo). The frame's own
 * `scrollIntoView` UI method scrolls the strip it's in to center it; the
 * first move is instant, later ones glide.
 *
 * Lynx reads the options from `scrollIntoViewOptions`; the web preview
 * passes the top-level ones to the DOM's `scrollIntoView`, where `block:
 * 'nearest'` keeps the sheet itself from scrolling to the strip.
 */
export const keepChosenInView = (
  frames: Signal<readonly ElementRef<WithUiMethods>[]>,
  chosen: () => number,
): void => {
  let moved = false;
  effect(() => {
    const index = chosen();
    const frame = frames()[index];
    if (!frame) return;
    const behavior = moved ? 'smooth' : 'none';
    moved = true;
    // After this render, so the strip has its new frames laid out.
    setTimeout(() =>
      untracked(() => frame).nativeElement.invoke?.('scrollIntoView', {
        scrollIntoViewOptions: { inline: 'center', behavior },
        block: 'nearest',
        inline: 'center',
        behavior: behavior === 'none' ? 'auto' : 'smooth',
      }),
    );
  });
};

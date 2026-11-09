import { pageOf } from '../../gesture/web/touch-point';
import { drawnScale } from '../../web-glass/drawn-scale';
import type { ScreenBox } from './stack-motion';

/**
 * An element the outlet measures: a LynxElement, whose `element` is the
 * native element (on Lynx for Web, the DOM element), or a DOM element itself
 * (in tests).
 */
export type MeasuredElement = {
  getBoundingClientRect(): {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly element?: unknown;
};

/**
 * An element's box as native Lynx measures it: relative to the LynxView, in
 * the LynxView's own px. That's where Lynx's touch and mouse events put their
 * positions, and what `innerWidth` and the outlet's styles count in, so the
 * outlet measures in it to move pages with a finger and by their width.
 *
 * Native Lynx's getBoundingClientRect() is that already. On Lynx for Web it's
 * the DOM's, measured from the browser's viewport in screen pixels, which
 * differ from the view's own when the `<lynx-view>` isn't at the page's top
 * left, or a transform scales it, as the docs' previews do (see
 * drawn-scale.ts). There the outlet measured itself 0.68 of its width, so a
 * pop slid the page two thirds of the way out before the page went, and a
 * push rounded only the page's top-left corner. So on the web the box is
 * worked out from the DOM's: the element's minus the `<lynx-view>`'s,
 * divided by the scale the view is drawn at, as gestures do with a touch
 * (see touch-point.ts).
 */
export const boxInLynxView = (element: MeasuredElement): ScreenBox => {
  if (!__WEB__) {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  }
  const dom = (element.element ?? element) as Element;
  const view = pageOf(dom) as HTMLElement;
  const scale = drawnScale(view);
  const box = dom.getBoundingClientRect();
  const origin = view.getBoundingClientRect();
  return {
    left: (box.left - origin.left) / scale,
    top: (box.top - origin.top) / scale,
    width: box.width / scale,
    height: box.height / scale,
  };
};

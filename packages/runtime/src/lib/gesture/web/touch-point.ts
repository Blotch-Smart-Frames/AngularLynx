import { drawnScale } from '../../web-glass/drawn-scale';

/**
 * The phases of a touch, named as Lynx's gesture handlers name them.
 */
export type TouchType = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';

export type Point = { readonly x: number; readonly y: number };

export const ORIGIN: Point = { x: 0, y: 0 };

/**
 * Where a pointer is during a touch, in the fields Lynx's handlers put in a
 * gesture event's params (`eventParamsFromTouchEvent` in
 * LynxBaseGestureHandler.m). Every length is in the page's CSS pixels, so a
 * preview scaled down to fit (as the docs' are) still measures a 10px
 * `maxDistance` as 10 of the page's pixels, and a pan's translation moves an
 * element under the pointer.
 */
export type TouchPoint = {
  readonly type: TouchType;
  readonly timestamp: number;
  /**
   * From the top left of the element the touch started on.
   */
  readonly x: number;
  readonly y: number;
  /**
   * From the top left of the page (the `<lynx-view>`).
   */
  readonly pageX: number;
  readonly pageY: number;
  /**
   * The browser's own viewport coordinates, untouched, as web-core keeps them.
   */
  readonly clientX: number;
  readonly clientY: number;
};

/**
 * The page a Lynx for Web element is drawn in: the `<lynx-view>` whose shadow
 * root holds it, or the document's root element outside one. The host is
 * found by its `host` property, not `instanceof ShadowRoot`: the main thread
 * runs in an iframe, whose ShadowRoot isn't the page's.
 */
export const pageOf = (element: Element): Element => {
  const root = element.getRootNode() as Partial<ShadowRoot>;
  return root.host ?? element.ownerDocument.documentElement;
};

/**
 * Where `event` is, as a point of the touch that started on `target`.
 */
export const touchPointOf = (
  event: PointerEvent,
  type: TouchType,
  target: Element,
): TouchPoint => {
  const page = pageOf(target);
  const scale = drawnScale(page as HTMLElement);
  const pageBox = page.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  return {
    type,
    timestamp: event.timeStamp,
    x: (event.clientX - box.left) / scale,
    y: (event.clientY - box.top) / scale,
    pageX: (event.clientX - pageBox.left) / scale,
    pageY: (event.clientY - pageBox.top) / scale,
    clientX: event.clientX,
    clientY: event.clientY,
  };
};

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pageOf, type TouchPoint, touchPointOf } from './touch-point';

/**
 * Gives `element` a box, in the viewport's (drawn) pixels.
 */
const place = (
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  laidOutWidth = width,
) => {
  element.getBoundingClientRect = () =>
    ({ left, top, width, height: width }) as DOMRect;
  Object.defineProperty(element, 'offsetWidth', { value: laidOutWidth });
};

const pointer = (clientX: number, clientY: number, timeStamp: number) =>
  ({ clientX, clientY, timeStamp }) as PointerEvent;

describe('pageOf', () => {
  it("is the host of the shadow root an element's in: its <lynx-view>", () => {
    const host = document.createElement('lynx-view');
    const element = document.createElement('x-view');
    host.attachShadow({ mode: 'open' }).append(element);
    expect(pageOf(element)).toBe(host);
  });

  it("is the document's root element outside one", () => {
    const element = document.createElement('div');
    document.body.append(element);
    expect(pageOf(element)).toBe(document.documentElement);
  });
});

describe('touchPointOf', () => {
  it('measures in the page and the target, in the page CSS pixels', () => {
    const host = document.createElement('lynx-view');
    const target = document.createElement('x-view');
    host.attachShadow({ mode: 'open' }).append(target);
    // Drawn at half size, as the docs' previews shrink a page to fit.
    place(host, 100, 50, 200, 400);
    place(target, 120, 70, 20, 40);

    expect(touchPointOf(pointer(130, 90, 12), 'touchmove', target)).toEqual({
      type: 'touchmove',
      timestamp: 12,
      x: 20,
      y: 40,
      pageX: 60,
      pageY: 80,
      clientX: 130,
      clientY: 90,
    } satisfies TouchPoint);
  });
});

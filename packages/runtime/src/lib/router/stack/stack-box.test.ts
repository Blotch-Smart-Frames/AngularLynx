// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boxInLynxView } from './stack-box';

/**
 * Gives `element` a box in the browser's viewport, in screen pixels, and the
 * width it's laid out at, which a transform drawing it smaller leaves alone.
 */
const place = (
  element: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
  laidOutWidth = box.width,
) => {
  element.getBoundingClientRect = () => box as DOMRect;
  Object.defineProperty(element, 'offsetWidth', { value: laidOutWidth });
};

describe('boxInLynxView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is native Lynx's own box, which is relative to the LynxView already", () => {
    vi.stubGlobal('__WEB__', false);
    const element = {
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 30,
        height: 40,
        right: 40,
        bottom: 60,
      }),
    };
    expect(boxInLynxView(element)).toEqual({
      left: 10,
      top: 20,
      width: 30,
      height: 40,
    });
  });

  it("measures a web element from its <lynx-view>'s top left, in the view's own pixels", () => {
    vi.stubGlobal('__WEB__', true);
    const view = document.createElement('lynx-view');
    const dom = document.createElement('x-view');
    view.attachShadow({ mode: 'open' }).append(dom);
    // Laid out 400 wide and drawn at half that, 100px in from the page's
    // left, as a docs preview draws a phone-sized page.
    place(view, { left: 100, top: 50, width: 200, height: 400 }, 400);
    place(dom, { left: 110, top: 70, width: 150, height: 300 });
    // A LynxElement, whose `element` is the DOM element. Its own
    // getBoundingClientRect() is the DOM's, which isn't what's wanted.
    const element = {
      element: dom,
      getBoundingClientRect: () => dom.getBoundingClientRect(),
    };

    expect(boxInLynxView(element)).toEqual({
      left: 20,
      top: 40,
      width: 300,
      height: 600,
    });
  });

  it('measures a DOM element itself, from the document outside a <lynx-view>', () => {
    vi.stubGlobal('__WEB__', true);
    const dom = document.createElement('div');
    document.body.append(dom);
    place(dom, { left: 5, top: 6, width: 7, height: 8 });

    expect(boxInLynxView(dom)).toEqual({
      left: 5,
      top: 6,
      width: 7,
      height: 8,
    });
  });
});

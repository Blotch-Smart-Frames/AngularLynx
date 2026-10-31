// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  pageOf,
  type TouchPoint,
  touchPointOf,
  VelocityTracker,
} from './touch-point';

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

describe('VelocityTracker', () => {
  const at = (timestamp: number, pageX: number, pageY = 0) =>
    ({ timestamp, pageX, pageY }) as TouchPoint;

  it('is still with fewer than two samples', () => {
    const tracker = new VelocityTracker();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
    tracker.add(at(0, 10));
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('averages the last 100ms, in pixels a second', () => {
    const tracker = new VelocityTracker();
    tracker.add(at(0, 0));
    tracker.add(at(500, 0));
    tracker.add(at(550, 20, -10));
    tracker.add(at(600, 50, -20));
    expect(tracker.velocity()).toEqual({ x: 500, y: -200 });
  });

  it('is still for samples at the same time', () => {
    const tracker = new VelocityTracker();
    tracker.add(at(5, 0));
    tracker.add(at(5, 30));
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('forgets a reset touch', () => {
    const tracker = new VelocityTracker();
    tracker.add(at(0, 0));
    tracker.add(at(50, 100));
    tracker.reset();
    tracker.add(at(60, 0));
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });
});

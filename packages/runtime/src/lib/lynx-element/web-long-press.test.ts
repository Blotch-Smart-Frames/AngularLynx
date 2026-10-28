import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';
import {
  dropsTap,
  LONG_PRESS_DURATION,
  type LongPressPoint,
  WebLongPress,
} from './web-long-press';

/**
 * A web-core touch event: the first touch's position is in `detail`.
 */
const touch = (x: number, y: number) => ({ detail: { x, y } });
/**
 * A web-core mouse event: its position is on it; `detail` is a count.
 */
const mouse = (x: number, y: number, button = 0) => ({
  detail: 1,
  x,
  y,
  button,
});

describe('WebLongPress', () => {
  let fire: ReturnType<typeof vi.fn<(point: LongPressPoint) => void>>;
  let press: WebLongPress;

  beforeEach(() => {
    vi.useFakeTimers();
    fire = vi.fn<(point: LongPressPoint) => void>();
    press = new WebLongPress(fire);
  });

  afterEach(() => {
    // Ends any press still held, and lets the tap after it through again.
    press.end();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });

  it('fires where a touch is held, and drops the tap that ends it', () => {
    press.start(touch(10, 20));
    vi.advanceTimersByTime(LONG_PRESS_DURATION - 1);
    expect(fire).not.toHaveBeenCalled();
    expect(dropsTap()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledWith({ x: 10, y: 20 });
    // Held for as long as the finger stays down.
    vi.advanceTimersByTime(5000);
    expect(dropsTap()).toBe(true);

    press.end();
    expect(dropsTap()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(dropsTap()).toBe(false);
  });

  it('fires for the main mouse button, held', () => {
    press.start(mouse(4, 5));
    vi.advanceTimersByTime(LONG_PRESS_DURATION);

    expect(fire).toHaveBeenCalledWith({ x: 4, y: 5 });
  });

  it('ignores other mouse buttons, which open the browser menu', () => {
    press.start(mouse(4, 5, 2));
    vi.advanceTimersByTime(LONG_PRESS_DURATION);

    expect(fire).not.toHaveBeenCalled();
  });

  it('takes an event without a position as at the origin', () => {
    press.start({});
    vi.advanceTimersByTime(LONG_PRESS_DURATION);

    expect(fire).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it('is no long press when released early, and lets its tap through', () => {
    press.start(touch(0, 0));
    vi.advanceTimersByTime(100);
    press.end();
    vi.advanceTimersByTime(LONG_PRESS_DURATION);

    expect(fire).not.toHaveBeenCalled();
    expect(dropsTap()).toBe(false);
  });

  it('is no long press when it moves away, but survives a wobble', () => {
    press.start(touch(0, 0));
    press.move(touch(6, 8));
    vi.advanceTimersByTime(LONG_PRESS_DURATION);
    expect(fire).toHaveBeenCalledTimes(1);
    press.end();

    press.start(mouse(0, 0));
    press.move(mouse(8, 8));
    vi.advanceTimersByTime(LONG_PRESS_DURATION);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('ignores moves with no press down', () => {
    press.move(mouse(50, 50));
    press.end();

    expect(fire).not.toHaveBeenCalled();
  });

  it('keeps dropping taps while a later long press is held', () => {
    // An ancestor recognizes its own long press from the same touches.
    const other = new WebLongPress(fire);
    press.start(touch(0, 0));
    vi.advanceTimersByTime(100);
    other.start(touch(0, 0));
    vi.advanceTimersByTime(LONG_PRESS_DURATION - 100);
    press.end();
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(2);

    // The first one's end doesn't let taps through during the second.
    vi.advanceTimersByTime(300);
    expect(dropsTap()).toBe(true);

    other.end();
    vi.advanceTimersByTime(300);
    expect(dropsTap()).toBe(false);
  });

  it('starts over when a second press starts', () => {
    press.start(touch(0, 0));
    vi.advanceTimersByTime(400);
    press.start(touch(30, 30));
    vi.advanceTimersByTime(400);
    expect(fire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledWith({ x: 30, y: 30 });
  });
});

describe('LynxElement on Lynx for Web', () => {
  /** The handler registered natively for each event name, as web-core keeps it. */
  let handlers: Map<string, (event: unknown) => unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('__WEB__', true);
    handlers = new Map();
    let nextId = 1;
    const ids = new WeakMap<object, number>();
    vi.stubGlobal('__GetElementUniqueID', (ref: object) => {
      if (!ids.has(ref)) ids.set(ref, nextId++);
      return ids.get(ref);
    });
    vi.stubGlobal(
      '__AddEvent',
      (
        _element: ElementRef,
        _type: string,
        name: string,
        handler?: { value: (event: unknown) => unknown },
      ) => {
        if (handler) handlers.set(name, handler.value);
      },
    );
    vi.stubGlobal('__FlushElementTree', () => {});
  });

  afterEach(() => {
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fireEvent = (name: string, event: object = {}) =>
    handlers.get(name)!({ type: name, ...event });

  it('fires longpress listeners for a held press, and no tap after it', () => {
    const element = new LynxElement({} as ElementRef);
    const longPress = vi.fn();
    const tap = vi.fn();
    element.addEventListener('bindlongpress', longPress);
    element.addEventListener('bindtap', tap);

    fireEvent('touchstart', { detail: { x: 3, y: 4 } });
    vi.advanceTimersByTime(LONG_PRESS_DURATION);
    expect(longPress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'longpress', detail: { x: 3, y: 4 } }),
    );

    fireEvent('touchend');
    fireEvent('tap');
    expect(tap).not.toHaveBeenCalled();

    // A later tap goes through.
    vi.advanceTimersByTime(1000);
    fireEvent('tap');
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('recognizes from the mouse too, once for any number of listeners', () => {
    const element = new LynxElement({} as ElementRef);
    const first = vi.fn();
    const second = vi.fn();
    element.addEventListener('bindlongpress', first);
    element.addEventListener('catchlongpress', second);

    fireEvent('mousedown', { detail: 1, x: 1, y: 2, button: 0 });
    fireEvent('mousemove', { detail: 0, x: 2, y: 2 });
    vi.advanceTimersByTime(LONG_PRESS_DURATION);
    fireEvent('mouseup');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does nothing once its longpress listeners are gone', () => {
    const element = new LynxElement({} as ElementRef);
    const longPress = vi.fn();
    const remove = element.addEventListener('bindlongpress', longPress);
    remove();

    fireEvent('touchstart', { detail: { x: 0, y: 0 } });
    vi.advanceTimersByTime(LONG_PRESS_DURATION);

    expect(longPress).not.toHaveBeenCalled();
  });

  it('leaves long presses to native Lynx, which fires them', () => {
    vi.stubGlobal('__WEB__', false);
    const element = new LynxElement({} as ElementRef);
    element.addEventListener('bindlongpress', vi.fn());

    expect(handlers.has('touchstart')).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

// Pointer events, layout reads and capture on Lynx elements (see
// pointer-events.ts and layout.ts).

let nextUid = 1;
const idsByRef = new WeakMap<object, number>();

/**
 * The handler the element registered natively for an event.
 */
const handler = (name: string) => {
  const calls = vi
    .mocked(globalThis.__AddEvent)
    .mock.calls.filter(([, , eventName, value]) => eventName === name && value);
  const [, , , value] = calls.at(-1)!;
  return (value as { value: (event: unknown) => unknown }).value;
};

beforeEach(() => {
  globalThis.__GetElementUniqueID = vi.fn((ref: object) => {
    let id = idsByRef.get(ref);
    if (id == null) {
      id = nextUid++;
      idsByRef.set(ref, id);
    }
    return id;
  });
  globalThis.__AddEvent = vi.fn();
  globalThis.__InvokeUIMethod = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pointer events on Lynx', () => {
  it('come from the element’s touches', () => {
    const ref = {} as ElementRef;
    const element = new LynxElement(ref);
    const down = vi.fn();
    const remove = element.addEventListener('pointerdown', down);
    const uid = __GetElementUniqueID(ref);
    handler('touchstart')({
      target: { uid },
      changedTouches: [{ identifier: 1, x: 3, y: 4, pageX: 3, pageY: 4 }],
    });
    expect(down).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pointerdown',
        offsetX: 3,
        target: element,
      }),
    );
    // The element follows its layout, for touches on its children.
    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      ref,
      'bindEvent',
      'layoutchange',
      expect.anything(),
    );
    remove();
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', down);
  });

  it('are captured, as far as a Lynx touch can be', () => {
    const element = new LynxElement({} as ElementRef);
    element.setPointerCapture(1);
    element.releasePointerCapture(1);
    expect(element.hasPointerCapture(1)).toBe(false);
    const got = vi.fn();
    element.addEventListener('gotpointercapture', got);
    handler('touchstart')({ changedTouches: [{ identifier: 1 }] });
    element.setPointerCapture(1);
    expect(element.hasPointerCapture(1)).toBe(true);
    expect(got).toHaveBeenCalled();
    element.releasePointerCapture(1);
    expect(element.hasPointerCapture(1)).toBe(false);
  });

  it('put a click where the pointer lifted', () => {
    const element = new LynxElement({} as ElementRef);
    const click = vi.fn();
    element.addEventListener('click', click);
    handler('tap')({ type: 'tap' });
    expect(click.mock.calls[0][0].offsetX).toBeUndefined();

    element.addEventListener('pointerup', () => {});
    handler('touchstart')({
      changedTouches: [{ identifier: 1, x: 5, y: 6, pageX: 5, pageY: 6 }],
    });
    handler('touchend')({
      target: { uid: __GetElementUniqueID(element.element) },
      changedTouches: [{ identifier: 1, x: 7, y: 8 }],
    });
    handler('tap')({ type: 'tap' });
    expect(click.mock.calls[1][0]).toMatchObject({
      offsetX: 7,
      offsetY: 8,
      button: 0,
      pointerType: 'touch',
    });
    // One that has offsets keeps them.
    handler('tap')({ type: 'tap', offsetX: 1 });
    expect(click.mock.calls[2][0].offsetX).toBe(1);
    handler('tap')(null);
    expect(click).toHaveBeenLastCalledWith(null);
  });
});

describe('pointer events on Lynx for Web', () => {
  const domElement = () => {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    return {
      addEventListener: vi.fn(
        (name: string, listener: (event: unknown) => void) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        },
      ),
      removeEventListener: vi.fn(),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      getBoundingClientRect: vi.fn(() => ({ width: 30, height: 40 })),
      fire: (name: string, event: unknown) =>
        listeners.get(name)?.forEach((listener) => listener(event)),
    };
  };

  beforeEach(() => {
    vi.stubGlobal('__WEB__', true);
  });

  it('are the browser’s own, on the DOM element', () => {
    const dom = domElement();
    const element = new LynxElement(dom as unknown as ElementRef);
    const move = vi.fn();
    const remove = element.addEventListener('pointermove', move);
    element.addEventListener('pointerdown', move);
    expect(dom.addEventListener).toHaveBeenCalledWith('pointermove', move);
    // The pointer's position is kept once, for clicks.
    expect(
      dom.addEventListener.mock.calls.filter(([name]) => name === 'pointerup'),
    ).toHaveLength(1);
    remove();
    element.removeEventListener('pointerdown', move);
    expect(dom.removeEventListener).toHaveBeenCalledWith('pointermove', move);
    expect(dom.removeEventListener).toHaveBeenCalledWith('pointerdown', move);
    element.setPointerCapture(2);
    element.releasePointerCapture(2);
    expect(element.hasPointerCapture(2)).toBe(true);
    expect(dom.setPointerCapture).toHaveBeenCalledWith(2);
    expect(dom.releasePointerCapture).toHaveBeenCalledWith(2);
    expect(element.getBoundingClientRect()).toEqual({ width: 30, height: 40 });
  });

  it('put a click where the pointer lifted', () => {
    const dom = domElement();
    const element = new LynxElement(dom as unknown as ElementRef);
    const click = vi.fn();
    element.addEventListener('pointerdown', () => {});
    element.addEventListener('click', click);
    dom.fire('pointerdown', { offsetX: 1, offsetY: 2 });
    dom.fire('pointerup', { offsetX: 3, offsetY: 4 });
    handler('tap')({ type: 'tap' });
    expect(click.mock.calls[0][0]).toMatchObject({
      offsetX: 3,
      offsetY: 4,
      pointerType: 'mouse',
    });
  });
});

describe('layout reads', () => {
  it('are empty until the element is laid out', () => {
    const element = new LynxElement({} as ElementRef);
    expect(element.layoutRect).toBeNull();
    expect(element.getBoundingClientRect()).toMatchObject({
      width: 0,
      height: 0,
    });
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledWith(
      element.element,
      'boundingClientRect',
      {},
      expect.any(Function),
    );
  });

  it('come from the element’s layoutchange, or the box it had', () => {
    const element = new LynxElement({} as ElementRef);
    const observer = vi.fn();
    const stop = element.observeLayout(observer);
    const [[, , , answer]] = vi.mocked(globalThis.__InvokeUIMethod).mock.calls;
    answer({ code: 1, data: null });
    expect(element.layoutRect).toBeNull();
    answer({ code: 0, data: { left: 1, top: 2, width: 3, height: 4 } });
    expect(element.layoutRect).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
    });
    handler('layoutchange')({
      detail: { left: 10, top: 20, width: 30, height: 40 },
    });
    expect(element.clientWidth).toBe(30);
    expect(element.clientHeight).toBe(40);
    expect(element.offsetWidth).toBe(30);
    expect(element.offsetHeight).toBe(40);
    expect(element.getBoundingClientRect()).toMatchObject({
      left: 10,
      top: 20,
      right: 40,
      bottom: 60,
    });
    expect(observer).toHaveBeenCalledTimes(2);
    stop();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureType } from '../types';
import {
  createHandlers,
  FLING_END,
  HandlerState,
  type WebGestureDetector,
  type WebGestureHandler,
} from './handlers';
import type { TouchPoint, TouchType } from './touch-point';

let nextId = 1;

const ALL_CALLBACKS = ['onBegin', 'onStart', 'onUpdate', 'onEnd'];

const detector = (
  type: GestureType,
  callbacks = ALL_CALLBACKS,
  config?: Record<string, unknown>,
): WebGestureDetector => ({
  id: nextId++,
  type,
  callbacks: new Map(callbacks.map((name) => [name, {}])),
  config,
  waitFor: [],
  simultaneous: [],
  continueWith: [],
});

/**
 * A touch at `x` (and `y`) in page pixels.
 */
const at = (type: TouchType, x: number, y = 0): TouchPoint => ({
  type,
  timestamp: 7,
  x: x + 1,
  y: y + 1,
  pageX: x,
  pageY: y,
  clientX: x * 2,
  clientY: y * 2,
});

const setup = (
  type: GestureType,
  callbacks?: string[],
  config?: Record<string, unknown>,
) => {
  const calls: [string, Record<string, unknown>][] = [];
  const [handler] = createHandlers(
    [detector(type, callbacks, config)],
    (_detector, name, params) => calls.push([name, params]),
  );
  const names = () => calls.map(([name]) => name);
  const params = (name: string) =>
    calls.filter(([other]) => other === name).at(-1)?.[1];
  return { handler, calls, names, params };
};

const touch = (handler: WebGestureHandler, type: TouchType, x: number) =>
  handler.handle(type, at(type, x), { x: 0, y: 0 });

const frame = (handler: WebGestureHandler, x: number, y = 0) =>
  handler.handle(null, null, { x, y });

describe('createHandlers', () => {
  it('orders handlers as Lynx iterates them: pan, fling, tap, long press', () => {
    const handlers = createHandlers(
      [
        detector(GestureType.LONGPRESS),
        detector(GestureType.TAP),
        detector(GestureType.NATIVE),
        detector(GestureType.FLING),
        detector(GestureType.PAN),
      ],
      () => {},
    );
    expect(handlers.map((handler) => handler.detector.type)).toEqual([
      GestureType.PAN,
      GestureType.FLING,
      GestureType.TAP,
      GestureType.LONGPRESS,
      GestureType.NATIVE,
    ]);
  });

  it('makes no handler for pinch and rotation, which Lynx has none for', () => {
    const handlers = createHandlers(
      [detector(GestureType.PINCH), detector(GestureType.ROTATION)],
      () => {},
    );
    expect(handlers).toEqual([]);
  });
});

describe('every handler', () => {
  it('reports the touch to onTouchesDown and the like, when registered', () => {
    const { handler, names, params } = setup(GestureType.TAP, [
      'onTouchesDown',
      'onTouchesMove',
      'onTouchesUp',
      'onTouchesCancel',
    ]);
    for (const type of [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
    ] as const) {
      handler.touches(type, at(type, 3));
    }
    expect(names()).toEqual([
      'onTouchesDown',
      'onTouchesMove',
      'onTouchesUp',
      'onTouchesCancel',
    ]);
    expect(params('onTouchesUp')).toEqual({
      timestamp: 7,
      type: 'touchend',
      x: 4,
      y: 1,
      pageX: 3,
      pageY: 0,
      clientX: 6,
      clientY: 0,
    });
  });

  it("doesn't call callbacks that aren't registered", () => {
    const { handler, names } = setup(GestureType.TAP, []);
    handler.touches('touchstart', at('touchstart', 0));
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchend', 0);
    expect(names()).toEqual([]);
  });

  it('has nothing to dispose of without timers', () => {
    const { handler } = setup(GestureType.PAN);
    expect(() => handler.dispose()).not.toThrow();
  });

  it('keeps an ended gesture ended when it then fails', () => {
    const { handler } = setup(GestureType.TAP);
    handler.end();
    handler.fail();
    expect(handler.status).toBe(HandlerState.End);
  });
});

describe('pan', () => {
  it('begins at touch down, activates past minDistance, and ends when the touch lifts', () => {
    const { handler, names, params } = setup(GestureType.PAN, undefined, {
      minDistance: 10,
    });
    touch(handler, 'touchstart', 0);
    expect(names()).toEqual(['onBegin']);
    expect(handler.status).toBe(HandlerState.Begin);

    touch(handler, 'touchmove', 10);
    expect(names()).toEqual(['onBegin']);

    touch(handler, 'touchmove', 11);
    touch(handler, 'touchmove', 20);
    expect(names()).toEqual(['onBegin', 'onStart', 'onUpdate', 'onUpdate']);
    expect(params('onUpdate')).toMatchObject({
      pageX: 20,
      scrollX: 0,
      scrollY: 0,
      isAtStart: false,
      isAtEnd: false,
    });

    touch(handler, 'touchend', 20);
    expect(names().at(-1)).toBe('onEnd');
    expect(params('onEnd')).toMatchObject({ type: 'touchend', pageX: 20 });
    expect(handler.status).toBe(HandlerState.Cancel);
  });

  it('activates on any movement without a config (minDistance 0)', () => {
    const { handler, names } = setup(GestureType.PAN);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 1);
    expect(names()).toEqual(['onBegin', 'onStart', 'onUpdate']);
  });

  it('measures vertical movement too', () => {
    const { handler, names } = setup(GestureType.PAN, undefined, {
      minDistance: 5,
    });
    handler.handle('touchstart', at('touchstart', 0, 0), { x: 0, y: 0 });
    handler.handle('touchmove', at('touchmove', 0, 6), { x: 0, y: 0 });
    expect(names()).toContain('onStart');
  });

  it('begins on a move when it was reset mid-touch', () => {
    const { handler, names } = setup(GestureType.PAN, undefined, {
      minDistance: 10,
    });
    touch(handler, 'touchstart', 0);
    handler.reset();
    touch(handler, 'touchmove', 20);
    expect(names()).toEqual(['onBegin', 'onBegin', 'onStart', 'onUpdate']);
  });

  it('fires onBegin, onStart and onEnd once a touch', () => {
    const { handler, names } = setup(GestureType.PAN);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 5);
    touch(handler, 'touchmove', 9);
    handler.fail();
    handler.end();
    expect(names()).toEqual([
      'onBegin',
      'onStart',
      'onUpdate',
      'onUpdate',
      'onEnd',
    ]);
  });

  it('begins once when a touch starts twice', () => {
    const { handler, names } = setup(GestureType.PAN);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchstart', 0);
    expect(names()).toEqual(['onBegin']);
  });

  it('ends from code with onEnd', () => {
    const { handler, names } = setup(GestureType.PAN);
    touch(handler, 'touchstart', 0);
    handler.end();
    expect(handler.status).toBe(HandlerState.End);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('sends no onEnd for a touch it never began', () => {
    const { handler, names } = setup(GestureType.PAN);
    handler.fail();
    expect(names()).toEqual([]);
  });

  it("sits a fling's frames out, then ignores the touch until it's reset", () => {
    const { handler, names, params } = setup(GestureType.PAN);
    touch(handler, 'touchstart', 0);
    frame(handler, 3);
    expect(handler.status).toBe(HandlerState.Undetermined);
    touch(handler, 'touchmove', 9);
    expect(names()).toEqual(['onBegin']);

    // A frame was the last thing it saw, so its onEnd has no position.
    handler.reset();
    touch(handler, 'touchstart', 0);
    frame(handler, 3);
    handler.status = HandlerState.Begin;
    handler.fail();
    expect(params('onEnd')).toEqual({
      scrollX: 0,
      scrollY: 0,
      isAtStart: false,
      isAtEnd: false,
    });
  });

  it('a native gesture is a pan', () => {
    const { handler, names } = setup(GestureType.NATIVE);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 3);
    expect(names()).toEqual(['onBegin', 'onStart', 'onUpdate']);
  });
});

describe('tap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('begins at touch down, and activates with onStart and onEnd when it lifts', () => {
    const { handler, names, params } = setup(GestureType.TAP);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 10);
    touch(handler, 'touchend', 10);
    expect(names()).toEqual(['onBegin', 'onStart', 'onEnd']);
    expect(params('onEnd')).toMatchObject({ type: 'touchend', pageX: 10 });
    expect(handler.status).toBe(HandlerState.Active);
    // Its timer was stopped.
    vi.advanceTimersByTime(1000);
    expect(names()).toHaveLength(3);
  });

  it('fails, with onEnd, once the touch moves past maxDistance', () => {
    const { handler, names, params } = setup(GestureType.TAP);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 11);
    expect(names()).toEqual(['onBegin', 'onEnd']);
    expect(params('onEnd')).toMatchObject({ type: 'touchmove', pageX: 11 });
    expect(handler.status).toBe(HandlerState.Cancel);

    touch(handler, 'touchend', 0);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('fails, with onEnd, once the touch outlasts maxDuration', () => {
    const { handler, names } = setup(GestureType.TAP);
    touch(handler, 'touchstart', 0);
    vi.advanceTimersByTime(499);
    expect(names()).toEqual(['onBegin']);
    vi.advanceTimersByTime(1);
    expect(names()).toEqual(['onBegin', 'onEnd']);
    touch(handler, 'touchend', 0);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('fails when the browser cancels the touch', () => {
    const { handler, names } = setup(GestureType.TAP);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchcancel', 0);
    expect(names()).toEqual(['onBegin', 'onEnd']);
    expect(handler.status).toBe(HandlerState.Cancel);
  });

  it('reads 0 for an option a config leaves out, as iOS does', () => {
    const { handler, names } = setup(GestureType.TAP, undefined, {});
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 1);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('reads its options from the config', () => {
    const { handler, names } = setup(GestureType.TAP, undefined, {
      maxDuration: 100,
      maxDistance: 30,
    });
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 30);
    vi.advanceTimersByTime(100);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it("sits a fling's frames out", () => {
    const { handler } = setup(GestureType.TAP);
    frame(handler, 1);
    expect(handler.status).toBe(HandlerState.Undetermined);
  });

  it('ends from code with onEnd', () => {
    const { handler, names } = setup(GestureType.TAP);
    touch(handler, 'touchstart', 0);
    handler.end();
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('starts its timer over on each touch', () => {
    const { handler, names } = setup(GestureType.TAP);
    touch(handler, 'touchstart', 0);
    vi.advanceTimersByTime(300);
    handler.reset();
    touch(handler, 'touchstart', 0);
    vi.advanceTimersByTime(300);
    expect(names()).toEqual(['onBegin', 'onBegin']);
    handler.dispose();
    vi.advanceTimersByTime(1000);
    expect(names()).toEqual(['onBegin', 'onBegin']);
  });
});

describe('long press', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('activates with onStart after minDuration, and ends with onEnd when it lifts', () => {
    const { handler, names, params } = setup(GestureType.LONGPRESS);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 4);
    vi.advanceTimersByTime(500);
    expect(names()).toEqual(['onBegin', 'onStart']);
    expect(params('onStart')).toMatchObject({ type: 'touchmove', pageX: 4 });
    expect(handler.status).toBe(HandlerState.Active);

    // Once active, it no longer fails on moving.
    touch(handler, 'touchmove', 50);
    touch(handler, 'touchend', 50);
    expect(names()).toEqual(['onBegin', 'onStart', 'onEnd']);
  });

  it('fails, with onEnd, when the touch moves past maxDistance first', () => {
    const { handler, names } = setup(GestureType.LONGPRESS, undefined, {
      minDuration: 300,
      maxDistance: 5,
    });
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 6);
    vi.advanceTimersByTime(1000);
    expect(names()).toEqual(['onBegin', 'onEnd']);
    touch(handler, 'touchmove', 0);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('fails, with onEnd, when the touch lifts first', () => {
    const { handler, names } = setup(GestureType.LONGPRESS);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchend', 0);
    vi.advanceTimersByTime(1000);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it("doesn't activate once another gesture failed it", () => {
    const { handler, names } = setup(GestureType.LONGPRESS);
    touch(handler, 'touchstart', 0);
    handler.fail();
    vi.advanceTimersByTime(1000);
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it("sits a fling's frames out", () => {
    const { handler } = setup(GestureType.LONGPRESS);
    frame(handler, 1);
    expect(handler.status).toBe(HandlerState.Undetermined);
  });

  it('ends from code with onEnd', () => {
    const { handler, names } = setup(GestureType.LONGPRESS);
    touch(handler, 'touchstart', 0);
    handler.end();
    expect(names()).toEqual(['onBegin', 'onEnd']);
  });

  it('starts its timer over on each touch', () => {
    const { handler, names } = setup(GestureType.LONGPRESS);
    touch(handler, 'touchstart', 0);
    vi.advanceTimersByTime(300);
    handler.reset();
    touch(handler, 'touchstart', 0);
    vi.advanceTimersByTime(300);
    expect(names()).toEqual(['onBegin', 'onBegin']);
  });
});

describe('fling', () => {
  it('sits the touch out, begins when it lifts, updates each frame, and ends with the fling', () => {
    const { handler, names, params } = setup(GestureType.FLING);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchmove', 30);
    expect(handler.status).toBe(HandlerState.Undetermined);
    expect(names()).toEqual([]);

    touch(handler, 'touchend', 30);
    expect(names()).toEqual(['onBegin']);
    expect(params('onBegin')).toEqual({
      scrollX: 0,
      scrollY: 0,
      isAtStart: false,
      isAtEnd: false,
      deltaX: 0,
      deltaY: 0,
    });

    frame(handler, -4, 2);
    expect(params('onUpdate')).toMatchObject({ deltaX: -4, deltaY: 2 });

    handler.handle(null, null, FLING_END);
    expect(names()).toEqual(['onBegin', 'onUpdate', 'onEnd']);
    expect(handler.status).toBe(HandlerState.Cancel);

    // Once failed, it has nothing more to say.
    frame(handler, 1);
    expect(names()).toEqual(['onBegin', 'onUpdate', 'onEnd']);
  });

  it("doesn't fling after a touch the browser canceled", () => {
    const { handler, names } = setup(GestureType.FLING);
    touch(handler, 'touchstart', 0);
    touch(handler, 'touchcancel', 0);
    handler.handle(null, null, FLING_END);
    expect(names()).toEqual([]);
  });

  it('begins and activates on a frame when no touch began it', () => {
    const { handler, names } = setup(GestureType.FLING);
    frame(handler, 1);
    expect(handler.status).toBe(HandlerState.Active);
    expect(names()).toEqual(['onBegin', 'onStart']);
    frame(handler, 1);
    handler.end();
    expect(names()).toEqual(['onBegin', 'onStart', 'onUpdate', 'onEnd']);
  });

  it('begins and starts once, though a touch between frames resets its state', () => {
    const { handler, names } = setup(GestureType.FLING);
    frame(handler, 1);
    touch(handler, 'touchstart', 0);
    frame(handler, 1);
    expect(names()).toEqual(['onBegin', 'onStart']);
  });

  it('fires onStart and onEnd only after onBegin, as Lynx does', () => {
    const { handler, names } = setup(GestureType.FLING, [
      'onStart',
      'onUpdate',
      'onEnd',
    ]);
    touch(handler, 'touchend', 0);
    frame(handler, 1);
    handler.handle(null, null, FLING_END);
    expect(names()).toEqual(['onUpdate']);
  });

  it('starts over after a reset', () => {
    const { handler, names } = setup(GestureType.FLING);
    touch(handler, 'touchend', 0);
    handler.handle(null, null, FLING_END);
    handler.reset();
    touch(handler, 'touchend', 0);
    handler.handle(null, null, FLING_END);
    expect(names()).toEqual(['onBegin', 'onEnd', 'onBegin', 'onEnd']);
  });
});

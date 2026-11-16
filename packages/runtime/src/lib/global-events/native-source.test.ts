import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LynxPointerEvent,
  pointerEventFor,
} from '../lynx-element/pointer-events';
import type * as PointerEvents from '../lynx-element/pointer-events';
import { GlobalEvents } from './global-events';
import { NativeScreenSource } from './native-source';

/**
 * A page element that records the listeners added to it, by name, as a
 * LynxElement's addEventListener takes them (`global-bindtouchstart`, …).
 */
const fakePage = () => {
  const listeners = new Map<string, (event: any) => unknown>();
  const add = (name: string, listener: (event: any) => unknown) => {
    listeners.set(name, listener);
    return () => {
      listeners.delete(name);
    };
  };
  return {
    listeners,
    page: {
      element: {},
      addEventListener: vi.fn(add),
      addTrailingEventListener: vi.fn(add),
    },
    /** Lynx sends `name` to the page: its global listener, then its own. */
    fire(name: string, event: object, { caught = false } = {}) {
      listeners.get(`global-bind${name}`)?.(event);
      if (!caught) listeners.get(`bind${name}`)?.(event);
    },
  };
};

// The pointer events made, counted: the real ones, through a spy.
vi.mock('../lynx-element/pointer-events', async (load) => {
  const actual = await load<typeof PointerEvents>();
  return { ...actual, pointerEventFor: vi.fn(actual.pointerEventFor) };
});

const touch = (identifier: number, at = 10) => ({
  identifier,
  x: at,
  y: at + 1,
  pageX: at + 2,
  pageY: at + 3,
  clientX: at + 4,
  clientY: at + 5,
});

const setup = () => {
  const events = new GlobalEvents({}, (hub) => new NativeScreenSource(hub));
  const fake = fakePage();
  const element = { name: 'touched' };
  events.attach(fake.page, (id) => (id === 7 ? element : undefined));
  return { events, ...fake, element };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NativeScreenSource', () => {
  it("listens for the page's resize, and touches only while something listens", () => {
    const { events, listeners } = setup();
    expect([...listeners.keys()]).toEqual(['bindresize']);

    const move = vi.fn();
    events.document.addEventListener('pointermove', move);
    expect([...listeners.keys()].sort()).toEqual(
      [
        'bindresize',
        'bindtouchcancel',
        'bindtouchend',
        'bindtouchmove',
        'bindtouchstart',
        'global-bindtouchcancel',
        'global-bindtouchend',
        'global-bindtouchmove',
        'global-bindtouchstart',
      ].sort(),
    );

    events.document.removeEventListener('pointermove', move);
    expect([...listeners.keys()]).toEqual(['bindresize']);
  });

  it('begins a touchmove dispatch only for a move listener, and follows the fingers all the same', () => {
    // A click-outside `pointerdown` is the usual document listener: every
    // touchmove anywhere would make pointer events and start a dispatch for
    // nothing. The page's touchmove listeners stay, as they always were: the
    // global one finishes the last dispatch, and the trailing one keeps an
    // app's capture listener on the page in its phase.
    const { events, listeners, fire } = setup();
    const downs: LynxPointerEvent[] = [];
    events.document.addEventListener('pointerdown', (event) =>
      downs.push(event),
    );
    expect([...listeners.keys()].sort()).toEqual(
      [
        'bindresize',
        'bindtouchcancel',
        'bindtouchend',
        'bindtouchmove',
        'bindtouchstart',
        'global-bindtouchcancel',
        'global-bindtouchend',
        'global-bindtouchmove',
        'global-bindtouchstart',
      ].sort(),
    );
    // A move nobody hears makes no pointer event and waits for no timer.
    const made = vi.mocked(pointerEventFor);
    made.mockClear();
    const timers = vi.getTimerCount();
    fire('touchmove', { changedTouches: [touch(1)] });
    expect(made).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(timers);

    // Each touch ends, so each next one is the primary pointer.
    fire('touchstart', { changedTouches: [touch(1)] });
    fire('touchend', { changedTouches: [touch(1)] });
    fire('touchstart', { changedTouches: [touch(2)] });
    fire('touchcancel', { changedTouches: [touch(2)] });
    fire('touchstart', { changedTouches: [touch(3)] });
    expect(downs.map((d) => [d.pointerId, d.isPrimary])).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);

    // A move listener added with a finger down hears it move.
    const moves: LynxPointerEvent[] = [];
    const move = (event: LynxPointerEvent) => moves.push(event);
    events.document.addEventListener('pointermove', move);
    expect(listeners.has('global-bindtouchmove')).toBe(true);
    expect(listeners.has('bindtouchmove')).toBe(true);
    fire('touchmove', { changedTouches: [touch(3, 40)] });
    expect(moves.map((m) => [m.pointerId, m.isPrimary])).toEqual([[3, true]]);

    // Not without it, and the finger is still followed.
    events.document.removeEventListener('pointermove', move);
    fire('touchmove', { changedTouches: [touch(3, 50)] });
    expect(moves).toHaveLength(1);
    fire('touchstart', { changedTouches: [touch(4)] });
    expect(downs.at(-1)).toMatchObject({ pointerId: 4, isPrimary: false });

    // A touchmove listener hears moves too.
    const touchMoves = vi.fn();
    events.document.addEventListener('touchmove', touchMoves);
    fire('touchmove', { changedTouches: [touch(4, 60)] });
    expect(touchMoves).toHaveBeenCalledOnce();
  });

  it("finishes a caught press before a move nobody hears, so the press's document listeners run first", () => {
    // A toast's (catchtouchstart) stops the touchstart before the page: its
    // pointerdown waits for a timer to bubble to the document. A move that
    // comes first still finishes it before the move's own listeners run.
    const { events, fire } = setup();
    const log: string[] = [];
    events.document.addEventListener('pointerdown', () => log.push('down'));

    fire('touchstart', { changedTouches: [touch(1)] }, { caught: true });
    fire('touchmove', { changedTouches: [touch(1)] });
    log.push('element move');

    expect(log).toEqual(['down', 'element move']);
  });

  it("makes only the pointer events something listens for, and waits for nothing when it's none", () => {
    const { events, fire } = setup();
    const made = vi.mocked(pointerEventFor);
    made.mockClear();
    const starts = vi.fn();
    events.document.addEventListener('touchstart', starts);
    const timers = vi.getTimerCount();

    // Nothing listens for a touchend, or for the pointer events of either.
    fire('touchstart', { changedTouches: [touch(1)] }, { caught: true });
    fire('touchend', { changedTouches: [touch(1)] }, { caught: true });
    expect(starts).toHaveBeenCalledOnce();
    expect(made).not.toHaveBeenCalled();
    // The touchstart, caught on its way, waits for a timer to bubble; the
    // touchend has nothing to wait for.
    expect(vi.getTimerCount()).toBe(timers + 1);

    // The pointerup of a touchend, and not its pointerout.
    const ups = vi.fn();
    events.document.addEventListener('pointerup', ups);
    fire('touchstart', { changedTouches: [touch(2)] });
    fire('touchend', { changedTouches: [touch(2)] });
    expect(made.mock.calls.map(([type]) => type)).toEqual(['pointerup']);
    expect(ups).toHaveBeenCalledOnce();
  });

  it('turns a touch into the pointer events a browser fires, then the touch event', () => {
    const { events, fire, element } = setup();
    const log: unknown[] = [];
    for (const type of [
      'pointerover',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerout',
      'touchstart',
      'touchend',
    ]) {
      events.document.addEventListener(type, (event) => log.push(event));
    }

    const start = {
      type: 'touchstart',
      timestamp: 5,
      target: { uid: 7 },
      changedTouches: [touch(1)],
    };
    fire('touchstart', start);
    fire('touchmove', {
      target: { uid: 7 },
      changedTouches: [touch(1, 20)],
    });
    fire('touchend', {
      type: 'touchend',
      target: { uid: 7 },
      changedTouches: [touch(1, 30)],
    });

    expect(log.map((e: any) => e.type)).toEqual([
      'pointerover',
      'pointerdown',
      'touchstart',
      'pointermove',
      'pointerup',
      'pointerout',
      'touchend',
    ]);
    const down = log[1] as LynxPointerEvent;
    expect(down).toBeInstanceOf(LynxPointerEvent);
    expect(down).toMatchObject({
      pointerId: 1,
      isPrimary: true,
      pointerType: 'touch',
      // Relative to the element touched, as Lynx gives a touch's x and y.
      offsetX: 10,
      offsetY: 11,
      pageX: 12,
      pageY: 13,
      clientX: 14,
      clientY: 15,
      buttons: 1,
      timeStamp: 5,
      target: element,
    });
    // The touch event is Lynx's own.
    expect(log[2]).toBe(start);
    expect(log[3]).toMatchObject({ offsetX: 20, button: -1 });
    expect(log[4]).toMatchObject({ buttons: 0, isPrimary: true });
  });

  // With multi-touch off, each event gives the touch another identifier.
  it('follows the one touch whose identifier changes between its events', () => {
    const { events, fire } = setup();
    const log: string[] = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      events.document.addEventListener(type, (event) =>
        log.push(`${event.type} ${event.pointerId}`),
      );
    }

    fire('touchstart', { changedTouches: [touch(6122061936)] });
    fire('touchmove', { changedTouches: [touch(6122062000)] });
    fire('touchend', { changedTouches: [touch(6122062064)] });

    expect(log).toEqual(['pointerdown 0', 'pointermove 0', 'pointerup 0']);
  });

  it('ends a canceled touch with pointercancel', () => {
    const { events, fire } = setup();
    const types: string[] = [];
    for (const type of ['pointercancel', 'pointerout', 'touchcancel']) {
      events.window.addEventListener(type, (event) => types.push(event.type));
    }

    fire('touchstart', { changedTouches: [touch(1)] });
    fire('touchcancel', { type: 'touchcancel', changedTouches: [touch(1)] });

    expect(types).toEqual(['pointercancel', 'pointerout', 'touchcancel']);
  });

  it('makes the first finger down the primary one, until it lifts', () => {
    const { events, fire } = setup();
    const downs: LynxPointerEvent[] = [];
    events.document.addEventListener('pointerdown', (event) =>
      downs.push(event),
    );

    fire('touchstart', { changedTouches: [touch(1), touch(2)] });
    // The other finger lifting leaves the first the primary one.
    fire('touchend', { changedTouches: [touch(2)] });
    fire('touchstart', { changedTouches: [touch(4)] });
    fire('touchend', { changedTouches: [touch(1)] });
    fire('touchstart', { changedTouches: [touch(3)] });

    expect(downs.map((d) => [d.pointerId, d.isPrimary])).toEqual([
      [1, true],
      [2, false],
      [4, false],
      [3, true],
    ]);
  });

  it('ignores the fingers that went down before it listened', () => {
    const { events, fire } = setup();
    const moves = vi.fn();
    events.document.addEventListener('pointermove', moves);

    fire('touchmove', { changedTouches: [touch(9)] });
    fire('touchstart', { changedTouches: [touch(1)] });
    events.document.removeEventListener('pointermove', moves);
    events.document.addEventListener('pointermove', moves);
    // The finger was down when it stopped listening: forgotten.
    fire('touchmove', { changedTouches: [touch(1)] });

    expect(moves).not.toHaveBeenCalled();
  });

  it('takes a touch with no position or touches', () => {
    const { events, fire } = setup();
    const down = vi.fn();
    events.document.addEventListener('pointerdown', down);
    events.document.addEventListener('touchstart', vi.fn());

    fire('touchstart', { changedTouches: [{ identifier: 1 }] });
    fire('touchstart', {});

    expect(down).toHaveBeenCalledWith(
      expect.objectContaining({ offsetX: 0, offsetY: 0, clientX: 0 }),
    );
  });

  it('runs the document after the elements, and on the next timer if one caught it', () => {
    const { events, fire } = setup();
    const log: string[] = [];
    events.document.addEventListener(
      'pointerdown',
      () => log.push('capture'),
      true,
    );
    events.document.addEventListener('pointerdown', () => log.push('bubble'));

    fire('touchstart', { changedTouches: [touch(1)] }, { caught: true });
    expect(log).toEqual(['capture']);
    vi.runAllTimers();
    expect(log).toEqual(['capture', 'bubble']);
  });

  it('finishes a caught event before the next begins', () => {
    const { events, fire } = setup();
    const log: string[] = [];
    events.document.addEventListener('pointerdown', () => log.push('down'));
    events.document.addEventListener('pointermove', () => log.push('move'));

    fire('touchstart', { changedTouches: [touch(1)] }, { caught: true });
    fire('touchmove', { changedTouches: [touch(1)] });

    expect(log).toEqual(['down', 'move']);
  });

  it('sends a tap to the click listeners', () => {
    const { events, fire, listeners } = setup();
    const click = vi.fn();
    events.document.addEventListener('click', click);
    expect(listeners.has('global-bindtap')).toBe(true);

    const tap = { type: 'tap', target: { uid: 7 }, detail: { x: 1, y: 2 } };
    fire('tap', tap);

    expect(click).toHaveBeenCalledWith(tap);
    events.document.removeEventListener('click', click);
    expect(listeners.has('global-bindtap')).toBe(false);
  });

  it("follows the LynxView's size", () => {
    const { events, listeners } = setup();
    const resize = vi.fn(() => events.viewport);
    events.window.addEventListener('resize', resize);

    listeners.get('bindresize')!({ detail: ['onWindowResize', [390, 844]] });
    // A detail without the size changes nothing.
    listeners.get('bindresize')!({ detail: ['onWindowResize'] });
    listeners.get('bindresize')!({ detail: ['onWindowResize', [390]] });
    listeners.get('bindresize')!({});

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveReturnedWith({ width: 390, height: 844 });
  });

  it('moves to the next page, and stops when there is none', () => {
    const { events, listeners } = setup();
    events.document.addEventListener('click', vi.fn());
    const next = fakePage();

    events.attach(next.page, () => undefined);
    expect(listeners.size).toBe(0);
    expect(next.listeners.has('global-bindtap')).toBe(true);

    const source = new NativeScreenSource(events);
    source.sync(next.page, new Set());
    source.sync(null, new Set());
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  LynxPointerEvent,
  POINTER_EVENT_NAMES,
  PointerEventSource,
  pointerIdOf,
} from './pointer-events';

const setup = (origin: { left: number; top: number } | null = null) => {
  const listeners = new Map<string, (event: unknown) => void>();
  const unlisten = vi.fn();
  const eventTarget = { element: true };
  const source = new PointerEventSource({
    uid: 7,
    layoutOrigin: () => origin,
    listen: (name, listener) => {
      listeners.set(name, listener as (event: unknown) => void);
      return unlisten;
    },
    eventTarget,
  });
  const events: LynxPointerEvent[] = [];
  const record = (event: LynxPointerEvent) => {
    events.push(event);
  };
  const touch = (
    type: string,
    touches: object[],
    target: number | undefined = 7,
  ) =>
    listeners.get(`bind${type}`)!({
      type,
      timestamp: 123,
      target: target === undefined ? undefined : { uid: target },
      changedTouches: touches,
    });
  return { source, listeners, unlisten, events, record, touch, eventTarget };
};

const finger = (identifier: number, x: number, y: number) => ({
  identifier,
  x,
  y,
  pageX: x + 100,
  pageY: y + 200,
  clientX: x + 100,
  clientY: y + 250,
});

describe('pointerIdOf', () => {
  it('is the number Lynx gives a finger with multi-touch on', () => {
    expect(pointerIdOf({ identifier: 0 })).toBe(0);
    expect(pointerIdOf({ identifier: 3 })).toBe(3);
  });

  // With multi-touch off, an identifier is an address that changes from one
  // event to the next.
  it('is the one touch’s number for an identifier that is an address', () => {
    expect(pointerIdOf({ identifier: 6122062000 })).toBe(0);
    expect(pointerIdOf({ identifier: 6122062064 })).toBe(0);
    expect(pointerIdOf({ identifier: -1 })).toBe(0);
  });
});

describe('PointerEventSource', () => {
  // The iOS 27 Simulator gave a drag's touchmove events one identifier and its
  // touchend another.
  it('follows the one touch whose identifier changes between its events', () => {
    const { source, events, record, touch } = setup();
    for (const name of ['pointerdown', 'pointermove', 'pointerup']) {
      source.add(name, record);
    }
    touch('touchstart', [finger(6122061936, 10, 20)]);
    touch('touchmove', [finger(6122062000, 12, 22)]);
    touch('touchend', [finger(6122062064, 14, 24)]);

    expect(events.map((e) => [e.type, e.pointerId, e.isPrimary])).toEqual([
      ['pointerdown', 0, true],
      ['pointermove', 0, true],
      ['pointerup', 0, true],
    ]);
  });

  it('names the pointer events', () => {
    expect(POINTER_EVENT_NAMES.has('pointerdown')).toBe(true);
    expect(POINTER_EVENT_NAMES.has('click')).toBe(false);
  });

  it('fires a browser’s pointer events for a touch, in its order', () => {
    const { source, events, record, touch, eventTarget } = setup();
    for (const name of POINTER_EVENT_NAMES) source.add(name, record);
    touch('touchstart', [finger(1, 10, 20)]);
    touch('touchmove', [finger(1, 12, 22)]);
    touch('touchend', [finger(1, 14, 24)]);
    expect(events.map((e) => e.type)).toEqual([
      'pointerover',
      'pointerenter',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerout',
      'pointerleave',
    ]);
    const [, , down, move, up] = events;
    expect(down).toMatchObject({
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      offsetX: 10,
      offsetY: 20,
      clientX: 110,
      clientY: 270,
      pageX: 110,
      pageY: 220,
      x: 110,
      y: 270,
      screenX: 110,
      screenY: 270,
      button: 0,
      buttons: 1,
      pressure: 0.5,
      timeStamp: 123,
      target: eventTarget,
      currentTarget: eventTarget,
      srcElement: eventTarget,
      bubbles: true,
      cancelable: true,
    });
    expect(move).toMatchObject({ button: -1, buttons: 1, offsetX: 12 });
    expect(up).toMatchObject({ button: 0, buttons: 0, pressure: 0 });
    expect(events[1]).toMatchObject({ bubbles: false, cancelable: false });
    expect(source.lastOffset).toEqual({ offsetX: 14, offsetY: 24 });
  });

  it('places a touch on a child from the element’s layout', () => {
    const { source, events, record, touch } = setup({ left: 50, top: 60 });
    source.add('pointerdown', record);
    touch('touchstart', [finger(1, 1, 1)], 9);
    expect(events[0]).toMatchObject({ offsetX: 51, offsetY: 141 });
  });

  it('places it at the page position without a layout, or from the client position', () => {
    const { source, events, record, touch } = setup();
    source.add('pointerdown', record);
    touch('touchstart', [{ identifier: 1, clientX: 5, clientY: 6 }], undefined);
    touch('touchstart', [{ identifier: 2 }], 7);
    expect(events[0]).toMatchObject({ offsetX: 5, offsetY: 6 });
    expect(events[1]).toMatchObject({ offsetX: 0, offsetY: 0, clientX: 0 });
  });

  it('tracks each finger, the first one primary', () => {
    const { source, events, record, touch } = setup();
    source.add('pointerdown', record);
    source.add('pointermove', record);
    source.add('pointercancel', record);
    touch('touchstart', [finger(1, 0, 0)]);
    touch('touchstart', [finger(2, 5, 5)]);
    touch('touchmove', [finger(3, 1, 1), finger(2, 6, 6)]);
    touch('touchcancel', [finger(2, 7, 7)]);
    touch('touchcancel', [finger(4, 7, 7)]);
    expect(events.map((e) => [e.type, e.pointerId, e.isPrimary])).toEqual([
      ['pointerdown', 1, true],
      ['pointerdown', 2, false],
      ['pointermove', 2, false],
      ['pointercancel', 2, false],
    ]);
    // A canceled touch ends where it last was.
    expect(events[3]).toMatchObject({ offsetX: 6, offsetY: 6 });
    touch('touchend', [finger(1, 0, 0)]);
    touch('touchstart', [finger(5, 0, 0)]);
    expect(events.at(-1)).toMatchObject({ pointerId: 5, isPrimary: true });
  });

  it('captures pointers, releasing them when they lift', () => {
    const { source, events, record, touch } = setup();
    source.add('gotpointercapture', record);
    source.add('lostpointercapture', record);
    source.setPointerCapture(1);
    expect(source.hasPointerCapture(1)).toBe(false);
    touch('touchstart', [finger(1, 3, 4)]);
    source.setPointerCapture(1);
    source.setPointerCapture(1);
    expect(source.hasPointerCapture(1)).toBe(true);
    source.releasePointerCapture(1);
    source.releasePointerCapture(1);
    expect(source.hasPointerCapture(1)).toBe(false);
    source.setPointerCapture(1);
    touch('touchend', [finger(1, 3, 4)]);
    expect(events.map((e) => e.type)).toEqual([
      'gotpointercapture',
      'lostpointercapture',
      'gotpointercapture',
      'lostpointercapture',
    ]);
    expect(events[0]).toMatchObject({ offsetX: 3, offsetY: 4, clientX: 0 });
  });

  it('places a capture event at the last pointer when the pointer is gone', () => {
    const { source, events, record, touch } = setup();
    source.add('lostpointercapture', record);
    source.add('gotpointercapture', record);
    touch('touchstart', [finger(1, 3, 4)]);
    source.setPointerCapture(1);
    touch('touchend', [finger(1, 8, 9)]);
    expect(events.at(-1)).toMatchObject({ offsetX: 8, offsetY: 9 });
    const fresh = setup();
    fresh.source.add('gotpointercapture', fresh.record);
    fresh.touch('touchstart', [finger(2, 1, 1)]);
    fresh.source.setPointerCapture(2);
    expect(fresh.events[0]).toMatchObject({ offsetX: 1 });
  });

  it('stops listening for touches when the last listener goes', () => {
    const { source, listeners, unlisten, record } = setup();
    const remove = source.add('pointerdown', record);
    source.add('pointerdown', record);
    expect(listeners.size).toBe(4);
    remove();
    expect(unlisten).not.toHaveBeenCalled();
    const up = vi.fn();
    source.add('pointerup', up);
    // A listener that was never added.
    source.remove('pointerup', vi.fn());
    source.remove('pointerup', up);
    expect(unlisten).not.toHaveBeenCalled();
    source.remove('pointerup', up);
    source.remove('pointerdown', record);
    source.remove('pointerdown', record);
    source.remove('pointerup', record);
    expect(unlisten).toHaveBeenCalledTimes(4);
  });

  it('skips the other listeners after stopImmediatePropagation()', () => {
    const { source, touch } = setup();
    const second = vi.fn();
    source.add('pointerdown', (event) => {
      event.preventDefault();
      expect(event.defaultPrevented).toBe(true);
      event.stopPropagation();
      event.stopImmediatePropagation();
    });
    source.add('pointerdown', second);
    touch('touchstart', [finger(1, 0, 0)]);
    expect(second).not.toHaveBeenCalled();
  });

  it('ignores touch events without changed touches', () => {
    const { source, listeners, events, record } = setup();
    source.add('pointerdown', record);
    for (const name of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      listeners.get(`bind${name}`)!({});
    }
    expect(events).toEqual([]);
  });
});

describe('LynxPointerEvent', () => {
  it('can’t prevent an event that isn’t cancelable', () => {
    const event = new LynxPointerEvent(
      'pointerleave',
      1,
      true,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      {},
    );
    event.preventDefault();
    expect(event.defaultPrevented).toBe(false);
    expect(event.getCoalescedEvents()).toEqual([event]);
    expect(event.getPredictedEvents()).toEqual([]);
    for (const type of [
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
      'pointerenter',
    ]) {
      expect(
        new LynxPointerEvent(type, 1, true, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, {})
          .cancelable,
      ).toBe(false);
    }
  });
});

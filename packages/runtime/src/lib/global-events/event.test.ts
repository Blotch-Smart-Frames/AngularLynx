import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEvent,
  installEventClasses,
  LynxCustomEvent,
  LynxEvent,
} from './event';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LynxEvent', () => {
  it("has a DOM event's fields", () => {
    const event = new LynxEvent('resize');
    expect(event).toMatchObject({
      type: 'resize',
      bubbles: false,
      cancelable: false,
      composed: false,
      isTrusted: false,
      target: null,
      currentTarget: null,
      eventPhase: LynxEvent.NONE,
      defaultPrevented: false,
    });
    expect(event.timeStamp).toBeTypeOf('number');
    expect(event.srcElement).toBeNull();
    expect(event.composedPath()).toEqual([]);
    expect([
      LynxEvent.CAPTURING_PHASE,
      LynxEvent.AT_TARGET,
      LynxEvent.BUBBLING_PHASE,
    ]).toEqual([1, 2, 3]);
  });

  it('takes its init', () => {
    const event = new LynxEvent('ping', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    expect(event).toMatchObject({
      bubbles: true,
      cancelable: true,
      composed: true,
    });
  });

  it('is canceled only when cancelable', () => {
    const fixed = new LynxEvent('ping');
    fixed.preventDefault();
    expect(fixed.defaultPrevented).toBe(false);

    const cancelable = new LynxEvent('ping', { cancelable: true });
    cancelable.preventDefault();
    expect(cancelable.defaultPrevented).toBe(true);
  });

  it('records a stop', () => {
    const event = new LynxEvent('ping');
    event.stopPropagation();
    expect(event.cancelBubble).toBe(true);

    const other = new LynxEvent('ping');
    other.stopImmediatePropagation();
    expect(other.cancelBubble).toBe(true);
  });

  it('has the object it is at in its path, while it is dispatched', () => {
    const event = new LynxEvent('ping');
    const target = {};
    event.currentTarget = target;
    expect(event.composedPath()).toEqual([target]);
  });
});

describe('LynxCustomEvent', () => {
  it('carries its detail', () => {
    expect(new LynxCustomEvent('ping', { detail: 3 }).detail).toBe(3);
    expect(new LynxCustomEvent('ping').detail).toBeNull();
  });
});

describe('installEventClasses', () => {
  it('installs the classes where they are missing', () => {
    const target: Record<string, unknown> = {};
    installEventClasses(target);
    expect(target['Event']).toBe(LynxEvent);
    expect(target['CustomEvent']).toBe(LynxCustomEvent);
  });

  it("keeps the platform's own", () => {
    const target: Record<string, unknown> = {
      Event: class {},
      CustomEvent: class {},
    };
    const { Event, CustomEvent } = target;
    installEventClasses(target);
    expect(target['Event']).toBe(Event);
    expect(target['CustomEvent']).toBe(CustomEvent);
  });
});

describe('createEvent', () => {
  it("makes an event of the realm's own class", () => {
    expect(createEvent('resize')).toBeInstanceOf(Event);
  });

  it('makes a LynxEvent where there is no Event', () => {
    vi.stubGlobal('Event', undefined);
    expect(createEvent('resize')).toBeInstanceOf(LynxEvent);
  });
});

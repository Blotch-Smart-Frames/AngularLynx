import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxEvent } from './event';
import {
  AT_TARGET,
  BUBBLING_PHASE,
  CAPTURING_PHASE,
  dispatchThrough,
  GlobalEventTarget,
  PathDispatch,
  setEventProperty,
} from './event-target';

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalEventTarget', () => {
  it('runs a listener for its type, with the target as this and currentTarget', () => {
    const target = new GlobalEventTarget();
    const seen: unknown[] = [];
    target.addEventListener('ping', function (this: unknown, event) {
      seen.push(this, event.currentTarget, event.eventPhase);
    });
    target.addEventListener('other', () => seen.push('other'));

    const event = new LynxEvent('ping');
    expect(target.dispatchEvent(event)).toBe(true);

    expect(seen).toEqual([target, target, AT_TARGET]);
    expect(event.target).toBe(target);
    // As a DOM event ends: no currentTarget, phase NONE.
    expect(event.currentTarget).toBeNull();
    expect(event.eventPhase).toBe(0);
  });

  it('shows its owner as currentTarget', () => {
    const owner = {};
    const target = new GlobalEventTarget(owner);
    const listener = vi.fn((event) => event.currentTarget);
    target.addEventListener('ping', listener);

    target.dispatchEvent(new LynxEvent('ping'));

    expect(target.owner).toBe(owner);
    expect(listener).toHaveReturnedWith(owner);
  });

  it('adds a listener once per phase, and removes it per phase', () => {
    const target = new GlobalEventTarget();
    const listener = vi.fn();
    target.addEventListener('ping', listener);
    target.addEventListener('ping', listener, false);
    target.addEventListener('ping', listener, { capture: true });

    target.dispatchEvent(new LynxEvent('ping'));
    expect(listener).toHaveBeenCalledTimes(2);

    target.removeEventListener('ping', listener, true);
    target.dispatchEvent(new LynxEvent('ping'));
    expect(listener).toHaveBeenCalledTimes(3);

    target.removeEventListener('ping', listener);
    expect(target.hasListeners('ping')).toBe(false);
    // Removing what isn't there does nothing.
    target.removeEventListener('ping', listener);
    target.removeEventListener('pong', listener);
  });

  it('ignores a null listener', () => {
    const target = new GlobalEventTarget();
    target.addEventListener('ping', null);
    expect(target.types).toEqual([]);
  });

  it("calls an object's handleEvent", () => {
    const target = new GlobalEventTarget();
    const handler = { handleEvent: vi.fn() };
    target.addEventListener('ping', handler);

    const event = new LynxEvent('ping');
    target.dispatchEvent(event);

    expect(handler.handleEvent).toHaveBeenCalledWith(event);
  });

  it('removes a once listener before it runs', () => {
    const target = new GlobalEventTarget();
    const listener = vi.fn(() => target.hasListeners('ping'));
    target.addEventListener('ping', listener, { once: true });

    target.dispatchEvent(new LynxEvent('ping'));
    target.dispatchEvent(new LynxEvent('ping'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveReturnedWith(false);
  });

  it('removes a listener when its signal aborts', () => {
    const target = new GlobalEventTarget();
    const controller = new AbortController();
    const listener = vi.fn();
    target.addEventListener('ping', listener, { signal: controller.signal });

    controller.abort();
    target.dispatchEvent(new LynxEvent('ping'));

    expect(listener).not.toHaveBeenCalled();
    expect(target.hasListeners('ping')).toBe(false);
  });

  it('stops listening to the signal of a listener removed otherwise', () => {
    const target = new GlobalEventTarget();
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const listener = vi.fn();
    target.addEventListener('ping', listener, { signal });

    target.removeEventListener('ping', listener);

    const [, abort] = signal.addEventListener.mock.calls[0];
    expect(signal.removeEventListener).toHaveBeenCalledWith('abort', abort);
    // An abort after the removal does nothing.
    abort();
  });

  it('takes a signal without removeEventListener', () => {
    const target = new GlobalEventTarget();
    const signal = { aborted: false, addEventListener: vi.fn() };
    const listener = vi.fn();
    target.addEventListener('ping', listener, { signal });

    expect(() => target.removeEventListener('ping', listener)).not.toThrow();
  });

  it('adds no listener with an aborted signal', () => {
    const target = new GlobalEventTarget();
    target.addEventListener('ping', vi.fn(), { signal: AbortSignal.abort() });
    expect(target.hasListeners('ping')).toBe(false);
  });

  it("doesn't run a listener an earlier one removed", () => {
    const target = new GlobalEventTarget();
    const second = vi.fn();
    target.addEventListener('ping', () =>
      target.removeEventListener('ping', second),
    );
    target.addEventListener('ping', second);

    target.dispatchEvent(new LynxEvent('ping'));

    expect(second).not.toHaveBeenCalled();
  });

  it('runs the next listener after one throws, and reports the error', async () => {
    vi.useFakeTimers();
    const target = new GlobalEventTarget();
    const error = new Error('boom');
    const next = vi.fn();
    target.addEventListener('ping', () => {
      throw error;
    });
    target.addEventListener('ping', next);
    const reported = vi.fn();
    const queue = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((task) => {
        try {
          task();
        } catch (thrown) {
          reported(thrown);
        }
      });

    target.dispatchEvent(new LynxEvent('ping'));

    expect(next).toHaveBeenCalled();
    expect(reported).toHaveBeenCalledWith(error);
    queue.mockRestore();
  });

  it('tells its owner when a type gets its first listener and loses its last', () => {
    const target = new GlobalEventTarget();
    const changed = vi.fn();
    target.onTypesChange = changed;
    const a = vi.fn();
    const b = vi.fn();

    target.addEventListener('ping', a);
    target.addEventListener('ping', b);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(target.types).toEqual(['ping']);

    target.removeEventListener('ping', a);
    expect(changed).toHaveBeenCalledTimes(1);
    target.removeEventListener('ping', b);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(target.types).toEqual([]);
  });

  it('stops the listeners after one that stops immediate propagation', () => {
    const target = new GlobalEventTarget();
    const next = vi.fn();
    target.addEventListener('ping', (event) =>
      event.stopImmediatePropagation(),
    );
    target.addEventListener('ping', next);

    const event = new LynxEvent('ping');
    target.dispatchEvent(event);

    expect(next).not.toHaveBeenCalled();
    // The event's own method ran too.
    expect(event.cancelBubble).toBe(true);
  });

  it('returns false for an event a listener canceled', () => {
    const target = new GlobalEventTarget();
    target.addEventListener('ping', (event) => event.preventDefault());

    expect(
      target.dispatchEvent(new LynxEvent('ping', { cancelable: true })),
    ).toBe(false);
  });

  it('runs nothing for a type with no listeners', () => {
    const target = new GlobalEventTarget();
    expect(target.dispatchEvent(new LynxEvent('ping'))).toBe(true);
  });
});

describe('dispatchThrough', () => {
  /**
   * A document and a window, recording which listener ran in which phase.
   */
  const pathWithLog = () => {
    const log: string[] = [];
    const document = new GlobalEventTarget();
    const window = new GlobalEventTarget();
    for (const [name, target] of [
      ['document', document],
      ['window', window],
    ] as const) {
      target.addEventListener(
        'ping',
        (event) => log.push(`${name} capture ${event.eventPhase}`),
        true,
      );
      target.addEventListener('ping', (event) =>
        log.push(`${name} bubble ${event.eventPhase}`),
      );
    }
    return { log, document, window };
  };

  it('captures from the outside in and bubbles from the inside out', () => {
    const { log, document, window } = pathWithLog();
    const element = {};

    dispatchThrough(new LynxEvent('ping', { bubbles: true }), element, [
      document,
      window,
    ]);

    expect(log).toEqual([
      `window capture ${CAPTURING_PHASE}`,
      `document capture ${CAPTURING_PHASE}`,
      `document bubble ${BUBBLING_PHASE}`,
      `window bubble ${BUBBLING_PHASE}`,
    ]);
  });

  it('runs both kinds at the target, capturing first, and bubbles if it bubbles', () => {
    const { log, document, window } = pathWithLog();

    dispatchThrough(new LynxEvent('ping'), document, [document, window]);
    expect(log).toEqual([
      `window capture ${CAPTURING_PHASE}`,
      `document capture ${AT_TARGET}`,
      `document bubble ${AT_TARGET}`,
    ]);

    log.length = 0;
    dispatchThrough(new LynxEvent('ping', { bubbles: true }), document, [
      document,
      window,
    ]);
    expect(log.at(-1)).toBe(`window bubble ${BUBBLING_PHASE}`);
  });

  it('stops where a listener stops propagation', () => {
    const document = new GlobalEventTarget();
    const window = new GlobalEventTarget();
    const later = vi.fn();
    window.addEventListener('ping', (event) => event.stopPropagation(), true);
    document.addEventListener('ping', later, true);
    window.addEventListener('ping', later);

    const event = new LynxEvent('ping', { bubbles: true });
    dispatchThrough(event, {}, [document, window]);

    expect(later).not.toHaveBeenCalled();
    expect(event.cancelBubble).toBe(true);
  });

  it('keeps a target the event already has, and puts its own methods back', () => {
    const target = new GlobalEventTarget();
    const element = {};
    const stopPropagation = vi.fn();
    const event = {
      type: 'tap',
      target: element,
      stopPropagation,
      stopImmediatePropagation: vi.fn(),
    };
    target.addEventListener('tap', (e) => e.stopPropagation());

    dispatchThrough(event, target, [target]);

    expect(event.target).toBe(element);
    expect(stopPropagation).toHaveBeenCalled();
    expect(event.stopPropagation).toBe(stopPropagation);
    expect('currentTarget' in event).toBe(false);
  });
});

describe('PathDispatch', () => {
  it('runs its two halves apart, for listeners of another type', () => {
    const document = new GlobalEventTarget();
    const log: string[] = [];
    document.addEventListener('click', () => log.push('capture'), true);
    document.addEventListener('click', () => log.push('bubble'));
    const event = { type: 'tap', bubbles: true };

    const dispatch = new PathDispatch(event, {}, [document], 'click');
    dispatch.capture();
    expect(log).toEqual(['capture']);
    expect(dispatch.bubble()).toBe(true);

    expect(log).toEqual(['capture', 'bubble']);
  });

  it('skips the second half once the first stopped it', () => {
    const document = new GlobalEventTarget();
    const bubble = vi.fn();
    document.addEventListener('ping', (event) => event.stopPropagation(), true);
    document.addEventListener('ping', bubble);

    const dispatch = new PathDispatch(new LynxEvent('ping'), {}, [document]);
    dispatch.capture();
    dispatch.bubble();

    expect(bubble).not.toHaveBeenCalled();
  });

  it('runs no capture once stopped, for a path of more than one', () => {
    const document = new GlobalEventTarget();
    const window = new GlobalEventTarget();
    const documentCapture = vi.fn();
    window.addEventListener('ping', (event) => event.stopPropagation(), true);
    document.addEventListener('ping', documentCapture, true);

    new PathDispatch(new LynxEvent('ping'), {}, [document, window]).capture();

    expect(documentCapture).not.toHaveBeenCalled();
  });
});

describe('setEventProperty', () => {
  it('shadows a getter on the prototype', () => {
    class WithGetter {
      get currentTarget(): unknown {
        return 'prototype';
      }
    }
    const event = new WithGetter();
    setEventProperty(event, 'currentTarget', 'own');
    expect(event.currentTarget).toBe('own');
  });
});

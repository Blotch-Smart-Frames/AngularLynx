import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { addNativeEvent, runLynxEvent } from './event-registration';

const element = {} as ElementRef;
const handler = { type: 'worklet', value: () => {} };

beforeEach(() => {
  globalThis.__AddEvent = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('addNativeEvent', () => {
  it('adds the handler at once on iOS and Android, even during an event', () => {
    vi.stubGlobal('__WEB__', false);
    runLynxEvent(() => addNativeEvent(element, 'bindEvent', 'tap', handler));
    expect(__AddEvent).toHaveBeenCalledWith(
      element,
      'bindEvent',
      'tap',
      handler,
    );
  });

  it('adds it at once on the web when no Lynx event is running', () => {
    vi.stubGlobal('__WEB__', true);
    addNativeEvent(element, 'bindEvent', 'tap', handler);
    expect(__AddEvent).toHaveBeenCalledTimes(1);
  });

  // web-core holds its handlers while it runs one, and throws "recursive use
  // of an object" for a change meanwhile (#459).
  it('waits for the running event on the web, keeping the order', async () => {
    vi.stubGlobal('__WEB__', true);
    const removed = { type: 'worklet', value: {} };
    runLynxEvent(() => {
      addNativeEvent(element, 'bindEvent', 'tap', removed);
      // An event an event's code makes happen.
      runLynxEvent(() =>
        addNativeEvent(element, 'bindEvent', 'layoutchange', handler),
      );
      addNativeEvent(element, 'bindEvent', 'tap', handler);
    });
    expect(__AddEvent).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(vi.mocked(__AddEvent).mock.calls).toEqual([
      [element, 'bindEvent', 'tap', removed],
      [element, 'bindEvent', 'layoutchange', handler],
      [element, 'bindEvent', 'tap', handler],
    ]);
    // Over: the next one goes at once.
    addNativeEvent(element, 'global-bindEvent', 'tap', undefined);
    expect(__AddEvent).toHaveBeenCalledTimes(4);
  });

  // A microtask the event's code queued before its first change runs after
  // the event, but ahead of the waiting changes: its own change must follow
  // them, or an older removal would undo it.
  it('keeps a change made after the event behind the ones still waiting', async () => {
    vi.stubGlobal('__WEB__', true);
    const removed = { type: 'worklet', value: {} };
    runLynxEvent(() => {
      queueMicrotask(() =>
        addNativeEvent(element, 'bindEvent', 'tap', handler),
      );
      addNativeEvent(element, 'bindEvent', 'tap', removed);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(__AddEvent).mock.calls.map((call) => call[3])).toEqual([
      removed,
      handler,
    ]);
  });

  it('counts an event over when its code throws', () => {
    vi.stubGlobal('__WEB__', true);
    expect(() =>
      runLynxEvent(() => {
        throw new Error('handler failed');
      }),
    ).toThrow('handler failed');
    addNativeEvent(element, 'bindEvent', 'tap', handler);
    expect(__AddEvent).toHaveBeenCalledTimes(1);
  });

  it('returns what the event’s code returns', () => {
    expect(runLynxEvent(() => 42)).toBe(42);
  });
});

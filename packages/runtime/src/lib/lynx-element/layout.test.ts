import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type LayoutRect,
  LayoutTracker,
  measureLayout,
  restartWebLayoutChange,
  setMeasureFlush,
  toDOMRect,
} from './layout';

const host = () => {
  let fire: (event: unknown) => void = () => {};
  let answer: (rect: LayoutRect | null) => void = () => {};
  return {
    listen: vi.fn((_name: string, listener: (event: unknown) => void) => {
      fire = listener;
      return () => {};
    }),
    measure: vi.fn((callback: (rect: LayoutRect | null) => void) => {
      answer = callback;
    }),
    layout: (detail: unknown) => fire({ detail }),
    answer: (rect: LayoutRect | null) => answer(rect),
  };
};

describe('toDOMRect', () => {
  it('makes a DOMRect from a box, or an empty one', () => {
    const rect = toDOMRect({ left: 1, top: 2, width: 3, height: 4 });
    expect(rect).toMatchObject({
      x: 1,
      y: 2,
      left: 1,
      top: 2,
      right: 4,
      bottom: 6,
      width: 3,
      height: 4,
    });
    expect(rect.toJSON()).toEqual({
      x: 1,
      y: 2,
      left: 1,
      top: 2,
      right: 4,
      bottom: 6,
      width: 3,
      height: 4,
    });
    expect(toDOMRect(null)).toMatchObject({ width: 0, height: 0, right: 0 });
  });
});

describe('LayoutTracker', () => {
  it('listens for layoutchange once, and asks for the box it has now', () => {
    const h = host();
    const tracker = new LayoutTracker(h);
    tracker.start();
    tracker.start();
    expect(h.listen).toHaveBeenCalledOnce();
    expect(h.listen).toHaveBeenCalledWith(
      'bindlayoutchange',
      expect.any(Function),
    );
    expect(h.measure).toHaveBeenCalledOnce();
    h.answer({ left: 1, top: 2, width: 3, height: 4 });
    expect(tracker.rect).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it('keeps a layoutchange over the measure that answers after it', () => {
    const h = host();
    const tracker = new LayoutTracker(h);
    tracker.start();
    h.layout({ left: 5, top: 5, width: 5, height: 5, id: '' });
    h.answer({ left: 1, top: 1, width: 1, height: 1 });
    expect(tracker.rect).toEqual({ left: 5, top: 5, width: 5, height: 5 });
    h.answer(null);
    expect(tracker.rect).toEqual({ left: 5, top: 5, width: 5, height: 5 });
  });

  it('tells observers about each new box, and not about the same one', () => {
    const h = host();
    const tracker = new LayoutTracker(h);
    const observer = vi.fn();
    const stop = tracker.observe(observer);
    h.layout({ left: 0, top: 0, width: 10, height: 10 });
    h.layout({ left: 0, top: 0, width: 10, height: 10 });
    h.layout({ left: 1, top: 0, width: 10, height: 10 });
    h.layout({ left: 1, top: 1, width: 10, height: 10 });
    h.layout({ left: 1, top: 1, width: 11, height: 10 });
    h.layout({ left: 1, top: 1, width: 11, height: 11 });
    expect(observer).toHaveBeenCalledTimes(5);
    stop();
    h.layout({ left: 0, top: 0, width: 1, height: 1 });
    expect(observer).toHaveBeenCalledTimes(5);
  });

  it('ignores an event without a box', () => {
    const h = host();
    const tracker = new LayoutTracker(h);
    tracker.start();
    h.layout(undefined);
    h.layout({ width: 'wide' });
    expect(tracker.rect).toBeNull();
  });
});

describe('restartWebLayoutChange', () => {
  it("takes the element's layoutchange count to none and back", () => {
    const counted: string[] = [];
    restartWebLayoutChange({
      enableEvent: (name: string) => counted.push(`enable ${name}`),
      disableEvent: (name: string) => counted.push(`disable ${name}`),
    });
    expect(counted).toEqual(['disable layoutchange', 'enable layoutchange']);
  });

  it("leaves an element that doesn't count its handlers alone", () => {
    expect(() => restartWebLayoutChange({})).not.toThrow();
  });
});

describe('measureLayout', () => {
  afterEach(() => {
    setMeasureFlush(() => {});
    vi.unstubAllGlobals();
  });

  it('asks for nothing more until the element module sets the flush', () => {
    vi.stubGlobal('__InvokeUIMethod', vi.fn());
    expect(() => measureLayout({}, () => {})).not.toThrow();
  });

  it('asks for the flush its request waits for, once it has made it', () => {
    // With pending invokes, native sends the request to the UI only with
    // the element's next flush.
    const invoke = vi.fn();
    vi.stubGlobal('__InvokeUIMethod', invoke);
    const flush = vi.fn();
    setMeasureFlush(flush);
    const native = {};
    const callback = vi.fn();
    measureLayout(native, callback);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      native,
      'boundingClientRect',
      {},
      expect.any(Function),
    );
    expect(flush).toHaveBeenCalledOnce();
    expect(flush.mock.invocationCallOrder[0]).toBeGreaterThan(
      invoke.mock.invocationCallOrder[0]!,
    );

    // The answer, when it comes, is the box, or null without one.
    invoke.mock.calls[0]![3]({ code: 0, data: { left: 1 } });
    invoke.mock.calls[0]![3]({ code: 6 });
    expect(callback.mock.calls).toEqual([[{ left: 1 }], [null]]);
  });
});

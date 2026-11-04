import { describe, expect, it, vi } from 'vitest';
import { type LayoutRect, LayoutTracker, toDOMRect } from './layout';

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

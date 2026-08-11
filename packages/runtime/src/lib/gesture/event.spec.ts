import { describe, expect, it } from 'vitest';
import { createGestureOrigin, mapGestureEvent } from './event';

describe('mapGestureEvent', () => {
  it('maps pageX/pageY to absoluteX/absoluteY', () => {
    const result = mapGestureEvent({ params: { pageX: 100, pageY: 200 } });

    expect(result.absoluteX).toBe(100);
    expect(result.absoluteY).toBe(200);
  });

  it('spreads native params so their original names remain reachable', () => {
    // Covers element-relative x/y, scroll offset, pinch (scale), rotation
    // (rotation), and the boundary flags without per-gesture mapping.
    const result = mapGestureEvent({
      params: {
        x: 4,
        y: 5,
        scrollX: 0,
        scale: 1.5,
        rotation: 90,
        isAtEnd: true,
      },
    }) as Record<string, unknown>;

    expect(result['x']).toBe(4);
    expect(result['y']).toBe(5);
    expect(result['scale']).toBe(1.5);
    expect(result['rotation']).toBe(90);
    expect(result['isAtEnd']).toBe(true);
  });

  it('keeps the raw params dict as an escape hatch', () => {
    const params = { pageX: 1, custom: 'v' };
    const result = mapGestureEvent({ params });

    expect(result.params).toEqual(params);
  });

  it('forwards target and currentTarget from the envelope', () => {
    const target = { id: 't' };
    const currentTarget = { id: 'ct' };
    const result = mapGestureEvent({ params: {}, target, currentTarget }) as {
      target: unknown;
      currentTarget: unknown;
    };

    expect(result.target).toBe(target);
    expect(result.currentTarget).toBe(currentTarget);
  });

  it('falls back to the event itself when there is no params envelope', () => {
    const result = mapGestureEvent({ pageX: 7, pageY: 9 });

    expect(result.absoluteX).toBe(7);
    expect(result.absoluteY).toBe(9);
  });

  it('does not throw on null/undefined input', () => {
    expect(() => mapGestureEvent(null)).not.toThrow();
    expect(() => mapGestureEvent(undefined)).not.toThrow();
  });

  describe('translation (derived from a per-gesture origin)', () => {
    it('reports 0 on the first event, then the offset from that origin', () => {
      const origin = createGestureOrigin();

      const first = mapGestureEvent(
        { params: { pageX: 50, pageY: 50 } },
        'onUpdate',
        origin,
      ) as { translationX: number; translationY: number };
      expect(first.translationX).toBe(0);
      expect(first.translationY).toBe(0);

      const moved = mapGestureEvent(
        { params: { pageX: 80, pageY: 30 } },
        'onUpdate',
        origin,
      ) as { translationX: number; translationY: number };
      expect(moved.translationX).toBe(30);
      expect(moved.translationY).toBe(-20);
    });

    it('re-anchors on onBegin/onStart', () => {
      const origin = createGestureOrigin();
      mapGestureEvent({ params: { pageX: 10, pageY: 10 } }, 'onUpdate', origin);

      const begun = mapGestureEvent(
        { params: { pageX: 200, pageY: 200 } },
        'onStart',
        origin,
      ) as { translationX: number };
      expect(begun.translationX).toBe(0);
    });

    it('resets the origin on onEnd so the next gesture starts fresh', () => {
      const origin = createGestureOrigin();
      mapGestureEvent({ params: { pageX: 50, pageY: 50 } }, 'onUpdate', origin);
      mapGestureEvent({ params: { pageX: 90, pageY: 90 } }, 'onEnd', origin);

      // New gesture: first event anchors again at its own position.
      const next = mapGestureEvent(
        { params: { pageX: 300, pageY: 300 } },
        'onUpdate',
        origin,
      ) as { translationX: number };
      expect(next.translationX).toBe(0);
    });

    it('omits translation entirely when no origin is supplied', () => {
      const result = mapGestureEvent({ params: { pageX: 5, pageY: 6 } }) as {
        translationX?: number;
      };
      expect(result.translationX).toBeUndefined();
    });
  });
});

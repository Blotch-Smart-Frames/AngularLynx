import { describe, expect, it, vi } from 'vitest';
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

    it('re-anchors on onTouchesDown, for a touch that sends no onBegin', () => {
      // An outer element's gesture that didn't win the touch hears only its
      // touch callbacks.
      const origin = createGestureOrigin();
      mapGestureEvent(
        { params: { pageX: 10, pageY: 10 } },
        'onTouchesDown',
        origin,
      );
      mapGestureEvent(
        { params: { pageX: 15, pageY: 10 } },
        'onTouchesMove',
        origin,
      );

      mapGestureEvent(
        { params: { pageX: 110, pageY: 10 } },
        'onTouchesDown',
        origin,
      );
      const moved = mapGestureEvent(
        { params: { pageX: 112, pageY: 14 } },
        'onTouchesMove',
        origin,
      ) as { translationX: number; translationY: number };

      expect(moved.translationX).toBe(2);
      expect(moved.translationY).toBe(4);
    });

    it('re-anchors on onBegin, even when the previous touch sent no onEnd', () => {
      const origin = createGestureOrigin();
      mapGestureEvent({ params: { pageX: 10, pageY: 10 } }, 'onBegin', origin);
      mapGestureEvent({ params: { pageX: 60, pageY: 10 } }, 'onUpdate', origin);

      const begun = mapGestureEvent(
        { params: { pageX: 200, pageY: 200 } },
        'onBegin',
        origin,
      ) as { translationX: number };
      expect(begun.translationX).toBe(0);
    });

    it('keeps measuring from onBegin when the gesture activates (onStart)', () => {
      // A pan with minDistance activates after the finger has already moved:
      // that distance is part of the translation, as in
      // react-native-gesture-handler.
      const origin = createGestureOrigin();
      mapGestureEvent({ params: { pageX: 10, pageY: 10 } }, 'onBegin', origin);

      const started = mapGestureEvent(
        { params: { pageX: 30, pageY: 15 } },
        'onStart',
        origin,
      ) as { translationX: number; translationY: number };
      expect(started.translationX).toBe(20);
      expect(started.translationY).toBe(5);
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

    it('anchors on onBegin', () => {
      const origin = createGestureOrigin();

      const begun = mapGestureEvent(
        { params: { pageX: 12, pageY: 34 } },
        'onBegin',
        origin,
      ) as { translationX: number; translationY: number };
      expect(begun.translationX).toBe(0);
      expect(begun.translationY).toBe(0);
      expect(origin.x).toBe(12);
      expect(origin.y).toBe(34);
    });

    it('defaults absoluteX/Y to 0 when the native payload omits pageX/pageY', () => {
      // Defensive `?? 0` fallback: absoluteX/Y are typed as number|undefined so
      // an undefined value must not turn into NaN via arithmetic.
      const origin = createGestureOrigin();

      const result = mapGestureEvent({ params: {} }, 'onStart', origin) as {
        translationX?: number;
        translationY?: number;
      };
      expect(result.translationX).toBe(0);
      expect(result.translationY).toBe(0);
      expect(origin.x).toBe(0);
      expect(origin.y).toBe(0);
    });
  });

  describe('velocity (derived from positions and timestamps)', () => {
    type Moving = { velocityX: number; velocityY: number };
    const pan = (
      origin: ReturnType<typeof createGestureOrigin>,
      name: string,
      timestamp: number,
      pageX: number,
      pageY = 0,
    ) =>
      mapGestureEvent(
        { timestamp, params: { pageX, pageY } },
        name,
        origin,
      ) as unknown as Moving;

    it("measures a pan's speed over the last 100ms, in px/s", () => {
      const origin = createGestureOrigin();
      expect(pan(origin, 'onBegin', 1000, 0)).toMatchObject({
        velocityX: 0,
        velocityY: 0,
      });
      pan(origin, 'onUpdate', 1050, 25, -10);
      expect(pan(origin, 'onUpdate', 1100, 50, -20)).toMatchObject({
        velocityX: 500,
        velocityY: -200,
      });
    });

    it('reports the speed the finger let go at in onEnd', () => {
      const origin = createGestureOrigin();
      pan(origin, 'onBegin', 0, 0);
      pan(origin, 'onUpdate', 500, 0);
      pan(origin, 'onUpdate', 550, 40);
      expect(pan(origin, 'onEnd', 600, 80).velocityX).toBe(800);
    });

    it('is 0 when the finger stopped before letting go', () => {
      const origin = createGestureOrigin();
      pan(origin, 'onBegin', 0, 0);
      pan(origin, 'onUpdate', 50, 100);
      pan(origin, 'onUpdate', 300, 100);
      expect(pan(origin, 'onEnd', 400, 100).velocityX).toBe(0);
    });

    it('starts each touch over', () => {
      const origin = createGestureOrigin();
      pan(origin, 'onBegin', 0, 0);
      pan(origin, 'onUpdate', 50, 100);
      // No onEnd: onBegin alone forgets the last touch's positions.
      expect(pan(origin, 'onBegin', 80, 500).velocityX).toBe(0);
      expect(pan(origin, 'onUpdate', 130, 550).velocityX).toBe(1000);
    });

    it('forgets the touch at onEnd', () => {
      const origin = createGestureOrigin();
      pan(origin, 'onUpdate', 0, 0);
      pan(origin, 'onEnd', 50, 100);
      expect(pan(origin, 'onUpdate', 60, 0).velocityX).toBe(0);
    });

    it("prefers the touch's own timestamp in params to the envelope's", () => {
      // The web preview stamps the envelope when it calls the callback, and
      // the touch's time, which is when the finger was there, in params.
      const origin = createGestureOrigin();
      mapGestureEvent(
        { timestamp: 9_000, params: { timestamp: 0, pageX: 0, pageY: 0 } },
        'onBegin',
        origin,
      );
      const moved = mapGestureEvent(
        { timestamp: 9_001, params: { timestamp: 50, pageX: 20, pageY: 0 } },
        'onUpdate',
        origin,
      ) as unknown as Moving;
      expect(moved.velocityX).toBe(400);
    });

    it('uses the time it maps the event at when nothing is stamped', () => {
      const now = vi.spyOn(Date, 'now');
      try {
        const origin = createGestureOrigin();
        now.mockReturnValue(0);
        mapGestureEvent({ params: { pageX: 0, pageY: 0 } }, 'onBegin', origin);
        now.mockReturnValue(100);
        const moved = mapGestureEvent(
          { params: { pageX: 0, pageY: 30 } },
          'onUpdate',
          origin,
        ) as unknown as Moving;
        expect(moved.velocityY).toBe(300);
      } finally {
        now.mockRestore();
      }
    });

    it("measures a fling's momentum from its frames' steps, in the swipe's direction", () => {
      // Lynx's fling steps run against the swipe, as a scroll offset does: a
      // fling to the right and up steps left and down.
      const origin = createGestureOrigin();
      const fling = (
        name: string,
        timestamp: number,
        deltaX: number,
        deltaY: number,
      ) =>
        mapGestureEvent(
          { timestamp, params: { scrollX: 0, deltaX, deltaY } },
          name,
          origin,
        ) as unknown as Moving;

      expect(fling('onBegin', 0, 0, 0)).toMatchObject({
        velocityX: 0,
        velocityY: 0,
      });
      fling('onUpdate', 16, -16, 8);
      expect(fling('onUpdate', 32, -16, 8)).toMatchObject({
        velocityX: 1000,
        velocityY: -500,
      });
    });

    it('treats a missing axis of a step as no movement in it', () => {
      const origin = createGestureOrigin();
      mapGestureEvent(
        { timestamp: 0, params: { deltaX: 0 } },
        'onBegin',
        origin,
      );
      const moved = mapGestureEvent(
        { timestamp: 50, params: { deltaX: -50 } },
        'onUpdate',
        origin,
      ) as unknown as Moving;
      expect(moved).toMatchObject({ velocityX: 1000, velocityY: 0 });
    });

    it('stays still for an event with neither a position nor a step', () => {
      const origin = createGestureOrigin();
      const event = mapGestureEvent(
        { timestamp: 0, params: {} },
        'onUpdate',
        origin,
      ) as unknown as Moving;
      expect(event).toMatchObject({ velocityX: 0, velocityY: 0 });
    });

    it('omits velocity when no origin is supplied', () => {
      const result = mapGestureEvent({ params: { pageX: 5, pageY: 6 } }) as {
        velocityX?: number;
      };
      expect(result.velocityX).toBeUndefined();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseGesture } from './base-gesture';
import { type CallbackGate, createCallbackGate } from './callback-gate';
import { FlingGesture } from './fling-gesture';
import { LongPressGesture } from './long-press-gesture';
import { PanGesture } from './pan-gesture';
import { PinchGesture } from './pinch-gesture';
import type { GestureStateManager } from './state-manager';
import { TapGesture } from './tap-gesture';
import { FlingDirection, type GestureEvent } from './types';

const stateManager = { fail: vi.fn() };

/**
 * Routes a sequence of Lynx callbacks through a gesture's gate, and returns
 * the user callbacks they ran, as `name` or `name@<tag>` when the event has
 * one.
 */
const runner = (gesture: BaseGesture<any, any>) => {
  const gate: CallbackGate = createCallbackGate(gesture);
  const send = (name: string, event: GestureEvent & { tag?: string } = {}) =>
    gate
      .route(name, event, stateManager as unknown as GestureStateManager)
      .map(([target, routed]) => {
        const { tag } = routed as { tag?: string };
        return tag ? `${target}@${tag}` : target;
      });
  return { gate, send };
};

/**
 * A pan event that has moved (x, y) from where the touch began.
 */
const moved = (x: number, y: number, tag?: string) =>
  ({ translationX: x, translationY: y, tag }) as GestureEvent;

/**
 * A fling frame. Lynx's steps run against the swipe, so a swipe right has a
 * negative deltaX.
 */
const frame = (deltaX: number, deltaY: number, tag?: string) =>
  ({ params: { deltaX, deltaY }, tag }) as GestureEvent;

beforeEach(() => {
  stateManager.fail.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCallbackGate', () => {
  it.each([
    ['a pinch', () => new PinchGesture()],
    ['a pan with no offsets', () => new PanGesture().minDistance(10)],
    ['a fling with no direction', () => new FlingGesture()],
    [
      'a tap with no onEnd and one tap',
      () => new TapGesture().onStart(vi.fn()),
    ],
  ])('passes every callback of %s through', (_name, create) => {
    const { gate, send } = runner(create());

    expect(gate.observes).toEqual([]);
    expect(send('onStart')).toEqual(['onStart']);
    expect(send('onEnd')).toEqual(['onEnd']);
  });
});

describe('tap and long press', () => {
  it('drops the onEnd of a gesture Lynx never recognized', () => {
    const { gate, send } = runner(new LongPressGesture().onEnd(vi.fn()));

    expect(gate.observes).toEqual(['onStart', 'onEnd']);
    expect(send('onBegin')).toEqual(['onBegin']);
    expect(send('onEnd')).toEqual([]);
    expect(send('onStart')).toEqual(['onStart']);
    expect(send('onEnd')).toEqual(['onEnd']);
    expect(send('onEnd')).toEqual([]);
    expect(send('onTouchesDown')).toEqual(['onTouchesDown']);
  });

  describe('numberOfTaps', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    /**
     * A tap Lynx recognizes at (x, y): down, then lifted.
     */
    const tap = (send: ReturnType<typeof runner>['send'], x = 0, y = 0) => [
      ...send('onBegin', { absoluteX: x, absoluteY: y }),
      ...send('onStart', { absoluteX: x, absoluteY: y }),
      ...send('onEnd', { absoluteX: x, absoluteY: y }),
    ];

    it('runs onStart and onEnd on the last tap of the run only', () => {
      const { gate, send } = runner(new TapGesture().numberOfTaps(2));

      expect(gate.observes).toEqual(['onBegin', 'onStart', 'onEnd']);
      expect(tap(send)).toEqual(['onBegin']);
      vi.advanceTimersByTime(200);
      expect(tap(send)).toEqual(['onBegin', 'onStart', 'onEnd']);
      // The run starts over.
      vi.advanceTimersByTime(200);
      expect(tap(send)).toEqual(['onBegin']);
    });

    it('counts three taps for numberOfTaps(3)', () => {
      const { send } = runner(new TapGesture().numberOfTaps(3));

      expect(tap(send)).toEqual(['onBegin']);
      expect(tap(send)).toEqual(['onBegin']);
      expect(tap(send)).toEqual(['onBegin', 'onStart', 'onEnd']);
    });

    it('starts over when the finger stays up longer than 500 ms', () => {
      const { send } = runner(new TapGesture().numberOfTaps(2));

      tap(send);
      vi.advanceTimersByTime(501);

      expect(tap(send)).toEqual(['onBegin']);
      expect(tap(send)).toEqual(['onBegin', 'onStart', 'onEnd']);
    });

    it('starts over when a tap fails', () => {
      const { send } = runner(new TapGesture().numberOfTaps(2));

      tap(send);
      // Down, then a drag past maxDistance: Lynx fails it, sending onEnd.
      send('onBegin');
      send('onEnd');

      expect(tap(send)).toEqual(['onBegin']);
      expect(tap(send)).toEqual(['onBegin', 'onStart', 'onEnd']);
    });

    it('starts over when a tap lands further than maxDistance from the first', () => {
      const { send } = runner(new TapGesture().numberOfTaps(2).maxDistance(20));

      tap(send, 100, 100);

      expect(tap(send, 121, 100)).toEqual(['onBegin']);
      expect(tap(send, 121, 120)).toEqual(['onBegin', 'onStart', 'onEnd']);
    });

    it('counts taps on an event with no position at one spot', () => {
      const { send } = runner(new TapGesture().numberOfTaps(2));

      send('onBegin');
      send('onStart');
      send('onEnd');
      send('onBegin');

      expect(send('onStart')).toEqual(['onStart']);
    });

    it('treats numberOfTaps(0) as one tap', () => {
      const { send } = runner(new TapGesture().numberOfTaps(0).onEnd(vi.fn()));

      expect(tap(send)).toEqual(['onBegin', 'onStart', 'onEnd']);
    });
  });
});

describe('pan', () => {
  it('holds onStart and onUpdate back until the active offset is passed', () => {
    const { gate, send } = runner(new PanGesture().activeOffsetX([-20, 20]));

    expect(gate.observes).toContain('onUpdate');
    expect(send('onBegin', moved(0, 0))).toEqual(['onBegin']);
    expect(send('onStart', moved(1, 0))).toEqual([]);
    expect(send('onUpdate', moved(20, 15))).toEqual([]);
    expect(send('onUpdate', moved(-21, 15, 'a'))).toEqual([
      'onStart@a',
      'onUpdate@a',
    ]);
    expect(send('onUpdate', moved(0, 0))).toEqual(['onUpdate']);
    expect(send('onEnd', moved(0, 0))).toEqual(['onEnd']);
    expect(stateManager.fail).not.toHaveBeenCalled();
  });

  it('runs onStart alone when Lynx starts the pan past the offset', () => {
    const { send } = runner(new PanGesture().minDistance(30).activeOffsetY(10));

    send('onBegin', moved(0, 0));

    expect(send('onStart', moved(0, 31))).toEqual(['onStart']);
    expect(send('onUpdate', moved(0, 32))).toEqual(['onUpdate']);
  });

  it('reads a positive number as a range open to the left, as react-native-gesture-handler does', () => {
    const { send } = runner(new PanGesture().activeOffsetX(10));

    send('onBegin', moved(0, 0));

    expect(send('onUpdate', moved(-50, 0))).toEqual([]);
    expect(send('onUpdate', moved(11, 0))).toEqual(['onStart', 'onUpdate']);
  });

  it('reads a negative number as a range open to the right', () => {
    const { send } = runner(new PanGesture().activeOffsetX(-10));

    send('onBegin', moved(0, 0));

    expect(send('onUpdate', moved(50, 0))).toEqual([]);
    expect(send('onUpdate', moved(-11, 0))).toEqual(['onStart', 'onUpdate']);
  });

  it('starts on either axis when both have active offsets', () => {
    const { send } = runner(
      new PanGesture().activeOffsetX([-20, 20]).activeOffsetY([-20, 20]),
    );

    send('onBegin', moved(0, 0));

    expect(send('onUpdate', moved(5, 21))).toEqual(['onStart', 'onUpdate']);
  });

  it('fails the pan once a fail offset is passed before it starts', () => {
    const { gate, send } = runner(
      new PanGesture().activeOffsetX([-20, 20]).failOffsetY([-10, 10]),
    );

    expect(gate.observes).toEqual([
      'onStart',
      'onUpdate',
      'onTouchesDown',
      'onTouchesUp',
      'onTouchesCancel',
    ]);
    send('onTouchesDown');
    send('onBegin', moved(0, 0));
    send('onStart', moved(1, 1));

    expect(send('onUpdate', moved(5, -11))).toEqual([]);
    expect(stateManager.fail).toHaveBeenCalledOnce();
    // Lynx hears of the failure a few moves later: those moves are dropped.
    expect(send('onUpdate', moved(40, -11))).toEqual([]);
    expect(stateManager.fail).toHaveBeenCalledOnce();
    expect(send('onEnd', moved(40, -11))).toEqual(['onEnd']);
    expect(send('onTouchesUp')).toEqual(['onTouchesUp']);
    // The next touch starts afresh.
    expect(send('onTouchesDown')).toEqual(['onTouchesDown']);
    expect(send('onBegin', moved(0, 0))).toEqual(['onBegin']);
    expect(send('onUpdate', moved(21, 0))).toEqual(['onStart', 'onUpdate']);
  });

  it('fails each restart of the failed pan until the finger lifts, running onEnd once', () => {
    // On iOS, Lynx gives the touch back to a failed pan that's alone on its
    // element and begins it again, every few moves.
    const { send } = runner(
      new PanGesture().failOffsetY([-10, 10]).minDistance(5),
    );

    send('onTouchesDown');
    send('onBegin', moved(0, 0));
    send('onStart', moved(0, 11));
    expect(send('onEnd', moved(0, 11))).toEqual(['onEnd']);

    for (let i = 0; i < 3; i++) {
      expect(send('onBegin', moved(0, 0))).toEqual([]);
      expect(send('onStart', moved(0, 6))).toEqual([]);
      expect(send('onEnd', moved(0, 6))).toEqual([]);
    }

    expect(stateManager.fail).toHaveBeenCalledTimes(4);
    expect(send('onTouchesUp')).toEqual(['onTouchesUp']);
  });

  it("runs a failed pan's onEnd that Lynx sends after the finger lifts", () => {
    const { send } = runner(
      new PanGesture().failOffsetY([-10, 10]).minDistance(5),
    );

    send('onBegin', moved(0, 0));
    send('onUpdate', moved(0, 11));
    send('onTouchesCancel');

    expect(send('onEnd', moved(0, 11))).toEqual(['onEnd']);
    expect(send('onEnd', moved(0, 11))).toEqual([]);
  });

  it('starts a new touch at a pan that begins after the finger lifted', () => {
    const { send } = runner(
      new PanGesture().failOffsetY([-10, 10]).minDistance(5),
    );

    send('onBegin', moved(0, 0));
    send('onUpdate', moved(0, 11));
    send('onTouchesUp');

    expect(send('onBegin', moved(0, 0))).toEqual(['onBegin']);
    expect(send('onStart', moved(6, 0))).toEqual(['onStart']);
    expect(stateManager.fail).toHaveBeenCalledOnce();
  });

  it('fails on a move before minDistance that passes a fail offset and comes back', () => {
    // Lynx sends no onUpdate before minDistance, so onTouchesMove is watched.
    const { gate, send } = runner(
      new PanGesture().minDistance(30).activeOffsetY(20).failOffsetX(10),
    );

    expect(gate.observes).toContain('onTouchesMove');
    send('onTouchesDown');
    send('onBegin', moved(0, 0));

    expect(send('onTouchesMove', moved(5, 0))).toEqual(['onTouchesMove']);
    expect(stateManager.fail).not.toHaveBeenCalled();
    expect(send('onTouchesMove', moved(11, 0))).toEqual(['onTouchesMove']);
    expect(stateManager.fail).toHaveBeenCalledOnce();
    expect(send('onStart', moved(0, 31))).toEqual([]);
    expect(send('onUpdate', moved(0, 32))).toEqual([]);
  });

  it("doesn't watch moves when Lynx starts the pan on the first one", () => {
    const { gate } = runner(new PanGesture().failOffsetX(10));

    expect(gate.observes).not.toContain('onTouchesMove');
  });

  it('ignores moves once the pan has started', () => {
    const { send } = runner(new PanGesture().minDistance(5).failOffsetX(10));

    send('onBegin', moved(0, 0));
    send('onStart', moved(0, 6));

    expect(send('onTouchesMove', moved(50, 6))).toEqual(['onTouchesMove']);
    expect(send('onUpdate', moved(50, 6))).toEqual(['onUpdate']);
    expect(stateManager.fail).not.toHaveBeenCalled();
  });

  it('checks the fail offset first when both are passed at once', () => {
    const { send } = runner(
      new PanGesture().activeOffsetX([-20, 20]).failOffsetY([-10, 10]),
    );

    send('onBegin', moved(0, 0));

    expect(send('onUpdate', moved(30, 30))).toEqual([]);
    expect(stateManager.fail).toHaveBeenCalledOnce();
  });

  it('stops checking the fail offset once the pan has started', () => {
    const { send } = runner(
      new PanGesture().activeOffsetX([-20, 20]).failOffsetY([-10, 10]),
    );

    send('onBegin', moved(0, 0));
    send('onUpdate', moved(21, 0));

    expect(send('onUpdate', moved(21, 50))).toEqual(['onUpdate']);
    expect(stateManager.fail).not.toHaveBeenCalled();
  });

  it('starts with Lynx when only a fail offset is set', () => {
    const { send } = runner(new PanGesture().minDistance(10).failOffsetX(5));

    send('onBegin', moved(0, 0));

    expect(send('onStart', moved(0, 11))).toEqual(['onStart']);
  });

  it('fails with only a fail offset, when it is passed before Lynx starts the pan', () => {
    const { send } = runner(new PanGesture().minDistance(10).failOffsetX(5));

    send('onBegin', moved(0, 0));

    expect(send('onStart', moved(11, 0))).toEqual([]);
    expect(stateManager.fail).toHaveBeenCalledOnce();
  });

  it('reads a missing translation as no movement', () => {
    const { send } = runner(new PanGesture().activeOffsetX([-1, 1]));

    expect(send('onUpdate')).toEqual([]);
  });

  it('passes the touch callbacks', () => {
    const { send } = runner(new PanGesture().activeOffsetX(10));

    expect(send('onTouchesDown')).toEqual(['onTouchesDown']);
  });
});

describe('fling', () => {
  it('holds onBegin back until the first frame shows a direction it allows', () => {
    const { gate, send } = runner(
      new FlingGesture().direction(FlingDirection.RIGHT),
    );

    expect(gate.observes).toEqual(['onUpdate']);
    expect(send('onBegin', { tag: 'begin' } as GestureEvent)).toEqual([]);
    // The fling's first frame: 30px right, 5px up.
    expect(send('onUpdate', frame(-30, 5, 'first'))).toEqual([
      'onBegin@begin',
      'onUpdate@first',
    ]);
    expect(send('onUpdate', frame(20, 5))).toEqual(['onUpdate']);
    expect(send('onEnd')).toEqual(['onEnd']);
    expect(stateManager.fail).not.toHaveBeenCalled();
  });

  it.each([
    ['left', FlingDirection.LEFT, 30, 0],
    ['up', FlingDirection.UP, 0, 30],
    ['down', FlingDirection.DOWN, 0, -30],
  ])('recognizes a fling %s', (_name, direction, deltaX, deltaY) => {
    const { send } = runner(new FlingGesture().direction(direction));

    send('onBegin');

    expect(send('onUpdate', frame(deltaX, deltaY))).toEqual([
      'onBegin',
      'onUpdate',
    ]);
  });

  it('fails a fling the other way, and drops it', () => {
    const { send } = runner(
      new FlingGesture().direction(FlingDirection.LEFT | FlingDirection.RIGHT),
    );

    send('onBegin');

    expect(send('onUpdate', frame(5, -30))).toEqual([]);
    expect(stateManager.fail).toHaveBeenCalledOnce();
    expect(send('onUpdate', frame(5, -30))).toEqual([]);
    expect(send('onEnd')).toEqual([]);
    // The next fling is judged afresh.
    send('onBegin');
    expect(send('onUpdate', frame(-30, 0))).toEqual(['onBegin', 'onUpdate']);
  });

  it('allows a diagonal fling when either of its directions is allowed', () => {
    const { send } = runner(new FlingGesture().direction(FlingDirection.DOWN));

    send('onBegin');

    expect(send('onUpdate', frame(20, -20))).toEqual(['onBegin', 'onUpdate']);
  });

  it('waits for a frame that moves', () => {
    const { send } = runner(new FlingGesture().direction(FlingDirection.UP));

    send('onBegin');

    expect(send('onUpdate', frame(0, Number.EPSILON))).toEqual([]);
    expect(send('onUpdate', frame(0, 0))).toEqual([]);
    expect(send('onUpdate', {})).toEqual([]);
    expect(send('onUpdate', frame(0, 10))).toEqual(['onBegin', 'onUpdate']);
  });

  it('drops a fling that ends without moving', () => {
    const { send } = runner(new FlingGesture().direction(FlingDirection.UP));

    expect(send('onBegin')).toEqual([]);
    expect(send('onEnd')).toEqual([]);
    expect(stateManager.fail).not.toHaveBeenCalled();
  });

  it('holds an onStart with the onBegin', () => {
    const { send } = runner(new FlingGesture().direction(FlingDirection.UP));

    send('onBegin');
    expect(send('onStart')).toEqual([]);

    expect(send('onUpdate', frame(0, 10))).toEqual([
      'onBegin',
      'onStart',
      'onUpdate',
    ]);
  });

  it('passes the touch callbacks, which are not part of the fling', () => {
    const { send } = runner(new FlingGesture().direction(FlingDirection.UP));

    send('onBegin');

    expect(send('onTouchesDown')).toEqual(['onTouchesDown']);
  });
});

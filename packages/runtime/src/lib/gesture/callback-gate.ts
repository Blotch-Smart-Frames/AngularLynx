import type { BaseGesture } from './base-gesture';
import { DEFAULT_TAP_MAX_DELAY } from './const';
import type { GestureStateManager } from './state-manager';
import {
  type GestureEvent,
  type PanGestureEvent,
  FlingDirection,
  GestureType,
} from './types';

/**
 * Gesture options Lynx doesn't read, enforced between Lynx's callbacks and
 * the user's.
 *
 * As of Lynx 4.1, the native gesture handlers read five options: a tap's
 * `maxDuration` and `maxDistance`, a long press's `minDuration` and
 * `maxDistance`, and a pan's `minDistance`. LynxGestureDetector passes every
 * callback Lynx sends through a gate built from the gesture's options, which
 * decides which of the user's callbacks run, and when: it holds a pan's
 * `onStart` back until an active offset is passed, fails it past a fail
 * offset, counts taps, and keeps flings to their directions. (`enabled` is
 * handled by not registering the gesture at all: see gesture-detector.ts.)
 *
 * It sits in front of the callbacks rather than in Lynx's handlers, so it
 * can't change what Lynx does with the touch meanwhile: a pan waiting for its
 * active offset is active to Lynx, and holds the touch. The web preview runs
 * the same gates, through the same callbacks, so it behaves as a device does.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGesture = BaseGesture<any, any>;

/**
 * One of the user's callbacks to run, and the event to run it with.
 */
export type Delivery = readonly [name: string, event: GestureEvent];

export type CallbackGate = {
  /**
   * The callbacks the gate needs Lynx to send, whether or not the user
   * registered them, such as a pan's `onUpdate`, which tells it how far the
   * finger has moved.
   */
  readonly observes: readonly string[];
  /**
   * Which of the user's callbacks a callback from Lynx runs, in order: none,
   * while one is held back, or more than one, when it lets one go.
   */
  route(
    name: string,
    event: GestureEvent,
    stateManager: GestureStateManager,
  ): readonly Delivery[];
};

const PASSTHROUGH: CallbackGate = {
  observes: [],
  route: (name, event) => [[name, event]],
};

/**
 * The gate for a gesture's options, as they are when it's registered. The
 * gesture is registered again whenever an option changes (BaseGesture's
 * `_option`), which builds a new gate.
 */
export const createCallbackGate = (gesture: AnyGesture): CallbackGate => {
  switch (gesture.type) {
    case GestureType.TAP:
    case GestureType.LONGPRESS:
      return recognitionGate(gesture);
    case GestureType.PAN:
      return panGate(gesture);
    case GestureType.FLING:
      return flingGate(gesture);
    default:
      return PASSTHROUGH;
  }
};

/**
 * Tap and long press: `onEnd` only after a recognized gesture, and a tap's
 * `onStart` only on its `numberOfTaps`th tap.
 *
 * Lynx sends a tap's or long press's `onEnd` when it fails too (the iOS
 * `fail` path calls it), and only `onStart` when it's recognized. So the gate
 * watches `onStart`, and drops the `onEnd` of a gesture whose `onStart` it
 * didn't let through, giving `onEnd` react-native-gesture-handler's meaning:
 * the gesture happened.
 *
 * Lynx counts no taps, so for a `numberOfTaps` above 1 the gate counts the
 * single taps Lynx recognizes. A run of taps breaks when one fails, when the
 * finger stays up longer than DEFAULT_TAP_MAX_DELAY before the next touch
 * (measured at that touch's `onBegin`), or when a tap lands further than
 * `maxDistance` from the first.
 */
const recognitionGate = (gesture: AnyGesture): CallbackGate => {
  const taps =
    gesture.type === GestureType.TAP
      ? Math.max(1, Number(gesture._config['numberOfTaps']) || 1)
      : 1;
  if (taps === 1 && !gesture._callbacks['onEnd']) return PASSTHROUGH;
  // Always set: TapGesture seeds it.
  const maxDistance = Number(gesture._config['maxDistance']);
  /**
   * Whether Lynx recognized the current touch, and whether the gate let its
   * `onStart` through.
   */
  let recognized = false;
  let delivered = false;
  let count = 0;
  let lastTap = 0;
  let firstX = 0;
  let firstY = 0;

  /**
   * Counts a recognized tap, and says whether it completes the run.
   */
  const completes = (event: GestureEvent): boolean => {
    const x = event.absoluteX ?? 0;
    const y = event.absoluteY ?? 0;
    if (
      count &&
      (Math.abs(x - firstX) > maxDistance || Math.abs(y - firstY) > maxDistance)
    ) {
      count = 0;
    }
    if (!count) {
      firstX = x;
      firstY = y;
    }
    count++;
    lastTap = Date.now();
    if (count < taps) return false;
    count = 0;
    return true;
  };

  return {
    observes: taps > 1 ? ['onBegin', 'onStart', 'onEnd'] : ['onStart', 'onEnd'],
    route(name, event) {
      if (name === 'onBegin') {
        if (count && Date.now() - lastTap > DEFAULT_TAP_MAX_DELAY) count = 0;
      } else if (name === 'onStart') {
        recognized = true;
        delivered = completes(event);
        if (!delivered) return [];
      } else if (name === 'onEnd') {
        // A tap that failed breaks the run.
        if (!recognized) count = 0;
        const ran = delivered;
        recognized = false;
        delivered = false;
        if (!ran) return [];
      }
      return [[name, event]];
    },
  };
};

/**
 * A pan offset as the range `[start, end]` it allows (see PanOffset), or
 * null when it isn't set.
 */
const rangeOf = (offset: unknown): readonly [number, number] | null => {
  if (Array.isArray(offset)) return [Number(offset[0]), Number(offset[1])];
  if (typeof offset !== 'number') return null;
  return offset < 0 ? [offset, Infinity] : [-Infinity, offset];
};

const leaves = (
  value: number,
  range: readonly [number, number] | null,
): boolean => range !== null && (value < range[0] || value > range[1]);

/**
 * Pan: `activeOffsetX`/`Y` and `failOffsetX`/`Y`, judged on the translation
 * from where the touch began, as react-native-gesture-handler judges them.
 *
 * Lynx activates a pan at `minDistance`, and only then sends `onStart` and
 * `onUpdate`. Until the translation leaves an active offset's range, the
 * gate lets neither through; once it does, it runs `onStart` then that
 * event's `onUpdate`. A fail offset is checked first, as
 * react-native-gesture-handler checks it, and only until the pan starts.
 * `onBegin` and `onEnd` pass, as they do for a pan that never reaches
 * `minDistance`.
 *
 * Leaving a fail offset's range fails the pan with the state manager, and the
 * pan stays failed until the finger lifts:
 * - Lynx hears of the failure on its own thread, a few moves later, so the
 *   moves it sends meanwhile are dropped.
 * - On iOS, Lynx then gives the touch back to the failed pan, whose element
 *   is the only one with a gesture, and starts it again (`onBegin`, and
 *   `onEnd` once failed): every few moves for the rest of the drag. The gate
 *   fails each restart at once, so the touch stays with what took it (a
 *   scroll view), and runs only the first `onEnd`.
 * It knows the touch is over from `onTouchesUp` (or `onTouchesCancel`), and
 * that a new one began from `onTouchesDown`, which Lynx sends whatever the
 * pan's state.
 */
const panGate = (gesture: AnyGesture): CallbackGate => {
  const activeX = rangeOf(gesture._config['activeOffsetX']);
  const activeY = rangeOf(gesture._config['activeOffsetY']);
  const failX = rangeOf(gesture._config['failOffsetX']);
  const failY = rangeOf(gesture._config['failOffsetY']);
  if (!activeX && !activeY && !failX && !failY) return PASSTHROUGH;
  const hasActive = activeX !== null || activeY !== null;
  let phase: 'waiting' | 'started' | 'failed' = 'waiting';
  /**
   * Whether the failed pan's `onEnd` has run.
   */
  let ended = false;
  /**
   * Whether the finger lifted after the pan failed: Lynx can send the
   * failed pan's `onEnd` after `onTouchesUp`.
   */
  let lifted = false;

  const settle = (): void => {
    phase = 'waiting';
    ended = false;
    lifted = false;
  };

  return {
    observes: [
      'onStart',
      'onUpdate',
      'onTouchesDown',
      'onTouchesUp',
      'onTouchesCancel',
    ],
    route(name, event, stateManager) {
      // A pan that begins after the finger lifted is a new touch, in case
      // its onTouchesDown didn't come first.
      if (name === 'onTouchesDown' || (name === 'onBegin' && lifted)) {
        settle();
      } else if (name === 'onTouchesUp' || name === 'onTouchesCancel') {
        lifted = true;
      }
      if (phase === 'failed') {
        if (name === 'onBegin') stateManager.fail();
        if (name === 'onEnd' && !ended) {
          ended = true;
          return [[name, event]];
        }
        return name.startsWith('onTouches') ? [[name, event]] : [];
      }
      if (name !== 'onStart' && name !== 'onUpdate') {
        if (name === 'onBegin' || name === 'onEnd') phase = 'waiting';
        return [[name, event]];
      }
      if (phase === 'started') return [[name, event]];
      const { translationX = 0, translationY = 0 } = event as PanGestureEvent;
      if (leaves(translationX, failX) || leaves(translationY, failY)) {
        phase = 'failed';
        stateManager.fail();
        return [];
      }
      if (
        hasActive &&
        !leaves(translationX, activeX) &&
        !leaves(translationY, activeY)
      ) {
        return [];
      }
      phase = 'started';
      return name === 'onStart'
        ? [['onStart', event]]
        : [
            ['onStart', event],
            ['onUpdate', event],
          ];
    },
  };
};

/**
 * Smaller steps than this (px) are no movement: Lynx ends a fling with a
 * step of `FLT_EPSILON` in both axes.
 */
const STILL = 1e-3;

/**
 * The direction a fling frame moves in, along its longer axis (both, on a
 * diagonal), or 0 when it doesn't move. Lynx's `deltaX`/`deltaY` run against
 * the swipe, as a scroll offset does.
 */
const directionOf = (params: Record<string, unknown> | undefined): number => {
  const raw = (key: string): number => {
    const value = -Number(params?.[key]) || 0;
    return Math.abs(value) < STILL ? 0 : value;
  };
  const x = raw('deltaX');
  const y = raw('deltaY');
  const horizontal =
    x > 0 ? FlingDirection.RIGHT : x < 0 ? FlingDirection.LEFT : 0;
  const vertical = y > 0 ? FlingDirection.DOWN : y < 0 ? FlingDirection.UP : 0;
  if (Math.abs(x) > Math.abs(y)) return horizontal;
  if (Math.abs(y) > Math.abs(x)) return vertical;
  return horizontal | vertical;
};

/**
 * Fling: `direction`.
 *
 * A fling begins when the finger lifts, before it has moved, so the gate
 * holds its `onBegin` (and `onStart`, which the web preview can send) until
 * the first frame that moves. If that frame goes one of the fling's
 * directions, the held callbacks run, then the frame's `onUpdate`, and the
 * rest of the fling passes. If not, the gate fails the fling and drops it,
 * `onEnd` included. A fling that ends without moving was too slow to have a
 * direction, and is dropped too. Touch callbacks (`onTouchesDown` and the
 * like) aren't part of the fling and always pass.
 */
const flingGate = (gesture: AnyGesture): CallbackGate => {
  const directions = gesture._config['direction'];
  if (typeof directions !== 'number') return PASSTHROUGH;
  let phase: 'pending' | 'accepted' | 'rejected' = 'pending';
  let held: Delivery[] = [];

  const settle = (): void => {
    phase = 'pending';
    held = [];
  };

  return {
    observes: ['onUpdate'],
    route(name, event, stateManager) {
      const flinging =
        name === 'onBegin' ||
        name === 'onStart' ||
        name === 'onUpdate' ||
        name === 'onEnd';
      if (!flinging) return [[name, event]];
      if (name === 'onBegin') settle();
      if (phase === 'accepted') {
        if (name === 'onEnd') settle();
        return [[name, event]];
      }
      if (name === 'onEnd') {
        settle();
        return [];
      }
      if (phase === 'rejected') return [];
      if (name !== 'onUpdate') {
        held.push([name, event]);
        return [];
      }
      const direction = directionOf(event.params);
      if (!direction) return [];
      if (direction & directions) {
        phase = 'accepted';
        const released = [...held, [name, event] as const];
        held = [];
        return released;
      }
      phase = 'rejected';
      held = [];
      stateManager.fail();
      return [];
    },
  };
};

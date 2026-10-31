import {
  DEFAULT_GESTURE_MAX_DISTANCE,
  DEFAULT_LONG_PRESS_DURATION,
  DEFAULT_PAN_MIN_DISTANCE,
  DEFAULT_TAP_MAX_DURATION,
} from '../const';
import { GestureType } from '../types';
import {
  ORIGIN,
  type Point,
  type TouchPoint,
  type TouchType,
} from './touch-point';

/**
 * Ports of Lynx's native gesture handlers (platform/darwin/ios/lynx/gesture
 * in lynx-family/lynx: LynxPanGestureHandler.m, LynxTapGestureHandler.m,
 * LynxLongPressGestureHandler.m and LynxFlingGestureHandler.m) for Lynx for
 * Web, whose web-core recognizes no gestures. Each one follows a touch and
 * calls its gesture's callbacks when the native one would, so a gesture
 * behaves in the web preview as it does on iOS, quirks included (a tap's
 * `onEnd` also fires when it fails, a pan's `onEnd` after every touch). The
 * arena (./arena.ts) decides which element's handlers see each touch.
 */

/**
 * A handler's state: LynxGestureHandlerState in LynxBaseGestureHandler.h.
 * The arena compares them, so the order matters: from Fail on, the gesture
 * is out of this touch. An object rather than an enum, whose compiled IIFE
 * native bundles couldn't drop.
 */
export const HandlerState = {
  Init: 0,
  Begin: 1,
  Active: 2,
  Fail: 3,
  /**
   * What every failure sets, in Lynx's handlers.
   */
  Cancel: 4,
  /**
   * Ended from code, with the state manager's `end()`.
   */
  End: 5,
  /**
   * Sat this event out, as a pan does a fling's frames.
   */
  Undetermined: 6,
} as const;

export type HandlerState = (typeof HandlerState)[keyof typeof HandlerState];

/**
 * The step a fling's last frame passes. Lynx passes `FLT_EPSILON` in both
 * axes for it; this is compared by identity instead.
 */
export const FLING_END: Point = { x: Number.EPSILON, y: Number.EPSILON };

/**
 * A gesture as `__SetGestureDetector` registered it.
 */
export type WebGestureDetector = {
  readonly id: number;
  readonly type: number;
  /**
   * The gesture's callbacks by name. Only these are called.
   */
  readonly callbacks: ReadonlyMap<string, unknown>;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly waitFor: readonly number[];
  readonly simultaneous: readonly number[];
  readonly continueWith: readonly number[];
};

/**
 * Calls one of a gesture's callbacks with an event's params.
 */
export type Emit = (
  detector: WebGestureDetector,
  name: string,
  params: Record<string, unknown>,
) => void;

/**
 * Reads a numeric option the way Lynx's iOS handlers do: their defaults hold
 * only when no config is sent at all, and once one is, a key it leaves out
 * reads as 0 (`[nil floatValue]`). See ../const.ts.
 */
const option = (
  config: WebGestureDetector['config'],
  key: string,
  fallback: number,
): number => (config ? Number(config[key]) || 0 : fallback);

/**
 * A touch's params (`eventParamsFromTouchEvent`). None for a fling's frames.
 */
const touchParams = (touch: TouchPoint | null): Record<string, unknown> =>
  touch
    ? {
        timestamp: touch.timestamp,
        type: touch.type,
        x: touch.x,
        y: touch.y,
        pageX: touch.pageX,
        pageY: touch.pageY,
        clientX: touch.clientX,
        clientY: touch.clientY,
      }
    : {};

/**
 * What a pan or fling adds about its element's scrolling. A plain view
 * doesn't scroll, and web-core's scroll views aren't arena members, so it's
 * always at rest.
 */
const SCROLL_PARAMS = {
  scrollX: 0,
  scrollY: 0,
  isAtStart: false,
  isAtEnd: false,
};

const pagePoint = (touch: TouchPoint): Point => ({
  x: touch.pageX,
  y: touch.pageY,
});

/**
 * Whether `to` is more than `distance` from `from` in either axis.
 */
const beyond = (from: Point, to: Point, distance: number): boolean =>
  Math.abs(to.x - from.x) > distance || Math.abs(to.y - from.y) > distance;

export abstract class WebGestureHandler {
  status: HandlerState = HandlerState.Init;
  readonly #emit: Emit;

  constructor(
    readonly detector: WebGestureDetector,
    emit: Emit,
  ) {
    this.#emit = emit;
  }

  /**
   * Follows the touch. `touch` is null for a fling's frames, which come with
   * how far the fling moved since the last one (`step`).
   */
  abstract handle(
    type: TouchType | null,
    touch: TouchPoint | null,
    step: Point,
  ): void;

  /**
   * Stops the handler's timers, once the arena no longer uses it.
   */
  dispose(): void {}

  reset(): void {
    this.status = HandlerState.Init;
  }

  begin(): void {
    this.status = HandlerState.Begin;
  }

  activate(): void {
    this.status = HandlerState.Active;
  }

  fail(): void {
    if (this.status !== HandlerState.End) this.status = HandlerState.Cancel;
  }

  end(): void {
    this.status = HandlerState.End;
  }

  ignore(): void {
    this.status = HandlerState.Undetermined;
  }

  /**
   * `onTouchesDown` and the like, which every element of the touch gets.
   */
  touches(type: TouchType, touch: TouchPoint): void {
    const names: Record<TouchType, string> = {
      touchstart: 'onTouchesDown',
      touchmove: 'onTouchesMove',
      touchend: 'onTouchesUp',
      touchcancel: 'onTouchesCancel',
    };
    this.send(names[type], touchParams(touch));
  }

  /**
   * Calls the gesture's callback `name`, when it has one.
   */
  protected send(name: string, params: Record<string, unknown>): void {
    if (this.detector.callbacks.has(name)) {
      this.#emit(this.detector, name, params);
    }
  }
}

/**
 * LynxPanGestureHandler: begins when the touch does, activates once it has
 * moved more than `minDistance` in either axis, and ends (as a failure) when
 * it lifts. Its `onBegin`, `onStart` and `onEnd` fire once a touch.
 */
class PanHandler extends WebGestureHandler {
  readonly #minDistance = option(
    this.detector.config,
    'minDistance',
    DEFAULT_PAN_MIN_DISTANCE,
  );
  #start = ORIGIN;
  #last = ORIGIN;
  #lastTouch: TouchPoint | null = null;
  #begun = false;
  #started = false;
  #ended = false;

  handle(type: TouchType | null, touch: TouchPoint | null): void {
    this.#lastTouch = touch;
    if (!touch) {
      this.ignore();
      return;
    }
    if (this.status >= HandlerState.Fail) return;
    if (type === 'touchstart') {
      this.#start = pagePoint(touch);
      this.#ended = false;
      this.begin();
      this.#onBegin(touch);
    } else if (type === 'touchmove') {
      this.#last = pagePoint(touch);
      if (this.status === HandlerState.Init) {
        this.begin();
        this.#onBegin(touch);
      }
      if (beyond(this.#start, this.#last, this.#minDistance)) {
        this.activate();
        this.#onStart(touch);
      }
      if (this.status === HandlerState.Active) {
        this.send('onUpdate', { ...SCROLL_PARAMS, ...touchParams(touch) });
      }
    } else {
      this.fail();
    }
  }

  override fail(): void {
    super.fail();
    this.#onEnd();
  }

  override end(): void {
    super.end();
    this.#onEnd();
  }

  override reset(): void {
    super.reset();
    this.#begun = false;
    this.#started = false;
    this.#ended = false;
  }

  #onBegin(touch: TouchPoint): void {
    if (this.#begun) return;
    this.#begun = true;
    this.send('onBegin', { ...SCROLL_PARAMS, ...touchParams(touch) });
  }

  #onStart(touch: TouchPoint): void {
    if (this.#started || !this.#begun) return;
    this.#started = true;
    this.send('onStart', { ...SCROLL_PARAMS, ...touchParams(touch) });
  }

  #onEnd(): void {
    if (this.#ended || !this.#begun) return;
    this.#ended = true;
    this.send('onEnd', { ...SCROLL_PARAMS, ...touchParams(this.#lastTouch) });
  }
}

/**
 * LynxTapGestureHandler: begins when the touch does, fails once it moves
 * more than `maxDistance` in either axis or lasts longer than `maxDuration`,
 * and otherwise activates when it lifts, firing `onStart` then `onEnd`.
 */
class TapHandler extends WebGestureHandler {
  readonly #maxDuration = option(
    this.detector.config,
    'maxDuration',
    DEFAULT_TAP_MAX_DURATION,
  );
  readonly #maxDistance = option(
    this.detector.config,
    'maxDistance',
    DEFAULT_GESTURE_MAX_DISTANCE,
  );
  #start = ORIGIN;
  #lastTouch: TouchPoint | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  handle(type: TouchType | null, touch: TouchPoint | null): void {
    this.#lastTouch = touch;
    if (!touch) {
      this.ignore();
      return;
    }
    if (this.status >= HandlerState.Fail) {
      this.dispose();
      return;
    }
    if (type === 'touchstart') {
      this.#start = pagePoint(touch);
      this.begin();
      this.send('onBegin', touchParams(touch));
      this.#startTimer();
      return;
    }
    if (type === 'touchmove') {
      if (beyond(this.#start, pagePoint(touch), this.#maxDistance)) {
        this.fail();
      }
      return;
    }
    // Lynx counts a canceled touch as a tap. On the web the browser cancels
    // a touch when it scrolls or zooms the page instead, so here it fails, as
    // a tap that turns into a scroll does on iOS and Android.
    if (type === 'touchcancel') {
      this.fail();
    } else {
      this.activate();
      this.send('onStart', touchParams(touch));
      this.send('onEnd', touchParams(touch));
    }
    this.dispose();
  }

  override dispose(): void {
    // The main thread's clearTimeout throws for undefined.
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  override fail(): void {
    super.fail();
    this.send('onEnd', touchParams(this.#lastTouch));
  }

  override end(): void {
    super.end();
    this.send('onEnd', touchParams(this.#lastTouch));
  }

  #startTimer(): void {
    this.dispose();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.fail();
    }, this.#maxDuration);
  }
}

/**
 * LynxLongPressGestureHandler: begins when the touch does, activates (firing
 * `onStart`) once it has lasted `minDuration` without moving more than
 * `maxDistance`, and ends (as a failure, firing `onEnd`) when it lifts.
 */
class LongPressHandler extends WebGestureHandler {
  readonly #minDuration = option(
    this.detector.config,
    'minDuration',
    DEFAULT_LONG_PRESS_DURATION,
  );
  readonly #maxDistance = option(
    this.detector.config,
    'maxDistance',
    DEFAULT_GESTURE_MAX_DISTANCE,
  );
  #start = ORIGIN;
  #lastTouch: TouchPoint | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  handle(type: TouchType | null, touch: TouchPoint | null): void {
    this.#lastTouch = touch;
    if (!touch) {
      this.ignore();
      return;
    }
    if (this.status >= HandlerState.Fail) {
      this.dispose();
      return;
    }
    if (type === 'touchstart') {
      this.#start = pagePoint(touch);
      this.begin();
      this.send('onBegin', touchParams(touch));
      this.#startTimer();
    } else if (type === 'touchmove') {
      if (
        this.status === HandlerState.Begin &&
        beyond(this.#start, pagePoint(touch), this.#maxDistance)
      ) {
        this.fail();
        this.dispose();
      }
    } else {
      this.dispose();
      this.fail();
    }
  }

  override dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  override fail(): void {
    super.fail();
    this.send('onEnd', touchParams(this.#lastTouch));
  }

  override end(): void {
    super.end();
    this.send('onEnd', touchParams(this.#lastTouch));
  }

  #startTimer(): void {
    this.dispose();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      // Lynx activates unless the press failed or is active already, but its
      // failures set Cancel, so a press another gesture beat still activated.
      // Here only one still waiting does.
      if (this.status !== HandlerState.Begin) return;
      this.activate();
      this.send('onStart', touchParams(this.#lastTouch));
    }, this.#minDuration);
  }
}

/**
 * LynxFlingGestureHandler: the momentum after a touch, driven by the arena's
 * fling trigger. It sits the touch out, begins when the finger lifts, gets
 * each frame's step as `deltaX`/`deltaY` in `onUpdate`, and ends with the
 * fling. Lynx never activates it after a touch, so its `onStart` doesn't fire.
 */
class FlingHandler extends WebGestureHandler {
  #begun = false;
  #started = false;
  #ended = false;

  handle(type: TouchType | null, touch: TouchPoint | null, step: Point): void {
    if (touch) {
      if (type === 'touchend') {
        this.begin();
        this.#onBegin(ORIGIN);
      } else {
        // Lynx flings after a canceled touch too. The browser cancels one
        // when it takes the touch to scroll, so here that's no fling.
        this.ignore();
      }
      return;
    }
    if (this.status >= HandlerState.Fail && this.status <= HandlerState.End) {
      this.#onEnd(ORIGIN);
      return;
    }
    if (step === FLING_END) {
      this.fail();
      return;
    }
    if (
      this.status === HandlerState.Init ||
      this.status === HandlerState.Undetermined
    ) {
      this.begin();
      this.activate();
      this.#onBegin(ORIGIN);
      this.#onStart(ORIGIN);
      return;
    }
    this.send('onUpdate', this.#params(step));
  }

  override fail(): void {
    super.fail();
    this.#onEnd(ORIGIN);
  }

  override end(): void {
    super.end();
    this.#onEnd(ORIGIN);
  }

  override reset(): void {
    super.reset();
    this.#begun = false;
    this.#started = false;
    this.#ended = false;
  }

  #onBegin(step: Point): void {
    // Unlike the pan's, a fling's `begun` is set only when it has an onBegin
    // to call, so without one its onStart and onEnd never fire either.
    if (this.#begun || !this.detector.callbacks.has('onBegin')) return;
    this.#begun = true;
    this.send('onBegin', this.#params(step));
  }

  #onStart(step: Point): void {
    if (this.#started || !this.#begun) return;
    this.#started = true;
    this.send('onStart', this.#params(step));
  }

  #onEnd(step: Point): void {
    if (this.#ended || !this.#begun) return;
    this.#ended = true;
    this.send('onEnd', this.#params(step));
  }

  #params(step: Point): Record<string, unknown> {
    return { ...SCROLL_PARAMS, deltaX: step.x, deltaY: step.y };
  }
}

/**
 * The handlers for an element's gestures, in the order they see each event:
 * the order of LynxGestureHandlerOption's bits, as Android's map of them
 * iterates. So on a tap in `Gesture.Exclusive(pan, tap)`, the pan's `onEnd`
 * runs before the tap's. Pinch and rotation have no handler on any platform
 * (see investigations/lynx-vs-web-differences.md), and a native gesture is a
 * pan to Lynx.
 */
export const createHandlers = (
  detectors: Iterable<WebGestureDetector>,
  emit: Emit,
): WebGestureHandler[] => {
  // Built here, not at the top of the module, so that native bundles, which
  // never call this, drop it with the classes.
  const handlers: [
    GestureType,
    new (detector: WebGestureDetector, emit: Emit) => WebGestureHandler,
  ][] = [
    [GestureType.PAN, PanHandler],
    [GestureType.FLING, FlingHandler],
    [GestureType.TAP, TapHandler],
    [GestureType.LONGPRESS, LongPressHandler],
    [GestureType.NATIVE, PanHandler],
  ];
  const all = [...detectors];
  return handlers.flatMap(([type, Handler]) =>
    all
      .filter((detector) => detector.type === type)
      .map((detector) => new Handler(detector, emit)),
  );
};

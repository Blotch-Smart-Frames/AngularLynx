/**
 * Long presses on Lynx for Web, which never fires `longpress`.
 *
 * Native Lynx recognizes a long press itself and fires `longpress` instead
 * of `tap` when a finger stays down. Lynx for Web's event handling has no
 * recognizer for it (`@lynx-js/web-core` passes DOM events through and maps
 * `click` to `tap`, and nothing else), so `(bindlongpress)` never ran in the
 * web preview: a long press was a tap. LynxElement recognizes one from the
 * element's touch and mouse events instead (see #listenForWebLongPress).
 */

/**
 * How long a press is held before it's a long press, in ms: iOS's default
 * (`UILongPressGestureRecognizer.minimumPressDuration`), close to Android's.
 */
export const LONG_PRESS_DURATION = 500;

/**
 * How far a press can move, in px, and still become a long press. Further,
 * it's a drag or a scroll.
 */
const LONG_PRESS_SLOP = 10;

/**
 * How long after a long press ends the tap that follows is dropped, in ms.
 * The browser sends `click`, which web-core turns into `tap`, right after the
 * finger or the mouse button comes up, where native Lynx sends no tap at all.
 */
const TAP_GRACE = 300;

/** Whether taps are dropped now (see dropsTap). */
let tapsDropped = false;

/**
 * Counts long presses, so that the end of an earlier one can't let taps
 * through again during a later one.
 */
let longPresses = 0;

/**
 * Whether a tap now ends a long press, and so shouldn't run: from the moment
 * a long press fires until just after it ends. The browser's `click` goes to
 * whatever was under the pointer, so it's dropped wherever it lands.
 */
export const dropsTap = (): boolean => tapsDropped;

/** Where a press is, in the `<lynx-view>`'s pixels. */
export type LongPressPoint = { readonly x: number; readonly y: number };

/**
 * Where a web-core touch or mouse event happened. A touch event has the
 * first touch's position in `detail`; a mouse event has it on the event, and
 * its `detail` is the DOM's click count.
 */
const pointOf = (event: {
  readonly detail?: unknown;
  readonly x?: number;
  readonly y?: number;
}): LongPressPoint => {
  const { x = 0, y = 0 } =
    typeof event.detail === 'object' && event.detail !== null
      ? (event.detail as LongPressPoint)
      : event;
  return { x, y };
};

/**
 * Recognizes long presses from one element's touch and mouse events, and
 * calls `fire` with where the press is when one has lasted
 * LONG_PRESS_DURATION without moving away.
 */
export class WebLongPress {
  readonly #fire: (point: LongPressPoint) => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #start: LongPressPoint | null = null;
  #fired = false;

  constructor(fire: (point: LongPressPoint) => void) {
    this.#fire = fire;
  }

  /** `touchstart` and `mousedown`: a press starts. */
  readonly start = (event: {
    readonly detail?: unknown;
    readonly x?: number;
    readonly y?: number;
    readonly button?: number;
  }): void => {
    // A right click opens the browser's own menu; only the main button
    // presses. A touch has no button.
    if (event.button !== undefined && event.button !== 0) return;
    this.#stop();
    this.#fired = false;
    const point = pointOf(event);
    this.#start = point;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#fired = true;
      longPresses++;
      tapsDropped = true;
      this.#fire(point);
    }, LONG_PRESS_DURATION);
  };

  /** `touchmove` and `mousemove`: a press that moves too far is no long press. */
  readonly move = (event: {
    readonly detail?: unknown;
    readonly x?: number;
    readonly y?: number;
  }): void => {
    if (!this.#start) return;
    const { x, y } = pointOf(event);
    if (Math.hypot(x - this.#start.x, y - this.#start.y) > LONG_PRESS_SLOP) {
      this.#stop();
    }
  };

  /**
   * `touchend`, `touchcancel`, `mouseup` and `mouseleave`: the press is over.
   * The tap that ends a long press is dropped (see dropsTap).
   */
  readonly end = (): void => {
    this.#stop();
    this.#start = null;
    if (this.#fired) {
      this.#fired = false;
      const longPress = longPresses;
      setTimeout(() => {
        if (longPress === longPresses) tapsDropped = false;
      }, TAP_GRACE);
    }
  };

  #stop(): void {
    // The main thread's clearTimeout throws for undefined.
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

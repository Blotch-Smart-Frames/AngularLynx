import { globalEvents } from '../global-events';

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

/**
 * The page-wide events that end a press, heard on the app's `document`
 * (global-events), which hears every event in the `<lynx-view>`. Not
 * `globalThis.document`: in the web preview the main thread runs in an
 * iframe, whose own document hears nothing of the page.
 */
const RELEASES = ['touchend', 'touchcancel', 'mouseup'] as const;

/** Where a press's release is heard, whatever it lands on. */
export type ReleaseTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

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
  /** Stops listening for the release on the document, once it's heard. */
  #unlisten: (() => void) | null = null;

  readonly #releases: () => ReleaseTarget;

  constructor(
    fire: (point: LongPressPoint) => void,
    releases: () => ReleaseTarget = () => globalEvents().document,
  ) {
    this.#fire = fire;
    this.#releases = releases;
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
      this.#listenForRelease();
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
    this.#unlisten?.();
    this.#unlisten = null;
    this.#start = null;
    if (this.#fired) {
      this.#fired = false;
      const longPress = longPresses;
      setTimeout(() => {
        if (longPress === longPresses) tapsDropped = false;
      }, TAP_GRACE);
    }
  };

  /**
   * Hears the press end anywhere, not only on the element. A long press
   * often opens something over the element, such as a menu or a sheet,
   * and the finger or the button then comes up on that: the element never
   * hears it, and without this every tap after it would be dropped, for
   * good.
   */
  #listenForRelease(): void {
    const document = this.#releases();
    for (const type of RELEASES) document.addEventListener(type, this.end);
    this.#unlisten = () => {
      for (const type of RELEASES) {
        document.removeEventListener(type, this.end);
      }
    };
  }

  #stop(): void {
    // The main thread's clearTimeout throws for undefined.
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

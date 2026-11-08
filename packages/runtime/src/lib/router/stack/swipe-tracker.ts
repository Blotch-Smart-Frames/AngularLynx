/**
 * How far from the outlet's leading edge a touch starts an edge swipe, in px.
 * UIKit's screen-edge pan recognizes within about 20pt of the edge; a little
 * more forgives a thumb that lands just inside it.
 */
export const EDGE_WIDTH = 24;

/**
 * How far a finger moves before the touch is a swipe, or isn't, in px. Below
 * it, it's still a tap, and Lynx sends the tap.
 */
const SLOP = 10;

/** How far back the velocity looks, in ms. */
const VELOCITY_WINDOW = 80;

/**
 * UIScrollView's normal deceleration rate, which projects where a released
 * page would coast to (see {@link SwipeTracker.completes}), as Apple's
 * "Designing Fluid Interfaces" does to decide where a flung thing lands.
 */
const DECELERATION_RATE = 0.998;

/** Where a swipe stands: deciding, following the finger, or not one at all. */
export type SwipeState = 'pending' | 'dragging' | 'ignored';

type Sample = { readonly x: number; readonly time: number };

/**
 * Turns one touch into a swipe back, or decides it isn't one. A touch that
 * starts at the leading edge, or anywhere when `content` swipes are allowed,
 * becomes a swipe once it moves right further than it moves up or down, as
 * iOS's swipe back does (the edge's since iOS 7, anywhere on the page since
 * iOS 26). Moving left, or up or down first, leaves the touch to the page.
 */
export class SwipeTracker {
  readonly #startX: number;
  readonly #startY: number;
  readonly #width: number;
  readonly #fromEdge: boolean;
  #state: SwipeState = 'pending';
  #x: number;
  #samples: Sample[] = [];

  /**
   * @param x, y Where the touch started, relative to the outlet.
   * @param width The outlet's width, which a full swipe crosses.
   * @param content Whether a touch away from the edge can swipe too.
   */
  constructor(
    x: number,
    y: number,
    time: number,
    width: number,
    content: boolean,
  ) {
    this.#startX = x;
    this.#startY = y;
    this.#x = x;
    this.#width = width;
    this.#fromEdge = x <= EDGE_WIDTH;
    this.#samples.push({ x, time });
    if (!this.#fromEdge && !content) this.#state = 'ignored';
  }

  get state(): SwipeState {
    return this.#state;
  }

  /**
   * Whether the touch started at the edge.
   */
  get fromEdge(): boolean {
    return this.#fromEdge;
  }

  /**
   * How far across the outlet the finger has taken the page, 0 to 1.
   */
  get progress(): number {
    return clamp((this.#x - this.#startX) / this.#width, 0, 1);
  }

  /**
   * The finger's horizontal speed lately, in px per ms (right is positive).
   */
  get velocity(): number {
    const last = this.#samples.at(-1)!;
    // The last sample is always in the window, so there's always a first.
    const first = this.#samples.find(
      (s) => last.time - s.time <= VELOCITY_WINDOW,
    )!;
    const elapsed = last.time - first.time;
    return elapsed > 0 ? (last.x - first.x) / elapsed : 0;
  }

  /**
   * Follows the finger to `x`, `y`, and says what the touch is now.
   */
  move(x: number, y: number, time: number): SwipeState {
    if (this.#state === 'ignored') return this.#state;
    this.#x = x;
    this.#samples.push({ x, time });
    // Only the window's samples matter: drop the rest as they age out.
    while (
      this.#samples.length > 2 &&
      time - this.#samples[1]!.time > VELOCITY_WINDOW
    ) {
      this.#samples.shift();
    }
    if (this.#state === 'pending') {
      const dx = x - this.#startX;
      const dy = Math.abs(y - this.#startY);
      if (dx < -SLOP || (dy > SLOP && dy >= Math.abs(dx))) {
        this.#state = 'ignored';
      } else if (dx > SLOP && dx > dy) {
        this.#state = 'dragging';
      }
    }
    return this.#state;
  }

  /**
   * Whether letting go now takes the page all the way, or brings it back: it
   * goes if it would coast past halfway at the finger's speed, so a flick goes
   * from anywhere and a slow drag goes from past the middle.
   */
  completes(): boolean {
    const coast = (this.velocity * DECELERATION_RATE) / (1 - DECELERATION_RATE);
    return this.#x - this.#startX + coast > this.#width / 2;
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

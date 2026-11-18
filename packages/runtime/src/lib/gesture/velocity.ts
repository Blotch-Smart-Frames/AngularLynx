/**
 * How far back VelocityTracker looks, in ms. A finger that stopped before
 * lifting has no velocity, and so starts no fling.
 */
const VELOCITY_WINDOW = 100;

const STILL = { x: 0, y: 0 } as const;

/**
 * A pointer's velocity, from the positions it was at over the last 100 ms.
 *
 * Lynx sends a gesture's positions but never its velocity, so the runtime
 * works it out on both sides: mapGestureEvent fills a pan's and a fling's
 * `velocityX`/`velocityY` with it, and the web preview's arena uses it to
 * decide whether a release flings, as Lynx's iOS LynxGestureVelocityTracker
 * does. It lives outside web/ so that a native build doesn't pull in the web
 * preview's code to use it.
 */
export class VelocityTracker {
  #samples: { t: number; x: number; y: number }[] = [];

  reset(): void {
    this.#samples = [];
  }

  /**
   * Records that the pointer was at (`x`, `y`) at `t` ms.
   */
  add(t: number, x: number, y: number): void {
    const last = this.#samples[this.#samples.length - 1];
    // A clock that runs backwards means the samples came from different
    // clocks (Lynx stamps a touch's events with the platform's touch clock and
    // others with the wall clock), so the old ones can't be measured against.
    if (last && t < last.t) this.#samples = [];
    this.#samples.push({ t, x, y });
    this.#samples = this.#samples.filter(
      (sample) => t - sample.t <= VELOCITY_WINDOW,
    );
  }

  /**
   * In pixels a second, in whatever pixels `add` was given.
   */
  velocity(): { readonly x: number; readonly y: number } {
    const first = this.#samples[0];
    const last = this.#samples[this.#samples.length - 1];
    const seconds = first ? (last.t - first.t) / 1000 : 0;
    if (seconds <= 0) return STILL;
    return {
      x: (last.x - first.x) / seconds,
      y: (last.y - first.y) / seconds,
    };
  }
}

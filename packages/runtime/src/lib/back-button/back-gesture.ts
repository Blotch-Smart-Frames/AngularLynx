import { Injectable } from '@angular/core';

/**
 * The screen edge Android's back gesture started from: a person can swipe
 * back from either side. A key press or the 3-button bar's back has none,
 * and starts no gesture.
 */
export type BackGestureEdge = 'left' | 'right';

/**
 * What follows one back gesture, such as a stack moving its top page with
 * the finger (see LynxStackOutlet). Each call after the gesture moved on
 * elsewhere (a navigation came, so the page isn't on top) does nothing.
 */
export type BackGestureFollower = {
  /** The finger is `progress` (0 to 1) of the way, as Android measures it. */
  progress(progress: number): void;
  /** The person let go short, or the system took the gesture back. */
  cancel(): void;
  /**
   * The person let go and back happens: the follower finishes going back.
   * Returns false if it can't any more, and back goes as a press would.
   */
  commit(): boolean;
};

/**
 * Asked as a back gesture starts whether it follows it: a follower if back
 * would go where it can show, or null.
 */
export type BackGestureTarget = (
  edge: BackGestureEdge,
) => BackGestureFollower | null;

/**
 * The things that can follow Android's predictive back gesture as the finger
 * moves, rather than only hear back once it's done. LynxBackButton asks them
 * as a gesture starts that nothing registered with `LynxBackButton.on()`
 * takes; the stack outlets register here.
 *
 * Kept apart from LynxBackButton so that it stays out of the public API: the
 * outlets are the only followers.
 */
@Injectable({ providedIn: 'root' })
export class BackGestures {
  /** The targets, last registered last. */
  readonly #targets: BackGestureTarget[] = [];

  /**
   * Has `target` asked as each back gesture starts, until the function it
   * returns is called.
   */
  register(target: BackGestureTarget): () => void {
    this.#targets.push(target);
    return () => {
      const at = this.#targets.indexOf(target);
      if (at >= 0) this.#targets.splice(at, 1);
    };
  }

  /**
   * The follower of a gesture starting from `edge`: the first target that
   * takes it, the last registered first. A stack inside a page registers after
   * the stack the page is in, so the innermost stack is asked first, as back
   * goes there first; each stack takes only a gesture that goes back from its
   * own top page anyway.
   */
  start(edge: BackGestureEdge): BackGestureFollower | null {
    for (let i = this.#targets.length - 1; i >= 0; i--) {
      const follower = this.#targets[i]!(edge);
      if (follower) return follower;
    }
    return null;
  }
}

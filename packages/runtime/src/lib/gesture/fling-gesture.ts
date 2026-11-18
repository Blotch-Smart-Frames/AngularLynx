import { ContinuousGesture } from './base-gesture';
import {
  type FlingGestureEvent,
  type FlingDirection,
  GestureType,
} from './types';

/**
 * Lynx's fling follows the momentum of a drag after the finger lifts: `onBegin`
 * fires on release, `onUpdate` on every frame (with `deltaX`/`deltaY` in the
 * params), and `onEnd` when it stops. Lynx starts that fling in its BEGAN
 * state and never activates it, so `onStart` doesn't fire
 * (LynxFlingGestureHandler.m / FlingGestureHandler.java). Lynx also flings only
 * the element that won the touch, and a fling ignores the touch until the
 * finger lifts, so it needs a pan on the same element (`Gesture.Simultaneous`).
 */
export class FlingGesture extends ContinuousGesture<
  FlingGestureEvent,
  FlingGesture
> {
  readonly type = GestureType.FLING;

  /**
   * The directions the fling recognizes. FlingDirection is a bitmask, so
   * combine values with `|`: `FlingDirection.LEFT | FlingDirection.RIGHT`
   * recognizes horizontal flings. A fling goes the way its first frame moves,
   * along whichever axis it moves further. One that goes another way fails
   * and runs none of its callbacks, and so does one too slow to move at all.
   *
   * Lynx's fling handlers read no options (as of Lynx 4.1: iOS's
   * `handleConfigMap` is a TODO, Android's is empty), so the runtime decides,
   * holding back `onBegin` until the first frame shows the direction (see
   * ./callback-gate.ts).
   */
  direction(dir: FlingDirection): this {
    return this._option('direction', dir);
  }

  /**
   * ⚠️ Does nothing: Lynx follows one finger at a time, and neither reads
   * this option nor says how many fingers are down (as of Lynx 4.1). Kept for
   * API parity with Lynx's gesture-runtime.
   */
  numberOfPointers(count: number): this {
    return this._option('numberOfPointers', count);
  }
}

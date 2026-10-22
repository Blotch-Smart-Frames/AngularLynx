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
   * FlingDirection is a bitmask — combine values with | for multi-direction:
   * e.g. FlingDirection.LEFT | FlingDirection.RIGHT recognizes horizontal flings.
   *
   * ⚠️ Not read by Lynx's native fling handlers yet: as of Lynx 4.1, iOS's
   * `handleConfigMap` is a TODO and Android's is empty, so every fling fires,
   * in any direction. Kept for API parity with Lynx's gesture-runtime.
   */
  direction(dir: FlingDirection): this {
    this._config['direction'] = dir;
    return this;
  }

  /**
   * The gesture only recognizes when exactly `count` fingers are involved.
   * Defaults to 1 if not set.
   *
   * ⚠️ Not read by Lynx's native fling handlers yet (see `direction`).
   */
  numberOfPointers(count: number): this {
    this._config['numberOfPointers'] = count;
    return this;
  }
}

import { BaseGesture } from './base-gesture';
import {
  DEFAULT_GESTURE_MAX_DISTANCE,
  DEFAULT_TAP_MAX_DURATION,
} from './const';
import { type TapGestureEvent, GestureType } from './types';

export class TapGesture extends BaseGesture<TapGestureEvent, TapGesture> {
  readonly type = GestureType.TAP;

  /**
   * Seed the FULL default config on construction. The native iOS handler reads
   * any absent config key as `0` once a config is present, so shipping a partial
   * config (e.g. only `numberOfTaps`) would zero out `maxDuration`/`maxDistance`
   * and make every tap fail instantly. Mirrors Lynx's own gesture-runtime
   * TapGesture defaults. See ./const for the full explanation.
   */
  override _config: Record<string, unknown> = {
    enabled: true,
    maxDuration: DEFAULT_TAP_MAX_DURATION,
    maxDistance: DEFAULT_GESTURE_MAX_DISTANCE,
  };

  /**
   * How many taps in a row the gesture needs: `numberOfTaps(2)` is a double
   * tap. Its `onStart` and `onEnd` run on the last tap only. The taps must
   * each succeed, follow each other within 500 ms of the finger lifting, and
   * land within `maxDistance` of the first.
   *
   * No Lynx platform counts taps (nothing in Lynx's source reads
   * `numberOfTaps`), so the runtime does, from the single taps Lynx
   * recognizes (see ./callback-gate.ts). Lynx still recognizes each tap on its
   * own, so a single tap on the same element can't wait for this one to fail:
   * `Gesture.Exclusive(doubleTap, singleTap)` doesn't work.
   */
  numberOfTaps(count: number): this {
    return this._option('numberOfTaps', count);
  }

  /**
   * Maximum time between finger-down and finger-up for a tap to register.
   * Touches held longer than this are treated as a long-press.
   */
  maxDuration(ms: number): this {
    return this._option('maxDuration', ms);
  }

  /**
   * If the finger travels more than `px` pixels before lifting, the tap fails.
   * Keeps a tap distinct from a small drag.
   */
  maxDistance(px: number): this {
    return this._option('maxDistance', px);
  }
}

import { BaseGesture } from './base-gesture';
import {
  DEFAULT_GESTURE_MAX_DISTANCE,
  DEFAULT_LONG_PRESS_DURATION,
} from './const';
import { type LongPressGestureEvent, GestureType } from './types';

export class LongPressGesture extends BaseGesture<
  LongPressGestureEvent,
  LongPressGesture
> {
  readonly type = GestureType.LONGPRESS;

  /**
   * Seed the FULL default config on construction. Without an explicit
   * `maxDistance`, calling only `minDuration()` would send a partial config and
   * the native handler would read `maxDistance` back as `0` — failing the
   * long-press on the tiniest finger jitter. Mirrors Lynx's own gesture-runtime
   * LongPressGesture defaults. See ./const for the full explanation.
   */
  override _config: Record<string, unknown> = {
    enabled: true,
    minDuration: DEFAULT_LONG_PRESS_DURATION,
    maxDistance: DEFAULT_GESTURE_MAX_DISTANCE,
  };

  /**
   * Minimum hold time in ms before the gesture is recognized.
   * Shorter presses are treated as taps and ignored.
   */
  minDuration(ms: number): this {
    this._config['minDuration'] = ms;
    return this;
  }

  /**
   * If the finger drifts more than `px` pixels from the initial touch point
   * during the hold, the gesture fails — allowing a scroll to take over.
   */
  maxDistance(px: number): this {
    this._config['maxDistance'] = px;
    return this;
  }
}

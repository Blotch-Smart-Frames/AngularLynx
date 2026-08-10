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
   * For double/triple tap, pair with waitFor on the single-tap gesture so
   * the single-tap handler doesn't fire prematurely before the count is met.
   *
   * ⚠️ NOT enforced by the Lynx native runtime — no platform handler implements
   * multi-tap counting (a whole-tree search of the Lynx source turns up nothing
   * that reads `numberOfTaps`), so setting this is currently a no-op on-device.
   * To detect a double-tap, time successive taps yourself in the callback. Kept
   * for API parity with Lynx's gesture-runtime.
   */
  numberOfTaps(count: number): this {
    this._config['numberOfTaps'] = count;
    return this;
  }

  /**
   * Maximum time between finger-down and finger-up for a tap to register.
   * Touches held longer than this are treated as a long-press.
   */
  maxDuration(ms: number): this {
    this._config['maxDuration'] = ms;
    return this;
  }

  /**
   * If the finger travels more than `px` pixels before lifting, the tap fails.
   * Keeps a tap distinct from a small drag.
   */
  maxDistance(px: number): this {
    this._config['maxDistance'] = px;
    return this;
  }
}

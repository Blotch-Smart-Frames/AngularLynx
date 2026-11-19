import { ContinuousGesture } from './base-gesture';
import { DEFAULT_PAN_MIN_DISTANCE } from './const';
import { type PanGestureEvent, GestureType } from './types';

/**
 * A pan offset: a range of translation, in px, from where the touch began.
 * A pair `[start, end]` (start ≤ 0 ≤ end) is the range itself. A number
 * `p` is open on one side, as in react-native-gesture-handler: `p ≥ 0` is
 * everything up to `p` (so only moving right or down past `p` leaves it),
 * and `p < 0` everything from `p` on.
 */
export type PanOffset = number | [start: number, end: number];

export class PanGesture extends ContinuousGesture<PanGestureEvent, PanGesture> {
  readonly type = GestureType.PAN;

  /**
   * Seed the default config on construction so a complete config is always sent
   * to native, keeping behavior consistent with the other gestures. Mirrors
   * Lynx's own gesture-runtime PanGesture defaults. See ./const.
   */
  override _config: Record<string, unknown> = {
    enabled: true,
    minDistance: DEFAULT_PAN_MIN_DISTANCE,
  };

  minDistance(distance: number): this {
    return this._option('minDistance', distance);
  }

  /**
   * The pan starts (`onStart`, then `onUpdate`) only once the finger's
   * horizontal translation leaves this range: `activeOffsetX([-20, 20])`
   * starts it after 20px of movement left or right. With active offsets on
   * both axes, leaving either range starts it.
   *
   * Lynx's native pan handlers read only `minDistance` (as of Lynx 4.1), so
   * the runtime holds back `onStart` and `onUpdate` until the offset is passed
   * (see ./callback-gate.ts). To Lynx the pan is active from `minDistance` on,
   * so it already holds the touch, and fails the element's other gestures
   * that aren't simultaneous with it, before then.
   */
  activeOffsetX(offset: PanOffset): this {
    return this._option('activeOffsetX', offset);
  }

  /**
   * The same as `activeOffsetX`, vertically.
   */
  activeOffsetY(offset: PanOffset): this {
    return this._option('activeOffsetY', offset);
  }

  /**
   * The pan fails once the finger's horizontal translation leaves this range
   * before the pan has started, ceding the touch to the gestures it competes
   * with. Pair it with an active offset on the other axis:
   * `activeOffsetY([-10, 10]).failOffsetX([-10, 10])` is a vertical pan that
   * gives up a sideways drag.
   *
   * Without an active offset, the pan starts once Lynx activates it, at
   * `minDistance` (`0` by default, so on the first move), which leaves a fail
   * offset nothing to do. Lynx doesn't read fail offsets, so the runtime calls
   * the state manager's `fail()` for you (see ./callback-gate.ts).
   */
  failOffsetX(offset: PanOffset): this {
    return this._option('failOffsetX', offset);
  }

  /**
   * The same as `failOffsetX`, vertically.
   */
  failOffsetY(offset: PanOffset): this {
    return this._option('failOffsetY', offset);
  }

  /**
   * ⚠️ Does nothing: Lynx follows one finger at a time, and neither reads
   * this option nor says how many fingers are down (as of Lynx 4.1). Kept for
   * API parity with Lynx's gesture-runtime.
   */
  minPointers(count: number): this {
    return this._option('minPointers', count);
  }

  /**
   * ⚠️ Does nothing, as `minPointers`.
   */
  maxPointers(count: number): this {
    return this._option('maxPointers', count);
  }
}

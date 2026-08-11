import { ContinuousGesture } from './base-gesture';
import { DEFAULT_PAN_MIN_DISTANCE } from './const';
import { type PanGestureEvent, GestureType } from './types';

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
    this._config['minDistance'] = distance;
    return this;
  }

  /**
   * activeOffset: the gesture activates once the finger moves past this
   * threshold. A number means "any direction" (symmetrical); a tuple [min, max]
   * means the offset must be within that range. Example: activeOffsetX(20)
   * activates after 20px of horizontal movement.
   */
  activeOffsetX(offset: number | [number, number]): this {
    this._config['activeOffsetX'] = offset;
    return this;
  }

  activeOffsetY(offset: number | [number, number]): this {
    this._config['activeOffsetY'] = offset;
    return this;
  }

  /**
   * failOffset: if the finger moves past this threshold in the perpendicular
   * direction, the gesture fails (ceding to a competing gesture). Example:
   * failOffsetY(10) on a horizontal pan: if the user moves >10px vertically
   * before activating, the gesture fails and a vertical scroll can take over.
   */
  failOffsetX(offset: number | [number, number]): this {
    this._config['failOffsetX'] = offset;
    return this;
  }

  failOffsetY(offset: number | [number, number]): this {
    this._config['failOffsetY'] = offset;
    return this;
  }

  minPointers(count: number): this {
    this._config['minPointers'] = count;
    return this;
  }

  maxPointers(count: number): this {
    this._config['maxPointers'] = count;
    return this;
  }
}

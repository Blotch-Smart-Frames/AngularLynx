import { ContinuousGesture } from './base-gesture';
import {
  type FlingGestureEvent,
  type FlingDirection,
  GestureType,
} from './types';

export class FlingGesture extends ContinuousGesture<
  FlingGestureEvent,
  FlingGesture
> {
  readonly type = GestureType.FLING;

  /**
   * FlingDirection is a bitmask — combine values with | for multi-direction:
   * e.g. FlingDirection.LEFT | FlingDirection.RIGHT recognizes horizontal flings.
   */
  direction(dir: FlingDirection): this {
    this._config['direction'] = dir;
    return this;
  }

  /**
   * The gesture only recognizes when exactly `count` fingers are involved.
   * Defaults to 1 if not set.
   */
  numberOfPointers(count: number): this {
    this._config['numberOfPointers'] = count;
    return this;
  }
}

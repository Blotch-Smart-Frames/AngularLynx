import { ContinuousGesture } from './base-gesture';
import { type RotationGestureEvent, GestureType } from './types';

export class RotationGesture extends ContinuousGesture<
  RotationGestureEvent,
  RotationGesture
> {
  readonly type = GestureType.ROTATION;
}

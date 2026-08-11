import { ContinuousGesture } from './base-gesture';
import { type PinchGestureEvent, GestureType } from './types';

export class PinchGesture extends ContinuousGesture<
  PinchGestureEvent,
  PinchGesture
> {
  readonly type = GestureType.PINCH;
}

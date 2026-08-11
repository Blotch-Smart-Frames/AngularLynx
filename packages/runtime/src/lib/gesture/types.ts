/**
 * Gesture type IDs matching the Lynx native engine (from @lynx-js/react gesture-runtime).
 */
export enum GestureType {
  PAN = 0,
  FLING = 1,
  DEFAULT = 2,
  TAP = 3,
  LONGPRESS = 4,
  ROTATION = 5,
  PINCH = 6,
  NATIVE = 7,
}

export enum GestureState {
  UNDETERMINED = 0,
  BEGAN = 1,
  ACTIVE = 2,
  END = 3,
  FAILED = 4,
  CANCELED = 5,
}

export type GestureEvent = {
  /**
   * Optional: the native engine conveys the phase through the callback that
   * fires (onBegin/onStart/onUpdate/onEnd), not a field on the event payload,
   * so `state` is usually absent at runtime.
   */
  state?: GestureState;
  /**
   * Absolute (page-relative) coordinates, derived at runtime by mapGestureEvent
   * from the native `pageX`/`pageY`. Optional (was required) because they're
   * only present when the gesture's payload carries coordinates — making the
   * type promise a `number` that isn't always there was a latent footgun.
   */
  absoluteX?: number;
  absoluteY?: number;
  /**
   * The untouched native params dict (Lynx field names: scrollX, pageX, x, y,
   * isAtStart, …). Escape hatch for reading fields that have no flat alias —
   * the flat properties above are derived from it. See mapGestureEvent.
   */
  params?: Record<string, unknown>;
};

export type PanGestureEvent = {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
} & GestureEvent;

export type TapGestureEvent = {
  x: number;
  y: number;
} & GestureEvent;

export type FlingGestureEvent = {
  velocityX: number;
  velocityY: number;
} & GestureEvent;

export type PinchGestureEvent = {
  scale: number;
  velocity: number;
} & GestureEvent;

export type RotationGestureEvent = {
  rotation: number;
  velocity: number;
} & GestureEvent;

export type LongPressGestureEvent = {
  x: number;
  y: number;
  duration: number;
} & GestureEvent;

/**
 * Bitmask values — combine with bitwise OR for multi-direction fling:
 * e.g. FlingDirection.LEFT | FlingDirection.RIGHT for horizontal fling.
 */
export enum FlingDirection {
  RIGHT = 1,
  LEFT = 2,
  UP = 4,
  DOWN = 8,
}

export type GestureCallback<TEvent extends GestureEvent = GestureEvent> = (
  event: TEvent,
) => void;

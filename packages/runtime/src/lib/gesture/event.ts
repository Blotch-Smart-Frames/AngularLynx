import type { GestureEvent } from './types';
import { VelocityTracker } from './velocity';

/**
 * Per-gesture motion state. Lynx reports the finger's absolute position on
 * every event but never the accumulated translation or the velocity, so the
 * directive keeps one of these per active gesture and mapGestureEvent derives
 * both from it.
 */
export type GestureOrigin = {
  /**
   * Where the touch began. `null` means "not yet anchored": the next event
   * seeds it.
   */
  x: number | null;
  y: number | null;
  /**
   * The gesture's recent positions, for its velocity.
   */
  readonly velocity: VelocityTracker;
  /**
   * How far a fling has carried, summed from its frames' `deltaX`/`deltaY`:
   * a fling's events have no position to measure its velocity from.
   */
  flungX: number;
  flungY: number;
};

export const createGestureOrigin = (): GestureOrigin => ({
  x: null,
  y: null,
  velocity: new VelocityTracker(),
  flungX: 0,
  flungY: 0,
});

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * When an event happened, in ms. Lynx's handlers stamp a touch's params with
 * its time (`eventParamsFromTouchEvent`), and Lynx's C++ moves that stamp to
 * the envelope, stamping the time it sent the event when there's none, as for
 * a fling's frames. The web preview leaves the touch's stamp in `params`.
 */
const timestampOf = (
  event: Record<string, unknown>,
  params: Record<string, unknown>,
): number =>
  numberOr(params['timestamp'], numberOr(event['timestamp'], Date.now()));

/**
 * Records where the gesture is, and returns its velocity in px/s.
 *
 * A pan's events carry the finger's position, so its velocity is how fast the
 * finger moved over the last 100 ms; at `onEnd`, that's the speed it let go at.
 * A fling's frames carry only the step since the last one, `deltaX`/`deltaY`,
 * which runs against the swipe as a scroll offset does, so the steps are
 * summed (negated) into a position, and its velocity is how fast the momentum
 * still carries, in the swipe's direction like a pan's.
 */
const trackVelocity = (
  origin: GestureOrigin,
  name: string | undefined,
  time: number,
  params: Record<string, unknown>,
  absoluteX: number | undefined,
  absoluteY: number | undefined,
): { readonly x: number; readonly y: number } => {
  if (name === 'onBegin') {
    origin.velocity.reset();
    origin.flungX = 0;
    origin.flungY = 0;
  }
  const deltaX = params['deltaX'];
  const deltaY = params['deltaY'];
  if (typeof deltaX === 'number' || typeof deltaY === 'number') {
    origin.flungX -= numberOr(deltaX, 0);
    origin.flungY -= numberOr(deltaY, 0);
    origin.velocity.add(time, origin.flungX, origin.flungY);
  } else if (absoluteX !== undefined && absoluteY !== undefined) {
    // Lynx's handlers send pageX and pageY together, from the same touch.
    origin.velocity.add(time, absoluteX, absoluteY);
  }
  const velocity = origin.velocity.velocity();
  if (name === 'onEnd') {
    origin.velocity.reset();
    origin.flungX = 0;
    origin.flungY = 0;
  }
  return velocity;
};

/**
 * Adapts a raw Lynx gesture event into AngularLynx's flat event shape.
 *
 * The native engine delivers a nested envelope —
 * `{ type, timestamp, target, currentTarget, params: {...}, detail: {...} }`
 * (built by GetCustomEventParam in core/renderer/events/touch_event_handler.cc)
 * — where the gesture data lives under `params`. The iOS handlers
 * (LynxPanGestureHandler/LynxBaseGestureHandler) populate `params` with the
 * finger's *position*: `x`/`y` (element-relative), `pageX`/`pageY` (page-
 * relative), `clientX`/`clientY`, plus `scrollX`/`scrollY` — which are the
 * gesture member's *scroll offset* (0 for a non-scrolling `<view>`), NOT the
 * drag distance. There is no native `translationX`/`translationY`.
 *
 * AngularLynx's public API is react-native-gesture-handler-style
 * (`translationX`, `absoluteX`, …), so we:
 * - map `pageX`/`pageY` → `absoluteX`/`absoluteY`,
 * - spread the raw params so every native field stays reachable by its own name
 *   (covers `x`/`y`, `scrollX`/`scrollY`, `isAtStart`/`isAtEnd`, and pinch
 *   `scale` / rotation `rotation` etc.),
 * - keep the raw `params` dict as an escape hatch,
 * - DERIVE `translationX`/`translationY` as the offset from the gesture's
 *   origin (see `origin`), since Lynx doesn't provide it. Without this, a handler
 *   reading `event.translationX` sees `0` forever (the old scrollX alias) or
 *   `undefined` → `NaN`,
 * - and DERIVE `velocityX`/`velocityY` (px/s) from the gesture's recent
 *   positions and the events' timestamps (see trackVelocity), since Lynx
 *   doesn't provide those either.
 *
 * @param raw    The native event envelope.
 * @param name   The callback name (onBegin/onStart/onUpdate/onEnd/…): `onBegin`
 *               seeds the origin where the touch began, and `onEnd` clears it.
 * @param origin Per-gesture mutable origin; omit for stateless mapping (e.g.
 *               discrete gestures like tap where translation is meaningless),
 *               which leaves out translation and velocity.
 */
export const mapGestureEvent = (
  raw: unknown,
  name?: string,
  origin?: GestureOrigin,
): GestureEvent => {
  const event = (raw ?? {}) as Record<string, unknown>;
  // Gesture data lives under `params`; fall back to the event itself so a
  // future/alternate envelope (or an already-flat test double) still works.
  const params: Record<string, unknown> =
    event['params'] && typeof event['params'] === 'object'
      ? (event['params'] as Record<string, unknown>)
      : event;

  const absoluteX = params['pageX'] as number | undefined;
  const absoluteY = params['pageY'] as number | undefined;

  const mapped = {
    ...params,
    params,
    target: event['target'],
    currentTarget: event['currentTarget'],
    absoluteX,
    absoluteY,
  } as GestureEvent & {
    translationX?: number;
    translationY?: number;
    velocityX?: number;
    velocityY?: number;
  };

  if (origin) {
    // Anchor the origin where the touch began, then report translation
    // relative to it, like react-native-gesture-handler: a pan that activates
    // after `minDistance` reports the distance moved before activating too.
    // The directive registers an `onBegin` on every continuous gesture, so
    // each touch re-anchors even when the previous one sent no `onEnd`. Any
    // other gesture anchors on its first event, and resets at `onEnd`.
    // `onTouchesDown` anchors too: Lynx sends the touch callbacks to every
    // element under the finger, so a gesture on an outer element that didn't
    // win the touch gets `onTouchesDown` and `onTouchesMove` with no `onBegin`
    // or `onEnd`, and would measure the moves (which the pan gate checks
    // against fail offsets) from an earlier touch.
    if (name === 'onBegin' || name === 'onTouchesDown' || origin.x === null) {
      origin.x = absoluteX ?? 0;
      origin.y = absoluteY ?? 0;
    }
    // origin.x/y are guaranteed numeric here: the anchor block above always
    // runs on the first event (origin.x === null) and populates both fields.
    // The `?? 0` fallbacks on absoluteX/Y are the real defense — they come
    // from the native payload and are typed as number|undefined.
    mapped.translationX = (absoluteX ?? 0) - (origin.x as number);
    mapped.translationY = (absoluteY ?? 0) - (origin.y as number);
    const velocity = trackVelocity(
      origin,
      name,
      timestampOf(event, params),
      params,
      absoluteX,
      absoluteY,
    );
    mapped.velocityX = velocity.x;
    mapped.velocityY = velocity.y;
    if (name === 'onEnd') {
      origin.x = null;
      origin.y = null;
    }
  }

  return mapped;
};

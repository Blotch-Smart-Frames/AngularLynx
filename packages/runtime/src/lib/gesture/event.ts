import type { GestureEvent } from './types';

/**
 * Per-gesture translation origin. Lynx reports the finger's absolute position on
 * every event but never the accumulated translation, so the directive keeps one
 * of these per active gesture and mapGestureEvent derives translation from it.
 * `null` means "not yet anchored" — the next event seeds it.
 */
export type GestureOrigin = { x: number | null; y: number | null };

export const createGestureOrigin = (): GestureOrigin => ({ x: null, y: null });

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
 * - and DERIVE `translationX`/`translationY` as the offset from the gesture's
 *   origin (see `origin`), since Lynx doesn't provide it. Without this, a handler
 *   reading `event.translationX` sees `0` forever (the old scrollX alias) or
 *   `undefined` → `NaN`.
 *
 * @param raw    The native event envelope.
 * @param name   The callback name (onBegin/onStart/onUpdate/onEnd/…) — used to
 *               seed the origin at gesture start and clear it at end.
 * @param origin Per-gesture mutable origin; omit for stateless mapping (e.g.
 *               discrete gestures like tap where translation is meaningless).
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
  } as GestureEvent & { translationX?: number; translationY?: number };

  if (origin) {
    // Anchor the origin at the gesture's first event (or an explicit begin/
    // start), then report translation relative to it. Reset at end so the next
    // gesture measures from its own start.
    if (name === 'onBegin' || name === 'onStart' || origin.x === null) {
      origin.x = absoluteX ?? 0;
      origin.y = absoluteY ?? 0;
    }
    mapped.translationX = (absoluteX ?? 0) - (origin.x ?? 0);
    mapped.translationY = (absoluteY ?? 0) - (origin.y ?? 0);
    if (name === 'onEnd') {
      origin.x = null;
      origin.y = null;
    }
  }

  return mapped;
};

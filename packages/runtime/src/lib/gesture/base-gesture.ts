import type { GestureStateManager } from './state-manager';
import type { GestureCallback, GestureEvent, GestureType } from './types';

let nextGestureId = 1;

export type GestureCallbackWithState<
  TEvent extends GestureEvent = GestureEvent,
> = (event: TEvent, stateManager: GestureStateManager) => void;

export abstract class BaseGesture<
  TEvent extends GestureEvent = GestureEvent,
  TSelf extends BaseGesture<TEvent, any> = any,
> {
  readonly id = nextGestureId++;
  abstract readonly type: GestureType;

  /**
   * @internal — accessed by the directive to build the PAPI config.
   * GestureCallback<any> avoids an invariance error when assigning concrete gesture
   * subclasses (e.g. PanGesture) to BaseGesture<GestureEvent, any>. The directive
   * already casts callbacks to any when invoking them, so the wider type is safe.
   */
  _callbacks: Record<string, GestureCallback<any>> = {};
  /**
   * @internal
   *
   * Starts as `{ enabled: true }`, like React Lynx's gesture-runtime, so every
   * gesture sends a config, even one with no options of its own (Fling, Pinch,
   * Rotation). Gestures whose native handler reads options seed the rest of
   * their defaults too: once a config is present, iOS reads each key it leaves
   * out as `0` (see ./const).
   */
  _config: Record<string, unknown> = { enabled: true };
  /**
   * @internal
   */
  _waitFor: BaseGesture[] = [];
  /**
   * @internal
   */
  _simultaneousWith: BaseGesture[] = [];
  /**
   * @internal
   */
  _continueWith: BaseGesture[] = [];
  /**
   * @internal
   *
   * One function per `[lynxGesture]` the gesture is bound to, which registers
   * it with Lynx again. Lynx reads a gesture's options only when it's
   * registered, so an option set after binding (`enabled(false)` from a
   * handler, say) re-registers it. See `_option`.
   */
  readonly _bindings = new Set<() => void>();

  /**
   * Fires when the gesture starts tracking a touch, before it's recognized:
   * at touch-down for most gestures, and when the finger lifts for a fling.
   *
   * A continuous gesture doesn't need one for its `onStart` and `onEnd` to
   * fire. LynxGestureDetector registers an empty `onBegin` when you don't, since
   * Lynx's native handlers skip those callbacks without it. See
   * gesture-detector.ts.
   */
  onBegin(cb: GestureCallbackWithState<TEvent>): TSelf {
    this._callbacks['onBegin'] = cb as GestureCallback<TEvent>;
    return this as unknown as TSelf;
  }

  /**
   * Fires when the gesture is RECOGNIZED (transitions to active). For a tap this
   * is the only callback that fires exclusively on success — see `onEnd`.
   */
  onStart(cb: GestureCallbackWithState<TEvent>): TSelf {
    this._callbacks['onStart'] = cb as GestureCallback<TEvent>;
    return this as unknown as TSelf;
  }

  /**
   * Fires when the gesture ends.
   *
   * For discrete gestures (tap, long-press) LynxGestureDetector normalizes this
   * to fire ONLY when the gesture was actually recognized. Lynx's native engine
   * emits `onEnd` on failure too — the iOS `fail` path calls it — so a drag that
   * overshoots a tap's `maxDistance` would otherwise still trigger `onEnd`. The
   * directive suppresses that failed-gesture `onEnd`; continuous gestures pass
   * through unchanged. See gesture-detector.ts.
   */
  onEnd(cb: GestureCallbackWithState<TEvent>): TSelf {
    this._callbacks['onEnd'] = cb as GestureCallback<TEvent>;
    return this as unknown as TSelf;
  }

  onTouchesDown(cb: GestureCallbackWithState<TEvent>): TSelf {
    this._callbacks['onTouchesDown'] = cb as GestureCallback<TEvent>;
    return this as unknown as TSelf;
  }

  onTouchesUp(cb: GestureCallbackWithState<TEvent>): TSelf {
    this._callbacks['onTouchesUp'] = cb as GestureCallback<TEvent>;
    return this as unknown as TSelf;
  }

  /**
   * Delays this gesture until all listed gestures have failed.
   * Use to give higher-priority gestures (e.g. double-tap) first right of refusal.
   * `as unknown as TSelf` is needed because TypeScript can't prove that `this`
   * satisfies the concrete TSelf bound — the double cast is intentional.
   */
  waitFor(...gestures: BaseGesture[]): TSelf {
    this._waitFor.push(...gestures);
    return this as unknown as TSelf;
  }

  /**
   * Allows this gesture and the listed gestures to be active at the same time.
   * Without this, Lynx's gesture system lets only one gesture be active per element.
   */
  simultaneousWith(...gestures: BaseGesture[]): TSelf {
    this._simultaneousWith.push(...gestures);
    return this as unknown as TSelf;
  }

  /**
   * This gesture activates after the listed gestures END (not fail).
   * Useful for chaining: e.g. a long-press followed by a drag.
   */
  continueWith(...gestures: BaseGesture[]): TSelf {
    this._continueWith.push(...gestures);
    return this as unknown as TSelf;
  }

  /**
   * Turns the gesture off (`false`) and on again. A disabled gesture runs no
   * callbacks and doesn't take touches from other gestures, as if it weren't
   * bound. It can be called at any time, a callback included.
   *
   * Lynx's native handlers don't read `enabled` (as of Lynx 4.1), so
   * `[lynxGesture]` doesn't register a disabled gesture with Lynx at all, and
   * registers it again once it's enabled.
   */
  enabled(value: boolean): TSelf {
    return this._option('enabled', value) as unknown as TSelf;
  }

  /**
   * @internal
   *
   * Sets one of the gesture's options, and re-registers the gesture wherever
   * it's bound so that Lynx, and the runtime's own checks (./callback-gate.ts),
   * see the change.
   */
  _option(key: string, value: unknown): this {
    this._config[key] = value;
    for (const rebind of this._bindings) rebind();
    return this;
  }
}

/**
 * Continuous gestures (pan, fling, rotation, pinch) have an onUpdate callback
 * that fires on every frame while the gesture is active.
 */
export abstract class ContinuousGesture<
  TEvent extends GestureEvent = GestureEvent,
  TSelf extends ContinuousGesture<TEvent, any> = any,
> extends BaseGesture<TEvent, TSelf> {
  onUpdate(cb: GestureCallbackWithState<TEvent>): TSelf {
    this._callbacks['onUpdate'] = cb as GestureCallback<TEvent>;
    return this as unknown as TSelf;
  }
}

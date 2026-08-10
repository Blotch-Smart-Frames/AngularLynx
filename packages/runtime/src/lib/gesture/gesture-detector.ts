import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';
import type { BaseGesture } from './base-gesture';
import { ComposedGesture } from './composition';
import {
  type GestureOrigin,
  createGestureOrigin,
  mapGestureEvent,
} from './event';
import { GestureStateManager } from './state-manager';
import { GestureType } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGesture = BaseGesture<any, any>;
type GestureInput = AnyGesture | AnyGesture[] | ComposedGesture;

/**
 * Directive that bridges Angular's gesture binding to Lynx's native gesture
 * system (__SetGestureDetector / __RemoveGestureDetector). Accepts a single
 * gesture, an array of gestures, or a ComposedGesture (simultaneous/exclusive).
 * Each gesture is registered with the native engine via its unique numeric ID.
 *
 * Cross-package prerequisite (easy to miss when debugging): the native engine
 * silently ignores every __SetGestureDetector call unless the compiled page
 * config has `enableNewGesture: true`. @blotch/rsbuild-plugin-angular-lynx
 * defaults that flag ON, so this directive works out of the box — but if
 * gestures ever go dead app-wide with no error, that build flag is the first
 * thing to check, not this directive.
 */
@Directive({
  selector: '[lynxGesture]',
  inputs: ['lynxGesture'],
})
export class LynxGestureDetector implements OnChanges, OnDestroy {
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;
  #attachedIds: number[] = [];

  lynxGesture!: GestureInput;

  /**
   * Full teardown + re-register on every input change. This is safe because
   * gesture IDs are stable (assigned once in BaseGesture constructor), so
   * inter-gesture relationships (waitFor, simultaneousWith) stay valid.
   */
  ngOnChanges(_changes: SimpleChanges): void {
    this.#detachAll();
    const gestures = this.#resolveGestures();
    if (gestures.length === 0) return;

    // On the background thread the element is a virtual node with no native
    // handle (.element is undefined); native gesture registration only happens
    // on the main thread, so there's nothing to do here otherwise.
    const elementRef = (this.#el as any).element;
    if (!elementRef) return;

    // Force the element onto its own native layer. Lynx "flattens" a view that
    // has no event listeners and no non-flatten attributes into its parent's
    // layer for performance, and a flattened view cannot receive its own
    // gestures. Unlike adding a DOM event listener, registering a gesture
    // detector does NOT auto-mark the element non-flatten, so we set it
    // explicitly — mirroring React Lynx's processGesture. `flatten` is an
    // Android-only concept (a no-op on iOS), but it's required for gestures to
    // fire on Android.
    __SetAttribute(elementRef, 'flatten', false);

    for (const g of gestures) {
      // GestureStateManager allows callbacks to programmatically fail/activate
      // the gesture (e.g. to implement conditional gesture recognition).
      const stateManager = new GestureStateManager(elementRef, g.id);
      // Per-gesture translation origin, shared across this gesture's callbacks
      // so mapGestureEvent can derive translationX/Y from the finger's absolute
      // position (Lynx reports position each event, never accumulated distance).
      const origin = createGestureOrigin();
      const config = {
        callbacks: buildGestureCallbacks(g, origin, stateManager),
        config: Object.keys(g._config).length > 0 ? g._config : undefined,
      };
      // Relationship map tells the native gesture system how gestures interact:
      // - waitFor: this gesture waits for the dependency to fail before recognizing
      // - simultaneous: both gestures can be active at the same time
      // - continueWith: this gesture activates after the dependency ends
      const relationMap: Record<string, number[]> = {
        waitFor: g._waitFor.map((dep) => dep.id),
        simultaneous: g._simultaneousWith.map((dep) => dep.id),
        continueWith: g._continueWith.map((dep) => dep.id),
      };

      __SetGestureDetector(elementRef, g.id, g.type, config, relationMap);
      this.#attachedIds.push(g.id);
    }
  }

  ngOnDestroy(): void {
    this.#detachAll();
  }

  #detachAll(): void {
    const elementRef = (this.#el as any).element;
    if (!elementRef) return;
    for (const id of this.#attachedIds) {
      try {
        __RemoveGestureDetector(elementRef, id);
      } catch {
        // Element may already be destroyed by the native engine.
      }
    }
    this.#attachedIds = [];
  }

  #resolveGestures(): AnyGesture[] {
    if (!this.lynxGesture) return [];
    if (this.lynxGesture instanceof ComposedGesture) {
      return this.lynxGesture.gestures;
    }
    if (Array.isArray(this.lynxGesture)) {
      return this.lynxGesture;
    }
    return [this.lynxGesture];
  }
}

/**
 * Native gesture callback entry expected by __SetGestureDetector. The callback
 * MUST be an OBJECT (`{ _fn }`), not a raw function: under Lynx's fiber
 * architecture the native binding routes a callable into
 * GestureCallback.lepus_function_, but fiber-arch gesture dispatch only reads
 * lepus_object_ (populated when the callback is an object), so a raw function is
 * silently dropped and the gesture never fires. runtime.ts's runWorklet unwraps
 * `_fn`.
 */
type NativeCallbackEntry = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: { _fn: (event: any) => void };
};

/**
 * Builds the native callback list for one gesture, wrapping each user callback
 * as `{ _fn }` and injecting the mapped event plus the stateManager (its second
 * argument, so callbacks can programmatically fail/activate the gesture).
 *
 * Discrete gestures (tap, long-press) get a normalization pass. Lynx's native
 * engine fires `onEnd` on BOTH success and failure — the iOS `fail` path emits
 * it — whereas `onStart` fires only on recognition. To give React-Native-
 * Gesture-Handler-style semantics (where `onEnd` means "the gesture actually
 * happened"), we observe `onStart` — registering our own observer when the user
 * didn't — to learn whether the gesture was recognized, then drop the
 * failed-gesture `onEnd`. Continuous gestures pass through untouched.
 */
const buildGestureCallbacks = (
  gesture: AnyGesture,
  origin: GestureOrigin,
  stateManager: GestureStateManager,
): NativeCallbackEntry[] => {
  const wrap = (
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cb: any,
  ): NativeCallbackEntry => ({
    name,
    callback: {
      _fn: (event: any) =>
        cb(mapGestureEvent(event, name, origin), stateManager),
    },
  });

  const userEnd = gesture._callbacks['onEnd'];
  const isDiscrete =
    gesture.type === GestureType.TAP || gesture.type === GestureType.LONGPRESS;

  // Only a discrete gesture with an onEnd handler needs success/failure
  // disambiguation; everything else is a straight passthrough.
  if (!isDiscrete || !userEnd) {
    return Object.entries(gesture._callbacks).map(([name, cb]) =>
      wrap(name, cb),
    );
  }

  const userStart = gesture._callbacks['onStart'];
  // Per-registration recognition flag: `started` flips true only when the native
  // engine reports the gesture became active (onStart). A failed tap never does.
  const lifecycle = { started: false };
  const callbacks: NativeCallbackEntry[] = [
    {
      name: 'onStart',
      callback: {
        _fn: (event: any) => {
          lifecycle.started = true;
          // Forward only if the user registered onStart — this entry exists
          // primarily as our recognition observer.
          if (userStart) {
            (userStart as (event: unknown, sm: GestureStateManager) => void)(
              mapGestureEvent(event, 'onStart', origin),
              stateManager,
            );
          }
        },
      },
    },
    {
      name: 'onEnd',
      callback: {
        _fn: (event: any) => {
          const recognized = lifecycle.started;
          lifecycle.started = false;
          // Drop the native onEnd that fires when the tap/long-press failed.
          if (recognized) {
            (userEnd as (event: unknown, sm: GestureStateManager) => void)(
              mapGestureEvent(event, 'onEnd', origin),
              stateManager,
            );
          }
        },
      },
    },
  ];

  // Pass through every other callback (onBegin, onTouchesDown/Up, …) as-is; only
  // onStart (forced observer) and onEnd (suppressed on failure) are special.
  for (const [name, cb] of Object.entries(gesture._callbacks)) {
    if (name === 'onStart' || name === 'onEnd') continue;
    callbacks.push(wrap(name, cb));
  }

  return callbacks;
};

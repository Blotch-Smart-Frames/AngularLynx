import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';
import type { ElementRef as NativeElementRef } from '../types/lynx';
import {
  type BaseGesture,
  type GestureCallbackWithState,
  ContinuousGesture,
} from './base-gesture';
import { createCallbackGate } from './callback-gate';
import { ComposedGesture } from './composition';
import { removeGestureDetector, setGestureDetector } from './gesture-papi';
import {
  type GestureOrigin,
  createGestureOrigin,
  mapGestureEvent,
} from './event';
import { GestureStateManager } from './state-manager';
import type { GestureEvent } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGesture = BaseGesture<any, any>;
type GestureInput = AnyGesture | AnyGesture[] | ComposedGesture;

/**
 * Directive that bridges Angular's gesture binding to Lynx's native gesture
 * system (__SetGestureDetector / __RemoveGestureDetector, or on Lynx for Web,
 * which has none, the runtime's port of it: see gesture-papi.ts). Accepts a single
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
  /**
   * Unbinds each bound gesture: stops following its options, and removes it
   * from Lynx.
   */
  #unbinds: (() => void)[] = [];

  lynxGesture!: GestureInput;

  constructor() {
    // Force the element onto its own native layer. Lynx "flattens" a view that
    // has no event listeners and no non-flatten attributes into its parent's
    // layer for performance, and a flattened view cannot receive its own
    // gestures. Unlike adding a DOM event listener, registering a gesture
    // detector does NOT auto-mark the element non-flatten, so we set it
    // explicitly — mirroring React Lynx's processGesture. `flatten` is an
    // Android-only concept (a no-op on iOS), but it's required for gestures to
    // fire on Android.
    //
    // It's set here, when the element is created, rather than when a gesture
    // is bound: Android decides whether an element gets a View of its own when
    // it first draws it, and turning flatten off afterwards doesn't give it one.
    // ngOnChanges came too late for a routed component's elements and for a
    // gesture bound after the first render (`[lynxGesture]="on ? pan : []"`),
    // and those gestures never fired on Android (issue #56).
    const elementRef = (this.#el as any).element;
    if (elementRef) __SetAttribute(elementRef, 'flatten', false);
  }

  /**
   * Full teardown + re-register on every input change. This is safe because
   * gesture IDs are stable (assigned once in BaseGesture constructor), so
   * inter-gesture relationships (waitFor, simultaneousWith) stay valid.
   */
  ngOnChanges(_changes: SimpleChanges): void {
    this.#unbindAll();
    const gestures = this.#resolveGestures();
    if (gestures.length === 0) return;

    // An element with no native handle (.element is undefined), such as the
    // renderer's in-memory test double, has nothing to register a gesture on.
    const elementRef = (this.#el as any).element;
    if (!elementRef) return;

    for (const g of gestures) this.#bind(g, elementRef);
  }

  ngOnDestroy(): void {
    this.#unbindAll();
  }

  /**
   * Registers a gesture with Lynx, and again whenever one of its options
   * changes (BaseGesture's `_option`): Lynx reads a gesture's options only when
   * it's registered, and the runtime builds the checks for the options Lynx
   * doesn't read from them then too (./callback-gate.ts).
   *
   * A disabled gesture isn't registered. Lynx's handlers don't read `enabled`
   * (as of Lynx 4.1), and a registered gesture competes for every touch: even
   * if its callbacks were skipped, a disabled pan would activate on the first
   * move and fail its element's other gestures, or keep a scroll view from
   * scrolling. Unregistered, it can't. Any relation to it (`waitFor`,
   * `simultaneousWith`) then names a gesture Lynx doesn't have, which Lynx
   * passes over, as if it had failed.
   */
  #bind(gesture: AnyGesture, elementRef: NativeElementRef): void {
    let registered = false;
    const register = (): void => {
      if (registered) {
        detach(elementRef, gesture.id);
        registered = false;
      }
      if (gesture._config['enabled'] === false) return;
      // GestureStateManager allows callbacks to programmatically fail/activate
      // the gesture (e.g. to implement conditional gesture recognition).
      const stateManager = new GestureStateManager(elementRef, gesture.id);
      // Per-gesture translation origin, shared across this gesture's callbacks
      // so mapGestureEvent can derive translationX/Y from the finger's absolute
      // position (Lynx reports position each event, never accumulated distance).
      const origin = createGestureOrigin();
      const config = {
        callbacks: buildGestureCallbacks(gesture, origin, stateManager),
        config: gesture._config,
      };
      // Relationship map tells the native gesture system how gestures interact:
      // - waitFor: this gesture waits for the dependency to fail before recognizing
      // - simultaneous: both gestures can be active at the same time
      // - continueWith: this gesture activates after the dependency ends
      const relationMap: Record<string, number[]> = {
        waitFor: gesture._waitFor.map((dep) => dep.id),
        simultaneous: gesture._simultaneousWith.map((dep) => dep.id),
        continueWith: gesture._continueWith.map((dep) => dep.id),
      };
      setGestureDetector(
        elementRef,
        gesture.id,
        gesture.type,
        config,
        relationMap,
      );
      registered = true;
    };
    register();
    gesture._bindings.add(register);
    this.#unbinds.push(() => {
      gesture._bindings.delete(register);
      if (registered) detach(elementRef, gesture.id);
    });
  }

  #unbindAll(): void {
    for (const unbind of this.#unbinds) unbind();
    this.#unbinds = [];
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

const detach = (elementRef: NativeElementRef, id: number): void => {
  try {
    removeGestureDetector(elementRef, id);
  } catch {
    // Element may already be destroyed by the native engine.
  }
};

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
 * Builds the native callback list for one gesture, wrapping each callback as
 * `{ _fn }`. Each one maps Lynx's event (mapGestureEvent), then asks the
 * gesture's gate (./callback-gate.ts) which of the user's callbacks to run with
 * it, and runs them with the stateManager as their second argument, so they
 * can fail or end the gesture.
 *
 * The gate enforces the options Lynx doesn't read, and makes a tap's or long
 * press's `onEnd` mean it was recognized (Lynx also sends it on failure). It
 * may need callbacks the user didn't register, such as a pan's `onUpdate` to
 * see how far it has moved, so those are registered too, and Lynx's events
 * for them are mapped and routed like the rest.
 *
 * Continuous gestures (pan, fling, pinch, rotation) always get an `onBegin`.
 * Lynx's native fling handler, and its pan handler before Lynx 3.9, fire
 * `onStart` and `onEnd` only after `onBegin` has fired, and fire `onBegin`
 * only when one is registered (LynxFlingGestureHandler.m /
 * FlingGestureHandler.java), so without it those two callbacks never ran,
 * with no error. Running it also anchors the gesture's translation where the
 * touch began (see mapGestureEvent).
 *
 * A callback of a disabled gesture runs nothing. The gesture is unregistered
 * as soon as it's disabled, but Lynx may already have sent events for it from
 * its own thread.
 */
const buildGestureCallbacks = (
  gesture: AnyGesture,
  origin: GestureOrigin,
  stateManager: GestureStateManager,
): NativeCallbackEntry[] => {
  const gate = createCallbackGate(gesture);
  const names = new Set([...Object.keys(gesture._callbacks), ...gate.observes]);
  if (gesture instanceof ContinuousGesture) names.add('onBegin');
  return [...names].map((name) => ({
    name,
    callback: {
      _fn: (raw: unknown) => {
        const event = mapGestureEvent(raw, name, origin);
        if (gesture._config['enabled'] === false) return;
        for (const [target, routed] of gate.route(name, event, stateManager)) {
          (
            gesture._callbacks[target] as
              | GestureCallbackWithState<GestureEvent>
              | undefined
          )?.(routed, stateManager);
        }
      },
    },
  }));
};

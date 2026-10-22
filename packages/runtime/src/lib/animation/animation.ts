import type {
  Animation as LynxJsAnimation,
  AnimationOptions,
} from '@lynx-js/types/main-thread';

import type { ElementRef } from '../types/lynx';

/**
 * Extends the official AnimationOptions with Lynx-native property aliases
 * and relaxed types that accept string values (e.g. "300ms").
 */
export type LynxAnimationOptions = AnimationOptions & {
  iterationCount?: number | string;
  fillMode?: string;
  timingFunction?: string;
};

/**
 * The public API of an animation, which `BaseLynxElement.animate()` returns.
 * LynxAnimation uses ES private fields (#element, #count), which brand the
 * class, so a structural type lets other implementations, such as a test
 * double, satisfy it.
 */
export type BaseLynxAnimation = Pick<
  LynxJsAnimation,
  'id' | 'cancel' | 'pause' | 'play'
>;

/**
 * Wire-protocol constants for __ElementAnimate operations.
 * Must match the native Lynx engine expectations (see PAPI types).
 */
const ANIMATION_START = 0 as const;
const ANIMATION_PLAY = 1 as const;
const ANIMATION_PAUSE = 2 as const;
const ANIMATION_CANCEL = 3 as const;

/**
 * Represents a running animation on a Lynx element.
 * Created by calling `element.animate()` on a LynxElement.
 * Mirrors the Animation class from React Lynx's worklet-runtime, except for
 * the key a named animation is controlled by (see the constructor).
 */
export class LynxAnimation implements Pick<
  LynxJsAnimation,
  'id' | 'cancel' | 'pause' | 'play'
> {
  static #count = 0;

  readonly id: string;
  readonly #element: ElementRef;
  // The string __ElementAnimate knows this animation by (see the constructor).
  readonly #key: string;
  // The DOM Animation web-core started, on web only (see the constructor).
  readonly #webAnimation?: Animation;

  constructor(
    element: ElementRef,
    keyframes: Record<string, string | number>[],
    options: LynxAnimationOptions,
  ) {
    this.#element = element;
    this.id = `__lynx-angular-animation-${LynxAnimation.#count++}`;
    // __ElementAnimate finds an animation by the string after the operation,
    // and native Lynx and web-core need different strings for a named one
    // (issue #57):
    // - Native starts it under `options.name`, which its animation events
    //   report, and PLAY/PAUSE write their string into the element's
    //   `animation-name`. So play() and pause() have to pass the name: given
    //   the generated id they left a named animation running on iOS and
    //   Android. React Lynx always passes the id, so its named animations
    //   can't be paused either.
    // - web-core ignores `options.name` and keys one map, shared by every
    //   element on the page, by that string. Starting an animation cancels
    //   whatever is already under its key, so two elements animating under
    //   the same name would cancel each other. The unique id avoids that.
    this.#key = __WEB__ ? this.id : (options.name ?? this.id);

    // Normalize Web Animation API property names to CSS animation property
    // names that @lynx-js/web-core's __ElementAnimate expects.
    // Native Lynx accepts both, but web-core only maps the CSS variants
    // (iterationCount, timingFunction, fillMode).
    const wireOptions: Record<string, unknown> = { ...options };
    if (options.iterations != null && !('iterationCount' in options)) {
      wireOptions['iterationCount'] =
        options.iterations === Infinity ? 'infinite' : options.iterations;
    }
    if (options.easing != null && !('timingFunction' in options)) {
      wireOptions['timingFunction'] = options.easing;
    }
    if (options.fill != null && !('fillMode' in options)) {
      wireOptions['fillMode'] = options.fill;
    }

    // Immediately start the animation on the native element.
    __ElementAnimate(this.#element, [
      ANIMATION_START,
      this.#key,
      keyframes,
      wireOptions,
    ]);

    // web-core's __ElementAnimate forgets an animation the moment it finishes
    // (its `onfinish` drops it from the map it looks names up in), so a later
    // ANIMATION_CANCEL finds nothing and does nothing. On native, cancel still
    // clears a finished animation. The difference shows with fill:'forwards':
    // on web the final frame then pins the property for good, and every
    // inline style set on it afterwards is hidden (a bottom sheet's drag
    // transform, for one). On web the element is a real DOM element and
    // web-core starts the animation with element.animate(), so keep that
    // Animation and cancel it directly. getAnimations() lists an element's
    // script animations in the order they were created, so the last one is
    // the animation just started.
    if (__WEB__) {
      this.#webAnimation = (
        this.#element as unknown as Partial<Pick<Element, 'getAnimations'>>
      )
        .getAnimations?.()
        .at(-1);
    }
  }

  play(): void {
    __ElementAnimate(this.#element, [ANIMATION_PLAY, this.#key]);
  }

  pause(): void {
    __ElementAnimate(this.#element, [ANIMATION_PAUSE, this.#key]);
  }

  cancel(): void {
    __ElementAnimate(this.#element, [ANIMATION_CANCEL, this.#key]);
    // Reaches the animation even after it finished (see the constructor).
    // Canceling an animation web-core already canceled is a no-op.
    this.#webAnimation?.cancel();
  }
}

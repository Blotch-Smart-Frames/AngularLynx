// Re-exports `@lynx-js/types/main-thread` under a stable `MainThread` namespace.
// Users write `MainThread.TouchEvent` instead of importing from the internal
// package path directly — insulating them from package renames and tree-shaking
// on the individual type imports.
import type {
  BaseAnimationEvent,
  BaseKeyEvent,
  BaseMouseEvent,
  BaseTouchEvent,
  BaseTransitionEvent,
  BaseWheelEvent,
  LayoutChangeDetailEvent,
  UIAppearanceDetailEvent,
} from '@lynx-js/types/events';
import type { Element as MtElement } from '@lynx-js/types/main-thread';

export namespace MainThread {
  /**
   * An element's layout box, from `getBoundingClientRect()`, in pixels.
   */
  export type BoundingClientRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };

  /**
   * Lynx's main-thread element, plus the `getBoundingClientRect()` that
   * AngularLynx's MainThreadElement adds. The events below are Lynx's, built on
   * this element type, so `event.currentTarget.getBoundingClientRect()` type
   * checks without a cast.
   */
  export type Element = MtElement & {
    getBoundingClientRect(options?: {
      relativeTo?: string;
    }): Promise<BoundingClientRect>;
  };
  export type TouchEvent = BaseTouchEvent<Element>;
  export type MouseEvent = BaseMouseEvent<Element>;
  export type WheelEvent = BaseWheelEvent<Element>;
  export type KeyEvent = BaseKeyEvent<Element>;
  export type AnimationEvent = BaseAnimationEvent<Element>;
  export type TransitionEvent = BaseTransitionEvent<Element>;
  export type LayoutChangeEvent = LayoutChangeDetailEvent<Element>;
  export type UIAppearanceEvent = UIAppearanceDetailEvent<Element>;
}

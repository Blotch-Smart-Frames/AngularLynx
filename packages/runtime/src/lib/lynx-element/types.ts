export type LynxEventType =
  | 'bindEvent'
  | 'catchEvent'
  | 'capture-bindEvent'
  | 'capture-catchEvent'
  | 'global-bindEvent';

export const EVENT_PREFIXES: [string, LynxEventType][] = [
  ['capture-bind', 'capture-bindEvent'],
  ['capture-catch', 'capture-catchEvent'],
  ['global-bind', 'global-bindEvent'],
  ['catch', 'catchEvent'],
  ['bind', 'bindEvent'],
];

/**
 * DOM event names whose Lynx event has another name. A listener for one of
 * them hears the Lynx event, bubbling, as if it were bound with `bind`: a
 * `(click)` listener runs on a tap. This is the mapping Lynx for Web makes
 * between the two (web-core's `W3cEventNameToLynx` turns a DOM `click` into
 * `tap`), and it's what lets Angular's own directives that listen for
 * `click`, such as `RouterLink`, work on Lynx elements.
 */
export const DOM_EVENT_ALIASES: ReadonlyMap<string, string> = new Map([
  ['click', 'tap'],
  // The return key on a text field, where a browser sends a key event for
  // Enter: `<input (keyup.enter)="search()">` runs when the keyboard's return
  // key is pressed. iOS and Android send no other key events.
  ['keydown.enter', 'confirm'],
  ['keyup.enter', 'confirm'],
]);

/**
 * DOM event names Lynx sends under the same name, for the same thing: an
 * `<input>`'s `input`, `focus` and `blur`, an `<image>`'s `load` and `error`,
 * a `<scroll-view>`'s `scroll`, a touch, or the end of a CSS animation or
 * transition. A listener for one, with no `bind` or `catch` prefix, hears it
 * as `bind` does, so `(input)` works as `(bindinput)` does.
 *
 * Other DOM names, such as `mouseover` or `keydown`, stay ignored. iOS and
 * Android never send them, but the web preview would, so listening for them
 * would make the preview do what the app on a phone doesn't.
 */
export const SAME_NAME_DOM_EVENTS: ReadonlySet<string> = new Set([
  'input',
  'focus',
  'blur',
  'load',
  'error',
  'scroll',
  'scrollend',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'animationstart',
  'animationend',
  'animationiteration',
  'animationcancel',
  'transitionstart',
  'transitionend',
  'transitioncancel',
]);

import type { Element as LynxJsElement } from '@lynx-js/types/main-thread';

/**
 * Uses BaseLynxAnimation (not LynxAnimation), the animation's public API,
 * because LynxAnimation's ES private fields brand the class.
 */
import type {
  BaseLynxAnimation,
  LynxAnimationOptions,
} from '../animation/animation';

/**
 * The `nativeElement` of a Lynx element's `ElementRef`: AngularLynx's
 * wrapper around the native element, not a DOM element. Type an
 * `ElementRef` with it to call its methods, such as `animate()`, `invoke()`
 * or `setAccessibilityTrait()`.
 *
 * @usageNotes
 * ```ts
 * readonly option = viewChild.required<ElementRef<BaseLynxElement>>('option');
 * ```
 */
export type BaseLynxElement = Pick<LynxJsElement, 'setAttribute'> & {
  tagName: string;
  setProperty(name: string, value: any): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setStyle(key: string, value: unknown): void;
  removeStyle(key: string): void;
  setInlineStyles(inlineStyle: string): void;
  insertBefore(
    newChild: BaseLynxElement,
    refChild: BaseLynxElement | null,
  ): void;
  appendChild(newChild: BaseLynxElement): void;
  addClass(name: string): void;
  /**
   * Adds a class that stays when the whole class list is replaced, for
   * ViewEncapsulation.Emulated's scope classes (see EmulatedLynxRenderer).
   */
  addScopeClass(name: string): void;
  removeClass(name: string): void;
  /**
   * Adds a trait to the element's own `accessibility-traits`, or takes it
   * away, keeping the traits the app sets. For state that changes, such as
   * `selected` on an active router link (see LynxRouterLinkActive). In a
   * template, LynxAccessibilityTraits does it from a binding.
   */
  setAccessibilityTrait(trait: string, on: boolean): void;
  remove(): void;
  parentNode(): BaseLynxElement | null;
  nextSibling(): BaseLynxElement | null;
  querySelector(selector: string): BaseLynxElement | null;
  querySelectorAll(selector: string): BaseLynxElement[];
  addEventListener(name: string, cb: (event: any) => any): () => void;
  animate(
    keyframes: Record<string, string | number>[],
    options?: number | LynxAnimationOptions,
  ): BaseLynxAnimation;
  /**
   * Invokes a native UI method on this element (e.g. setValue, scrollTo).
   * LynxElement implements it via __InvokeUIMethod.
   */
  invoke(methodName: string, params?: Record<string, unknown>): void;
};

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
   * away, keeping the traits the app sets. For state the runtime tracks, such
   * as `selected` on an active router link (see LynxRouterLinkActive).
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

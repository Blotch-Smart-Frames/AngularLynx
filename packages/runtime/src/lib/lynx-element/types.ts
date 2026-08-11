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

import type { Element as LynxJsElement } from '@lynx-js/types/main-thread';

/**
 * Uses BaseLynxAnimation (not LynxAnimation) so both the real main-thread
 * implementation and the background-thread NoopLynxAnimation satisfy this
 * interface without requiring inheritance or unsafe casts.
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
  removeClass(name: string): void;
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
   *
   * Marked optional because it only exists on the main thread: LynxElement
   * implements it via __InvokeUIMethod, while LynxBackgroundElement (used in
   * tests and the background-thread context) does not — UIMethod calls have no
   * meaning outside the native render thread. Callers should use invoke?.() so
   * they become no-ops in test/background environments rather than crashing.
   */
  invoke?(methodName: string, params?: Record<string, unknown>): void;
};

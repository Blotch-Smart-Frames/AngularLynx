import type { ElementRef } from '../types/lynx';
import {
  LynxAnimation,
  type LynxAnimationOptions,
} from '../animation/animation';
import type { MainThread } from './types';
import { writePendingClasses } from '../lynx-element/class-writes';
import { withSafeAreaInsets } from '../lynx-element/safe-area-insets';
import { writeScriptStyles } from '../lynx-element/script-styles';
import { noteScriptFieldText } from '../lynx-element/script-field-text';

/**
 * Batched flush — coalesces multiple style/attribute mutations into a single
 * native render pass, matching React Lynx's Element.flushElementTree() behavior.
 * Without batching, each setAttribute/setStyleProperty would trigger a separate
 * layout pass. With batching, a handler that sets 5 properties produces 1 flush
 * (on the next microtask) instead of 5, preventing visible frame drops.
 */
let willFlush = false;

const scheduleFlush = (): void => {
  if (willFlush) return;
  willFlush = true;
  // Microtask ensures the flush runs after all synchronous mutations in the
  // current event handler are applied, but before the next frame renders.
  Promise.resolve().then(() => {
    willFlush = false;
    __FlushElementTree();
  });
};

/**
 * Wraps a native ElementRef (elementRefptr) with the @lynx-js/types
 * MainThread.Element API surface. Created by runWorklet's param transformation
 * so that main-thread event handlers can call setStyleProperty(), setAttribute(),
 * etc. on event.currentTarget.
 */
export class MainThreadElement {
  readonly #element: ElementRef;

  constructor(element: ElementRef) {
    this.#element = element;
  }

  setAttribute(name: string, value: unknown): void {
    __SetAttribute(this.#element, name, value);
    scheduleFlush();
  }

  getAttribute(name: string): unknown {
    // Lynx for Web, and the testing library's DOM, read `class` among the
    // attributes: give native the classes change detection is holding back
    // (see class-writes.ts).
    writePendingClasses();
    return __GetAttributeByName(this.#element, name);
  }

  getAttributeNames(): string[] {
    writePendingClasses();
    return __GetAttributeNames(this.#element);
  }

  /**
   * Sets one inline style. On an element Angular made, it goes through the
   * element's LynxElement, as a `[style.x]` binding does (see
   * script-styles.ts): so a CSS variable change detection set on the element
   * still reaches the text under it, and the style is kept when the element's
   * whole inline style is written again. That also lets a script set a CSS
   * variable (`--x`), which `__AddInlineStyle` drops, and an empty value
   * removes the style, as the DOM's `style.setProperty()` does.
   *
   * An env(safe-area-inset-*) in the value gets the inset a generated app's
   * shell sends, as in a template's inline style (see safe-area-insets.ts),
   * and on an element Angular made, the new one when the insets change.
   */
  setStyleProperty(name: string, value: string): void {
    this.setStyleProperties({ [name]: value });
  }

  /**
   * Sets several inline styles, as setStyleProperty does each.
   */
  setStyleProperties(styles: Record<string, string>): void {
    // An element no LynxElement drives (one a script or the shell made) has
    // nothing else writing its inline style: native gets the styles straight.
    if (!writeScriptStyles(this.#element, styles)) {
      for (const key in styles) {
        __AddInlineStyle(this.#element, key, withSafeAreaInsets(styles[key]!));
      }
    }
    scheduleFlush();
  }

  querySelector(selector: string): MainThreadElement | null {
    // A class selector matches the classes native has (see getAttribute).
    writePendingClasses();
    const ref = __QuerySelector(this.#element, selector, {});
    return ref ? new MainThreadElement(ref) : null;
  }

  querySelectorAll(selector: string): MainThreadElement[] {
    writePendingClasses();
    return __QuerySelectorAll(this.#element, selector, {}).map(
      (el) => new MainThreadElement(el),
    );
  }

  /**
   * Invokes a native UI method on this element (e.g. scrollTo, autoPlay).
   * __InvokeUIMethod is asynchronous — the result arrives in the callback.
   * scheduleFlush() must be called AFTER __InvokeUIMethod so the method
   * invocation is included in the next native render pass.
   */
  invoke(
    methodName: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    // The field's text, which its LynxElement keeps track of (see
    // script-field-text.ts).
    if (methodName === 'setValue') {
      noteScriptFieldText(this.#element, String(params?.['value'] ?? ''));
    }
    return new Promise((resolve, reject) => {
      __InvokeUIMethod(
        this.#element,
        methodName,
        params ?? {},
        (res: { code: number; data: unknown }) => {
          if (res.code === 0) {
            resolve(res.data);
          } else {
            reject(new Error('UI method invoke: ' + JSON.stringify(res)));
          }
        },
      );
      scheduleFlush();
    });
  }

  animate(
    keyframes: Record<string, number | string>[],
    options?: number | LynxAnimationOptions,
  ): LynxAnimation {
    const normalizedOptions =
      typeof options === 'number' ? { duration: options } : (options ?? {});
    return new LynxAnimation(this.#element, keyframes, normalizedOptions);
  }

  /**
   * Measures the element's layout box, by default from the top-left corner of
   * the LynxView. `relativeTo` takes 'screen', or another element's `id`.
   *
   * Not part of the official @lynx-js/types Element interface, but useful for
   * touch tracking. Unlike the DOM's, it's asynchronous: native Lynx gives a
   * main-thread script the layout position only through the
   * `boundingClientRect` UI method. The computed `left` and `top` styles are
   * CSS offsets, often 0, not where the element is.
   */
  getBoundingClientRect(options?: {
    relativeTo?: string;
  }): Promise<MainThread.BoundingClientRect> {
    return this.invoke('boundingClientRect', options).then((rect) => {
      // The UI method also returns the element's id and dataset.
      const { left, top, right, bottom, width, height } =
        rect as MainThread.BoundingClientRect;
      return { left, top, right, bottom, width, height };
    });
  }
}

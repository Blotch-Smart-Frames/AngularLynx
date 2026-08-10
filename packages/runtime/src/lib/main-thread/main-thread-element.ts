import type { ElementRef } from '../types/lynx';
import {
  LynxAnimation,
  type LynxAnimationOptions,
} from '../animation/animation';

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
    return __GetAttributeByName(this.#element, name);
  }

  getAttributeNames(): string[] {
    return __GetAttributeNames(this.#element);
  }

  setStyleProperty(name: string, value: string): void {
    __AddInlineStyle(this.#element, name, value);
    scheduleFlush();
  }

  setStyleProperties(styles: Record<string, string>): void {
    for (const key in styles) {
      __AddInlineStyle(this.#element, key, styles[key]!);
    }
    scheduleFlush();
  }

  querySelector(selector: string): MainThreadElement | null {
    const ref = __QuerySelector(this.#element, selector, {});
    return ref ? new MainThreadElement(ref) : null;
  }

  querySelectorAll(selector: string): MainThreadElement[] {
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
   * Not part of the official @lynx-js/types Element interface, but useful for
   * touch-tracking calculations. Uses __GetComputedStyleByKey when available.
   */
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } {
    if (typeof __GetComputedStyleByKey !== 'function') {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    const width =
      parseFloat(__GetComputedStyleByKey(this.#element, 'width')) || 0;
    const height =
      parseFloat(__GetComputedStyleByKey(this.#element, 'height')) || 0;
    const left =
      parseFloat(__GetComputedStyleByKey(this.#element, 'left')) || 0;
    const top = parseFloat(__GetComputedStyleByKey(this.#element, 'top')) || 0;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }
}

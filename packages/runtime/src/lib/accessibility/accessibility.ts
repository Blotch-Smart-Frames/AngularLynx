import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import { MainThreadElement } from '../main-thread/main-thread-element';

/**
 * Programmatic accessibility control for screen readers on Lynx.
 *
 * Provides two imperative APIs that complement the declarative accessibility
 * attributes (`accessibility-element`, `accessibility-label`, etc.) already
 * available on Lynx element directives.
 *
 * @usageNotes
 * ```typescript
 * const a11y = inject(LynxAccessibility);
 *
 * // Announce a state change to screen readers
 * await a11y.announce('Item added to cart');
 *
 * // Move accessibility focus to a specific element
 * await a11y.requestFocus('#confirmation-message');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxAccessibility {
  /**
   * Makes screen readers announce the specified text content.
   *
   * Use this to notify visually impaired users of state changes or
   * operation results that aren't reflected by focus movement alone
   * (e.g. toast messages, background task completion, live counters).
   *
   * Wraps `lynx.accessibilityAnnounce()`. Only the background thread's `lynx`
   * has it, and event handlers run on the main thread, so the call goes
   * through the background thread (see background-call.ts).
   */
  announce(content: string): Promise<void> {
    return callOnBackground('accessibilityAnnounce', content);
  }

  /**
   * Programmatically moves accessibility focus (screen reader cursor)
   * to the element matching the given selector.
   *
   * The target element should have `accessibility-element="true"` set.
   * Only ID selectors are reliably supported (e.g. `'#myElement'`).
   *
   * Wraps `lynx.createSelectorQuery().select(selector).invoke({ method: 'requestAccessibilityFocus' }).exec()`.
   * The main thread's `lynx` has no createSelectorQuery, but it's where event
   * handlers run and where the native elements live, so there the element is
   * found and called directly.
   */
  requestFocus(selector: string): Promise<void> {
    if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) {
      const element = new MainThreadElement(__GetPageElement()).querySelector(
        selector,
      );
      if (!element) {
        return Promise.reject(
          new Error(
            `requestAccessibilityFocus: no element matches ${selector}`,
          ),
        );
      }
      return element.invoke('requestAccessibilityFocus').then(() => undefined);
    }

    if (typeof lynx === 'undefined' || !lynx.createSelectorQuery) {
      return Promise.reject(
        new Error(
          'lynx.createSelectorQuery is not available in this environment',
        ),
      );
    }

    return new Promise<void>((resolve, reject) => {
      lynx
        .createSelectorQuery()
        .select(selector)
        .invoke({
          method: 'requestAccessibilityFocus',
          params: {},
          success: () => resolve(),
          fail: (res) =>
            reject(
              new Error(
                `requestAccessibilityFocus failed (code ${res.code})${res.data ? ': ' + JSON.stringify(res.data) : ''}`,
              ),
            ),
        })
        .exec();
    });
  }
}

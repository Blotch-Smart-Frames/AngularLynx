import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';

/**
 * @Directive() is required so that ng-packagr's Angular partial compiler
 * recognizes this base class as an Angular artifact. The selector is left
 * empty — the class is never used directly as a directive.
 *
 * DESIGN NOTES — why these are directives, not components:
 *
 * 1. No @Component: Components have their own template (<ng-content/>). When a
 *    component wraps content, Angular treats that content as "projected" — the
 *    native parent is not yet established while Angular initializes projected
 *    nodes. Any directive inside the projected content that injects
 *    ViewContainerRef (e.g. RouterOutlet) will crash because insertAnchorNode
 *    calls renderer.insertBefore(null, anchor) — null being the not-yet-resolved
 *    native parent. Using @Directive avoids projection entirely; children are
 *    rendered as direct element children just like without LYNX_ELEMENTS.
 *
 * 2. Properties are declared as inputs so that Angular's template checker
 *    accepts property bindings like [src]="url" without errors. Angular
 *    intercepts these bindings and sets them on the directive instance. The
 *    ngOnChanges hook forwards every input change to the native Lynx element
 *    via BaseLynxElement.setAttribute(), which calls __SetAttribute — the same
 *    endpoint that renderer.setProperty() would reach.
 *
 * 3. Events (bindtap, catchtap, bindinput, bindscroll, …) are NOT declared as
 *    @Output() because Angular would intercept them and skip the renderer's
 *    listen() call, breaking native Lynx event delivery. They continue to work
 *    via renderer.listen() which handles all unrecognized event names.
 */
@Directive({
  inputs: [
    'id',
    'name',
    'accessibility-element',
    'accessibility-label',
    'accessibility-trait',
    'accessibility-elements',
    'accessibility-elements-hidden',
    'accessibility-exclusive-focus',
    'a11y-id',
    'user-interaction-enabled',
    'native-interaction-enabled',
    'event-through',
    'hit-slop',
    'block-native-event',
    'ignore-focus',
    'ios-enable-simultaneous-touch',
    'exposure-id',
    'exposure-scene',
    'exposure-area',
    'exposure-screen-margin-top',
    'exposure-screen-margin-bottom',
    'exposure-screen-margin-left',
    'exposure-screen-margin-right',
    'exposure-ui-margin-top',
    'exposure-ui-margin-bottom',
    'exposure-ui-margin-left',
    'exposure-ui-margin-right',
  ],
})
export class LynxElementBase implements OnChanges {
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;

  ngOnChanges(changes: SimpleChanges): void {
    for (const name of Object.keys(changes)) {
      const value = changes[name].currentValue;
      if (value != null) {
        this.#el.setAttribute(name, value);
      } else {
        this.#el.removeAttribute(name);
      }
    }
  }
  // ---- Identity ----------------------------------------------------------
  id?: string;
  /**
   * Named reference accessible via lynx.getElementById / findViewByName.
   */
  name?: string;

  // ---- Accessibility -----------------------------------------------------
  /**
   * Whether this element is an accessibility node.
   */
  'accessibility-element'?: boolean;
  /**
   * Text read aloud by screen readers.
   */
  'accessibility-label'?: string;
  'accessibility-trait'?: 'none' | 'button' | 'image' | 'text';
  /**
   * Comma-separated list of child element names that are accessibility nodes.
   */
  'accessibility-elements'?: string;
  'accessibility-elements-hidden'?: boolean;
  /**
   * Whether this element exclusively captures accessibility focus.
   */
  'accessibility-exclusive-focus'?: boolean;
  /**
   * Accessibility identifier (separate from name).
   */
  'a11y-id'?: string;

  // ---- Interaction -------------------------------------------------------
  /**
   * Whether the element receives touch events (default: true).
   */
  'user-interaction-enabled'?: boolean;
  /**
   * Whether the element receives platform-native gestures.
   */
  'native-interaction-enabled'?: boolean;
  /**
   * Whether touch events pass through to elements below.
   */
  'event-through'?: boolean;
  /**
   * Extends the touch target area. Object or CSS-shorthand string.
   */
  'hit-slop'?: string | object;
  /**
   * Whether the element consumes native iOS/Android gestures.
   */
  'block-native-event'?: boolean;
  /**
   * Whether focus events are suppressed.
   */
  'ignore-focus'?: boolean;
  /**
   * Allow simultaneous touch recognition (iOS).
   */
  'ios-enable-simultaneous-touch'?: boolean;

  // ---- Exposure tracking -------------------------------------------------
  /**
   * Unique ID used for impression/exposure analytics.
   */
  'exposure-id'?: string;
  /**
   * Scene identifier grouping exposure events.
   */
  'exposure-scene'?: string;
  /**
   * Percentage of the element that must be visible (0–100) to trigger exposure.
   */
  'exposure-area'?: number;
  /**
   * Extends/shrinks the viewport detection zone (top edge, in px).
   */
  'exposure-screen-margin-top'?: number | string;
  /**
   * Extends/shrinks the viewport detection zone (bottom edge, in px).
   */
  'exposure-screen-margin-bottom'?: number | string;
  /**
   * Extends/shrinks the viewport detection zone (left edge, in px).
   */
  'exposure-screen-margin-left'?: number | string;
  /**
   * Extends/shrinks the viewport detection zone (right edge, in px).
   */
  'exposure-screen-margin-right'?: number | string;
  /**
   * Adjusts the element's own bounding rect for exposure detection (top, in px).
   */
  'exposure-ui-margin-top'?: number | string;
  /**
   * Adjusts the element's own bounding rect for exposure detection (bottom, in px).
   */
  'exposure-ui-margin-bottom'?: number | string;
  /**
   * Adjusts the element's own bounding rect for exposure detection (left, in px).
   */
  'exposure-ui-margin-left'?: number | string;
  /**
   * Adjusts the element's own bounding rect for exposure detection (right, in px).
   */
  'exposure-ui-margin-right'?: number | string;
}

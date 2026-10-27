import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';

/**
 * A length Lynx's exposure detection parses, such as `'20px'` or `'-10rpx'`.
 * Lynx reads the margins as strings, so a bare number has no effect.
 */
export type ExposureMargin = `${number}px` | `${number}rpx`;

/**
 * One trait of `accessibility-traits`, each of which iOS turns into a
 * UIAccessibilityTraits flag (`LynxConverter+UI.m`).
 */
type AccessibilityTrait =
  | 'text'
  | 'image'
  | 'button'
  | 'link'
  | 'header'
  | 'search'
  | 'selected'
  | 'playable'
  | 'keyboard'
  | 'summary'
  | 'disabled'
  | 'updating'
  | 'adjustable'
  | 'tabbar'
  | 'none';

/**
 * Lets a true/false input also be written as a static attribute, as Lynx's
 * guides and ours do: `flatten="false"`, or a bare `ignore-focus` for true.
 * Angular type-checks a static attribute's string against the input, so
 * without this `<text flatten="false">` stops compiling once `flatten` is an
 * input. Unlike Angular's `booleanAttribute`, `undefined` stays `undefined`,
 * so a binding can still remove the attribute and restore Lynx's default.
 */
// oxlint-disable-next-line func-style, @blotch/no-function-declaration -- Angular's compiler takes a named input transform only as a function declaration (NG1010)
function booleanInput(
  value: boolean | '' | 'true' | 'false' | undefined,
): boolean | undefined {
  return typeof value === 'string' ? value !== 'false' : value;
}

/**
 * Lets `pan-intercept-direction` also be written as a static attribute,
 * `pan-intercept-direction="1"`, and hands Lynx a number either way.
 */
// oxlint-disable-next-line func-style, @blotch/no-function-declaration -- Angular's compiler takes a named input transform only as a function declaration (NG1010)
function panInterceptDirectionInput(
  value: 0 | 1 | '0' | '1' | undefined,
): 0 | 1 | undefined {
  return typeof value === 'string' ? (Number(value) as 0 | 1) : value;
}

/**
 * Lets `pan-intercept-scope` also be written as a static attribute,
 * `pan-intercept-scope="5"`, and hands Lynx a number either way.
 */
// oxlint-disable-next-line func-style, @blotch/no-function-declaration -- Angular's compiler takes a named input transform only as a function declaration (NG1010)
function panInterceptScopeInput(
  value: 0 | 1 | 2 | 3 | 4 | 5 | '0' | '1' | '2' | '3' | '4' | '5' | undefined,
): 0 | 1 | 2 | 3 | 4 | 5 | undefined {
  return typeof value === 'string'
    ? (Number(value) as 0 | 1 | 2 | 3 | 4 | 5)
    : value;
}

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
    { name: 'accessibility-element', transform: booleanInput },
    'accessibility-label',
    // The current value a screen reader reads after the label (a slider's
    // position, a chart's focused point), and custom actions it offers
    // (string[]; the chosen one arrives as the accessibility action event's detail.name).
    'accessibility-value',
    'accessibility-actions',
    'accessibility-traits',
    'accessibility-elements',
    { name: 'accessibility-elements-hidden', transform: booleanInput },
    { name: 'accessibility-exclusive-focus', transform: booleanInput },
    'a11y-id',
    { name: 'user-interaction-enabled', transform: booleanInput },
    { name: 'native-interaction-enabled', transform: booleanInput },
    { name: 'event-through', transform: booleanInput },
    'hit-slop',
    { name: 'block-native-event', transform: booleanInput },
    { name: 'ignore-focus', transform: booleanInput },
    { name: 'ios-enable-simultaneous-touch', transform: booleanInput },
    { name: 'flatten', transform: booleanInput },
    { name: 'pan-intercept-direction', transform: panInterceptDirectionInput },
    { name: 'pan-intercept-scope', transform: panInterceptScopeInput },
    'consume-slide-event',
    { name: 'enable-touch-pseudo-propagation', transform: booleanInput },
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
    { name: 'enable-exposure-ui-margin', transform: booleanInput },
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
  /**
   * The kind of element a screen reader announces. Plural, as Lynx reads it:
   * iOS, Android and Harmony ignore `accessibility-trait`. iOS also reads a
   * comma-separated list with no spaces, such as `button,selected`, which
   * is what LynxRouterLinkActive writes; Android and Harmony read a single
   * trait. @default 'none'
   */
  'accessibility-traits'?:
    | AccessibilityTrait
    | `${AccessibilityTrait},${string}`;
  /**
   * Comma-separated `id`s of the child elements a screen reader visits, in
   * order. iOS and Android look each one up as an `id` selector.
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
  /**
   * Lets Lynx draw the element into its parent's native view instead of
   * creating its own (Android). `false` gives it its own view, which sticky
   * positioning, text selection and reliable clipping need. @default true
   */
  flatten?: boolean;
  /**
   * Direction in which the element takes pan gestures from native views
   * outside Lynx: 0 = horizontal, 1 = vertical.
   */
  'pan-intercept-direction'?: 0 | 1;
  /**
   * Which views `pan-intercept-direction` takes pans from: 0 = self,
   * 1 = ancestors, 2 = descendants, 3 = self and ancestors, 4 = self and
   * descendants, 5 = all.
   */
  'pan-intercept-scope'?: 0 | 1 | 2 | 3 | 4 | 5;
  /**
   * Swipe angle ranges, `[start, end]` in degrees, that the element keeps
   * from platform gestures.
   */
  'consume-slide-event'?: [number, number][];
  /**
   * Whether `:active` also applies to the ancestors on the touch's event path.
   */
  'enable-touch-pseudo-propagation'?: boolean;

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
   * How much of the element must be visible to count as exposed, as a
   * percentage string such as `'50%'`. @default '0%'
   */
  'exposure-area'?: `${number}%`;
  /**
   * Extends/shrinks the viewport detection zone (top edge).
   */
  'exposure-screen-margin-top'?: ExposureMargin;
  /**
   * Extends/shrinks the viewport detection zone (bottom edge).
   */
  'exposure-screen-margin-bottom'?: ExposureMargin;
  /**
   * Extends/shrinks the viewport detection zone (left edge).
   */
  'exposure-screen-margin-left'?: ExposureMargin;
  /**
   * Extends/shrinks the viewport detection zone (right edge).
   */
  'exposure-screen-margin-right'?: ExposureMargin;
  /**
   * Adjusts the element's own bounding rect for exposure detection (top).
   * iOS and Android apply it only with `enable-exposure-ui-margin`.
   */
  'exposure-ui-margin-top'?: ExposureMargin;
  /**
   * Adjusts the element's own bounding rect for exposure detection (bottom).
   * iOS and Android apply it only with `enable-exposure-ui-margin`.
   */
  'exposure-ui-margin-bottom'?: ExposureMargin;
  /**
   * Adjusts the element's own bounding rect for exposure detection (left).
   * iOS and Android apply it only with `enable-exposure-ui-margin`.
   */
  'exposure-ui-margin-left'?: ExposureMargin;
  /**
   * Adjusts the element's own bounding rect for exposure detection (right).
   * iOS and Android apply it only with `enable-exposure-ui-margin`.
   */
  'exposure-ui-margin-right'?: ExposureMargin;
  /**
   * Turns on `exposure-ui-margin-*` on iOS and Android (always on for Harmony
   * and the web). It also changes how they apply `exposure-screen-margin-*`.
   * @default false
   */
  'enable-exposure-ui-margin'?: boolean;
}

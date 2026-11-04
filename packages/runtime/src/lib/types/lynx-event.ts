import type {
  AnimationEvent,
  MouseEvent,
  TouchEvent,
  TransitionEvent,
} from '@lynx-js/types';

/**
 * The element an event started on (`target`), or the one whose handler is
 * running (`currentTarget`). Lynx sends plain data, not the element, so it
 * has no methods. To call an element method, use a template reference.
 */
export type LynxEventTarget = {
  /** The element's `id` attribute. */
  readonly id: string;
  /** Lynx's internal number for the element. */
  readonly uid: number;
  /**
   * The element's `data-*` attributes, keyed without the `data-` prefix.
   * Values aren't always strings: a property binding such as
   * `[data-item]="item"` keeps its value as it is.
   */
  readonly dataset: Readonly<Record<string, unknown>>;
};

/**
 * The object a Lynx element event hands its handler, as `$event`. Every
 * element event has this shape; `Detail` is the event's own data, such as
 * `ImageLoadDetail` for an `<image>`'s `bindload`.
 *
 * Angular types `$event` from the element and the event, so a template
 * handler needs no annotation. Write the type out for a handler declared
 * apart from the template:
 *
 * ```ts
 * template: `<image [src]="url" (bindload)="loaded($event)" />`,
 *
 * protected loaded({ detail }: LynxEvent<ImageLoadDetail>): void {
 *   this.#size.set(detail);
 * }
 * ```
 *
 * It isn't a DOM `Event`: Lynx's event has none of the DOM's other fields
 * (`timeStamp`, `bubbles`, `composedPath()`…), so they don't type-check.
 * Tap, long-press and touch events are Lynx's `TouchEvent`, which has this
 * shape plus `touches` and `changedTouches`.
 */
export type LynxEvent<Detail = unknown> = {
  /** The event's name without its prefix, such as `'load'` for `bindload`. */
  readonly type: string;
  /** When the event fired, in milliseconds. */
  readonly timestamp: number;
  /** The element the event started on. */
  readonly target: LynxEventTarget;
  /** The element whose handler is running. */
  readonly currentTarget: LynxEventTarget;
  /** The event's own data. */
  readonly detail: Detail;
  /**
   * Does nothing to native events: the `catch` prefix (`catchtap`) stops an
   * event. AngularLynx adds it where Lynx doesn't, so web-style code runs.
   */
  stopPropagation(): void;
  /**
   * There's no default action to prevent. AngularLynx adds it where Lynx
   * doesn't, as Angular calls it when a handler returns `false`.
   */
  preventDefault(): void;
};

/** `bindlayoutchange`'s detail: the element's new size and position. */
export type LayoutChangeDetail = {
  /** The element's `id` attribute. */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Positions are relative to the Lynx view, in px. */
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  /** The element's `data-*` attributes (see `LynxEventTarget.dataset`). */
  readonly dataset: Readonly<Record<string, unknown>>;
};

/**
 * `binduiappear` and `binduidisappear`'s detail: which element came on or
 * went off the screen.
 */
export type UIAppearanceDetail = {
  readonly 'exposure-id': string;
  readonly 'exposure-scene': string;
  /**
   * Identifies the native element. iOS and Android send a string; the web
   * sends the element's numeric unique ID.
   */
  readonly 'unique-id': string | number;
  /** The element's `data-*` attributes (see `LynxEventTarget.dataset`). */
  readonly dataset: Readonly<Record<string, unknown>>;
};

/**
 * `bindaccessibilityaction`'s detail: the custom action, from the element's
 * `accessibility-actions`, that a screen reader user picked.
 */
export type AccessibilityActionDetail = {
  readonly name: string;
};

/**
 * Names each event, keyed by its `bind` name as the docs write it, under
 * every prefix Lynx binds it with, all of which hand the handler the same
 * event: `bind` lets it bubble, `catch` stops it, the `capture-` forms run on
 * the way down, and `global-bind` runs for the event on any element. Only
 * touch events bubble, so for the others `catch` and the `capture-` forms
 * change nothing. `{ bindtap: E }` gives `bindtap`, `catchtap`…
 */
export type WithPrefixes<Events> = {
  [Name in keyof Events & string as Name extends `bind${infer Event}`
    ?
        | `bind${Event}`
        | `catch${Event}`
        | `capture-bind${Event}`
        | `capture-catch${Event}`
        | `global-bind${Event}`
    : never]: Events[Name];
};

/**
 * The events every element fires, with the type of each one's `$event`. The
 * events only some elements fire are in element-events.ts.
 */
export type LynxCommonEventMap = WithPrefixes<{
  bindtap: TouchEvent;
  bindlongpress: TouchEvent;
  bindtouchstart: TouchEvent;
  bindtouchmove: TouchEvent;
  bindtouchend: TouchEvent;
  bindtouchcancel: TouchEvent;
  // Lynx's mouse events, which a mouse fires on web and Lynx PC instead of
  // touch events. Lynx delivers its own MouseEvent object, not the DOM's:
  // it has the cursor's coordinates, which a drag handler reads.
  bindmousedown: MouseEvent;
  bindmouseup: MouseEvent;
  bindmousemove: MouseEvent;
  bindmouseenter: MouseEvent;
  bindmouseleave: MouseEvent;
  bindlayoutchange: LynxEvent<LayoutChangeDetail>;
  binduiappear: LynxEvent<UIAppearanceDetail>;
  binduidisappear: LynxEvent<UIAppearanceDetail>;
  // The animation's name is in `$event.params.animation_name`.
  bindanimationstart: AnimationEvent;
  bindanimationiteration: AnimationEvent;
  bindanimationend: AnimationEvent;
  bindanimationcancel: AnimationEvent;
  bindtransitionstart: TransitionEvent;
  bindtransitionend: TransitionEvent;
  bindtransitioncancel: TransitionEvent;
  bindaccessibilityaction: LynxEvent<AccessibilityActionDetail>;
}>;

declare global {
  /**
   * Angular types `$event` on an element's event from the element's
   * `addEventListener`: its type-check code calls
   * `document.createElement(tag).addEventListener(event, handler)`. An
   * element with no type of its own is an `HTMLElement`, which looks the
   * event up here, so these entries type the events every element fires.
   * Without them `$event` is a DOM `Event`, with no `detail`.
   */
  // oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for global augmentation
  interface HTMLElementEventMap extends LynxCommonEventMap {}
}

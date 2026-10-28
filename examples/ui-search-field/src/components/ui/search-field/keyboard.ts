import { type Injector, type Renderer2 } from '@angular/core';
import { LynxSystemInfo, MainThreadElement } from '@blotch/angular-lynx';

/**
 * How far above the keyboard a field that rises clear of it sits, in px: the
 * gap the dock keeps from the home indicator.
 */
export const KEYBOARD_GAP = 8;

/** What a field's `<input>` sends with its `keyboardheightchange` event. */
export type KeyboardHeightEvent = { detail: { height: number } };

/** The platform, as far as the keyboard's geometry needs it. */
export type KeyboardScreen = {
  readonly platform: string;
  readonly pixelRatio: number;
  /** The screen's height in px. */
  readonly screenHeight: number;
};

/**
 * The platform from LynxSystemInfo, or null where there's no SystemInfo to
 * read: LynxSystemInfo throws in unit tests without one. Looked up when the
 * keyboard shows, which is when it's needed.
 */
export const keyboardScreen = (injector: Injector): KeyboardScreen | null => {
  try {
    return injector.get(LynxSystemInfo);
  } catch {
    return null;
  }
};

/** A box on screen, as far as the keyboard's geometry needs it, in px. */
export type KeyboardRect = { readonly bottom: number };

/**
 * The keyboard's height in px, from an `<input>`'s `keyboardheightchange`
 * event, which arrives on the main thread while the input is focused: as the
 * keyboard shows, when it changes size (the emoji keyboard, the predictive
 * bar), and with 0 as it hides.
 *
 * Lynx measures it differently on each platform. iOS sends points, measured
 * up from the bottom of the window. Android sends physical pixels, measured
 * up from the bottom of the Lynx view: an app whose window shrinks above the
 * keyboard, as the Android app `ng build --platform android` makes does,
 * gets 0 once it has.
 */
export const keyboardHeightOf = (
  event: KeyboardHeightEvent,
  screen: KeyboardScreen,
): number =>
  screen.platform === 'Android'
    ? event.detail.height / screen.pixelRatio
    : event.detail.height;

/**
 * How far an element has to rise for its bottom edge to clear the keyboard
 * by `gap`, in px: 0 when the keyboard doesn't reach it. `element` and
 * `page` are their boxes on screen, `page` the Lynx page's, whose bottom is
 * the Lynx view's: iOS measures the keyboard from the window's bottom edge,
 * and Android from the Lynx view's (see keyboardHeightOf()).
 */
export const keyboardLift = (
  element: KeyboardRect,
  page: KeyboardRect,
  keyboard: number,
  screen: KeyboardScreen,
  gap: number,
): number => {
  if (keyboard <= 0) return 0;
  const keyboardTop =
    screen.platform === 'iOS'
      ? screen.screenHeight - keyboard
      : page.bottom - keyboard;
  return Math.max(0, Math.round(element.bottom + gap - keyboardTop));
};

/** AngularLynx's wrapper of a Lynx element, around the element itself. */
type LynxElementRef = { readonly element: unknown; readonly tagName?: string };

/**
 * An element's box on screen, or null where it can't be measured (the web
 * preview measures from the `<lynx-view>`, which has no keyboard to clear).
 * Lynx gives a script an element's position only through its
 * `boundingClientRect` UI method, which answers later.
 */
const measureOnScreen = async (
  element: LynxElementRef,
): Promise<KeyboardRect | null> => {
  try {
    return await new MainThreadElement(
      element.element as ConstructorParameters<typeof MainThreadElement>[0],
    ).getBoundingClientRect({ relativeTo: 'screen' });
  } catch {
    return null;
  }
};

/**
 * Measures `element` and the page it's in, the `<page>` above it, for
 * keyboardLift(). Null when either can't be measured.
 */
export const measureForKeyboard = async (
  renderer: Renderer2,
  element: LynxElementRef,
): Promise<{ element: KeyboardRect; page: KeyboardRect } | null> => {
  let page = element;
  for (
    let parent = renderer.parentNode(page) as LynxElementRef | null;
    parent && page.tagName !== 'page';
    parent = renderer.parentNode(parent) as LynxElementRef | null
  ) {
    page = parent;
  }
  const [elementRect, pageRect] = await Promise.all([
    measureOnScreen(element),
    measureOnScreen(page),
  ]);
  return elementRect && pageRect
    ? { element: elementRect, page: pageRect }
    : null;
};

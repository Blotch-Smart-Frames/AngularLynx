import { installEventClasses } from './event';
import {
  dispatchThrough,
  type EventListenerLike,
  type ListenerOptionsLike,
} from './event-target';
import { type GlobalEvents, screenViewport } from './global-events';

/**
 * The window's half of global-events.ts, on `globalThis`, which is the
 * window on Lynx's main thread: the polyfills make `window` point to it, and
 * the document's `defaultView` is it.
 *
 * On iOS and Android it has no `addEventListener` of its own (only the
 * polyfills' no-op), so all its listeners are the hub's. Where it's a
 * browser's window, which it is in the web preview (a hidden iframe's) and
 * in jsdom tests, the hub takes the screen's events (SCREEN_EVENTS) and the
 * window keeps the others, such as `message`.
 *
 * `innerWidth` and `innerHeight` are the LynxView's size (see
 * GlobalEvents.viewport): before the first layout reports it, the screen's,
 * from SystemInfo. jsdom keeps its own.
 */

/** The events of the screen, which the hub's window hears. */
export const SCREEN_EVENTS: ReadonlySet<string> = new Set([
  'pointerover',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerout',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'keydown',
  'keyup',
  'keypress',
  'resize',
]);

/** Marks a global whose window events are the hub's, so it's done once. */
const INSTALLED = Symbol.for('@blotch/angular-lynx/global-window');

/**
 * Whether `target` is a browser's window, with a DOM document.
 */
const isBrowserWindow = (target: Record<string, any>): boolean =>
  typeof target['document']?.nodeType === 'number';

/**
 * Makes `events.window` the window's listeners on `target` (`globalThis`),
 * and its `innerWidth` and `innerHeight` the LynxView's.
 */
export const installGlobalWindow = (
  target: Record<string | symbol, any>,
  events: GlobalEvents,
): void => {
  if (target[INSTALLED]) return;
  target[INSTALLED] = true;
  installEventClasses(target);
  const own = events.window;
  const browser = isBrowserWindow(target);
  // jsdom 30's selector engine adds listeners of its own to the window the
  // first time its document runs a selector: click, mouse and key events,
  // to follow :hover and :focus. Under Vitest 5 they go through the methods
  // set below, so once a test had queried the DOM (TestBed does, as it
  // makes each component), the hub's window kept a click listener nobody
  // removes: the page heard every tap, and an event the page never reached
  // stayed pending and ran the next test's document: and window: listeners
  // early. Running a selector first leaves those listeners with jsdom. A
  // browser, the web preview's included, has no such engine; the query
  // costs it nothing.
  if (browser) target['document'].querySelector?.(':root');
  const original = {
    add: target['addEventListener'],
    remove: target['removeEventListener'],
    dispatch: target['dispatchEvent'],
  };
  const ours = (type: string) => !browser || SCREEN_EVENTS.has(type);
  target['addEventListener'] = (
    type: string,
    listener: EventListenerLike | null,
    options?: ListenerOptionsLike,
  ): void => {
    if (ours(type)) own.addEventListener(type, listener, options);
    else original.add.call(target, type, listener, options);
  };
  target['removeEventListener'] = (
    type: string,
    listener: EventListenerLike | null,
    options?: ListenerOptionsLike,
  ): void => {
    if (ours(type)) own.removeEventListener(type, listener, options);
    else original.remove.call(target, type, listener, options);
  };
  target['dispatchEvent'] = (event: any): boolean =>
    ours(event.type)
      ? dispatchThrough(event, target, [own])
      : original.dispatch.call(target, event);

  // jsdom's window has a size of its own (1024 by 768), which tests rely
  // on; the web preview's main thread is a hidden iframe's, which has none.
  if (browser && !__WEB__) return;
  for (const [name, axis] of [
    ['innerWidth', 'width'],
    ['innerHeight', 'height'],
  ] as const) {
    Object.defineProperty(target, name, {
      get: () => (events.viewport ?? screenViewport())[axis],
      configurable: true,
      enumerable: true,
    });
  }
};

/**
 * Makes `events.document` the `document` global where there isn't a DOM
 * one: on iOS and Android, where the polyfills give it a placeholder. In
 * the web preview and in jsdom tests, `document` stays the browser's, and
 * only `ownerDocument` and `DOCUMENT` are the hub's.
 */
export const installGlobalDocument = (
  target: Record<string, any>,
  events: GlobalEvents,
): void => {
  if (typeof target['document']?.nodeType === 'number') return;
  target['document'] = events.document;
};

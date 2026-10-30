/**
 * fireEvent — dispatches Lynx events through the dual-thread pipeline.
 *
 * Lynx events are registered via __AddEvent with a key of "<type>:<name>"
 * (e.g. "bindEvent:tap"). The event handler stored on the element calls
 * lynxCoreInject.tt.publishEvent(handlerSign, eventData) which routes the
 * event to the background thread (not used by AngularLynx, which runs on
 * the main thread).
 *
 * For AngularLynx, the (event) bindings in templates are wired by
 * LynxRenderer.listen() which calls __AddEvent internally. The named helpers
 * (fireEvent.tap, …) run those handlers on the main thread along the path
 * Lynx sends the event (see deliver()).
 */

import {
  createEvent,
  fireEvent as domFireEvent,
  getConfig,
} from '@testing-library/dom';

const EVENT_INIT_KEYS = new Set(['bubbles', 'cancelable', 'composed']);

/**
 * The events the named helpers fire. Those with `bubbles: true` travel Lynx's
 * event response chain, from the element up to the page, so a tap on a row
 * inside a pressable card reaches the card's handler. The rest reach only
 * the element they happened on, as Lynx sends an element's own events
 * (scroll, input, layout, …).
 *
 * The touch events bubble on every platform, as React Lynx's testing library
 * has them. Mouse, wheel and key events bubble too, where Lynx sends them:
 * its desktop engine dispatches them with TouchEventHandler::HandleBubbleEvent
 * (all but mouseenter and mouseleave) and Lynx for Web with the DOM event's
 * own bubbling. iOS and Android don't send them.
 */
export const eventMap = {
  // Touch / gesture
  tap: { defaultInit: { bubbles: true } },
  longtap: { defaultInit: { bubbles: true } },
  touchstart: { defaultInit: { bubbles: true } },
  touchmove: { defaultInit: { bubbles: true } },
  touchcancel: { defaultInit: { bubbles: true } },
  touchend: { defaultInit: { bubbles: true } },
  longpress: { defaultInit: { bubbles: true } },
  // Keyboard
  keydown: { defaultInit: { bubbles: true } },
  keyup: { defaultInit: { bubbles: true } },
  // Mouse
  mousedown: { defaultInit: { bubbles: true } },
  mouseup: { defaultInit: { bubbles: true } },
  mousemove: { defaultInit: { bubbles: true } },
  mouseclick: { defaultInit: { bubbles: true } },
  mousedblclick: { defaultInit: { bubbles: true } },
  mouselongpress: { defaultInit: { bubbles: true } },
  wheel: { defaultInit: { bubbles: true } },
  // Scroll / viewport
  scroll: { defaultInit: {} },
  scrollend: { defaultInit: {} },
  scrolltoupper: { defaultInit: {} },
  scrolltolower: { defaultInit: {} },
  contentsizechanged: { defaultInit: {} },
  scrolltoupperedge: { defaultInit: {} },
  scrolltoloweredge: { defaultInit: {} },
  scrolltonormalstate: { defaultInit: {} },
  // Form / focus
  focus: { defaultInit: {} },
  blur: { defaultInit: {} },
  input: { defaultInit: {} },
  confirm: { defaultInit: {} },
  // Layout / image
  layoutchange: { defaultInit: {} },
  bgload: { defaultInit: {} },
  bgerror: { defaultInit: {} },
  // Transition / animation
  transitionstart: { defaultInit: {} },
  transitionend: { defaultInit: {} },
  transitioncancel: { defaultInit: {} },
  animationend: { defaultInit: {} },
};

type EventName = keyof typeof eventMap;
type EventHandler = (elem: Element, init?: Record<string, unknown>) => boolean;
type FireEvent = ((elem: Element, event: Event) => boolean) & {
  [K in EventName]: EventHandler;
};

/**
 * The kinds of handler Lynx runs on the way down the response chain to the
 * target (capture) and on the way back up (bubble). An element has at most
 * one handler per event name, of any kind (see the runtime's
 * combinedEventType), so the order within a phase only matters to a test
 * that registers more.
 */
const CAPTURE_PHASE = ['capture-bindEvent', 'capture-catchEvent'];
const BUBBLE_PHASE = ['bindEvent', 'catchEvent'];

/**
 * The handler __AddEvent registered on `element` for the event `type:name`,
 * if any. The testing environment keeps an element's handlers in an
 * `eventMap` keyed that way, each also listening for the DOM event of that
 * name (setup.ts's __GetEvents reads the same map).
 */
const handlerOf = (
  element: Element,
  type: string,
  name: string,
): ((event: Event) => void) | undefined =>
  (element as { eventMap?: Record<string, (event: Event) => void> }).eventMap?.[
    `${type}:${name}`
  ];

/**
 * The event a handler of `type` receives: the `<type>:<name>` DOM event that
 * reaches it when fired on its own, with the Lynx properties and the test's
 * init on it. Standard EventInit keys are read-only on constructed events,
 * so they're passed to the constructor and not assigned.
 */
const createLynxEvent = (
  elem: Element,
  type: string,
  name: string,
  init: Record<string, unknown>,
): Event => {
  const eventInit = { eventType: type, eventName: name, ...init };
  const event = createEvent(`${type}:${name}`, elem, eventInit);
  Object.assign(
    event,
    Object.fromEntries(
      Object.entries(eventInit).filter(([k]) => !EVENT_INIT_KEYS.has(k)),
    ),
  );
  return event;
};

/**
 * Runs the handlers for the event `name` fired at `target`, as Lynx's
 * TouchEventHandler::HandleEventInternal does on a device. An event that
 * bubbles goes down from the page to the target, running `capture-bind` and
 * `capture-catch` handlers, then back up, running `bind` and `catch` ones. A
 * `catch` handler of either phase runs and stops the event there. Any other
 * event runs the target's own `bind` or `catch` handler and nothing more.
 *
 * It calls the handlers rather than dispatching one DOM event, because the
 * testing environment listens for a separate DOM event per kind
 * (`bindEvent:tap`, `catchEvent:tap`, …): a bubbling `bindEvent:tap` would
 * pass a `(catchtap)` ancestor by, and reach the handlers above it, where a
 * device stops. Returns false if a handler canceled its event, as
 * dispatchEvent does.
 */
const deliver = (
  target: Element,
  name: string,
  init: Record<string, unknown>,
): boolean => {
  // The error Testing Library gives a query that found nothing, rather than
  // a TypeError from reading its parent.
  if (!target) {
    throw new Error(
      `Unable to fire a "${name}" event - please provide a DOM element.`,
    );
  }
  const chain = [target];
  if (init['bubbles']) {
    for (let el = target.parentElement; el; el = el.parentElement) {
      chain.push(el);
    }
  }
  let notCanceled = true;
  /**
   * Runs each element's handlers of `types` in turn. Returns true once a
   * catch handler stops the event.
   */
  const runPhase = (elements: Element[], types: string[]): boolean => {
    for (const element of elements) {
      let caught = false;
      for (const type of types) {
        const handler = handlerOf(element, type, name);
        if (!handler) continue;
        const event = createLynxEvent(target, type, name, init);
        handler(event);
        notCanceled &&= !event.defaultPrevented;
        caught ||= type.endsWith('catchEvent');
      }
      if (caught) return true;
    }
    return false;
  };
  // Lynx has no capture phase for the events that stay on their target.
  const captured =
    !!init['bubbles'] && runPhase([...chain].reverse(), CAPTURE_PHASE);
  if (!captured) runPhase(chain, BUBBLE_PHASE);
  return notCanceled;
};

export const fireEvent: FireEvent = ((elem: Element, event: Event) => {
  return domFireEvent(elem, event);
}) as FireEvent;

for (const key of Object.keys(eventMap) as EventName[]) {
  fireEvent[key] = (elem: Element, init?: Record<string, unknown>): boolean => {
    const { eventType, ...rest } = init ?? {};
    if (eventType === undefined) {
      const eventInit = { ...eventMap[key].defaultInit, ...rest };
      // Run through Testing Library's eventWrapper, as its fireEvent runs a
      // dispatch, for a test that configures one.
      let notCanceled = true;
      getConfig().eventWrapper(() => {
        notCanceled = deliver(elem, key, eventInit);
      });
      return notCanceled;
    }

    // An explicit eventType fires the one `<eventType>:<name>` DOM event at
    // elem: it reaches elem's handler of that kind, or a listener the test
    // added for it, and goes no further unless init asks it to bubble.
    const event = createLynxEvent(elem, String(eventType), key, {
      ...eventMap[key].defaultInit,
      bubbles: false,
      ...rest,
    });
    return domFireEvent(elem, event);
  };
}

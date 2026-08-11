/**
 * fireEvent — dispatches Lynx events through the dual-thread pipeline.
 *
 * Lynx events are registered via __AddEvent with a key of "bindEvent:<name>"
 * (e.g. "bindEvent:tap"). The event handler stored on the element calls
 * lynxCoreInject.tt.publishEvent(handlerSign, eventData) which routes the
 * event to the background thread (not used by AngularLynx, which runs on
 * the main thread).
 *
 * For AngularLynx, the (event) bindings in templates are wired by
 * LynxRenderer.listen() which calls __AddEvent internally. The DOM event
 * dispatched here triggers that listener directly on the main thread.
 */

import { createEvent, fireEvent as domFireEvent } from '@testing-library/dom';

const EVENT_INIT_KEYS = new Set(['bubbles', 'cancelable', 'composed']);

export const eventMap = {
  // Touch / gesture
  tap: { defaultInit: {} },
  longtap: { defaultInit: {} },
  touchstart: { defaultInit: {} },
  touchmove: { defaultInit: {} },
  touchcancel: { defaultInit: {} },
  touchend: { defaultInit: {} },
  longpress: { defaultInit: {} },
  // Keyboard
  keydown: { defaultInit: {} },
  keyup: { defaultInit: {} },
  // Mouse
  mousedown: { defaultInit: {} },
  mouseup: { defaultInit: {} },
  mousemove: { defaultInit: {} },
  mouseclick: { defaultInit: {} },
  mousedblclick: { defaultInit: {} },
  mouselongpress: { defaultInit: {} },
  wheel: { defaultInit: {} },
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

export const fireEvent: FireEvent = ((elem: Element, event: Event) => {
  return domFireEvent(elem, event);
}) as FireEvent;

for (const key of Object.keys(eventMap) as EventName[]) {
  fireEvent[key] = (elem: Element, init?: Record<string, unknown>): boolean => {
    const eventType = (init?.['eventType'] as string) ?? 'bindEvent';
    const eventInit = {
      eventType,
      eventName: key,
      ...eventMap[key].defaultInit,
      ...init,
    };

    const event = createEvent(`${eventType}:${key}`, elem, eventInit);

    // Assign Lynx-specific custom properties (eventType, eventName, etc.).
    // Standard EventInit keys are read-only on constructed events so we skip them.
    const customProps = Object.fromEntries(
      Object.entries(eventInit).filter(([k]) => !EVENT_INIT_KEYS.has(k)),
    );
    Object.assign(event, customProps);

    return domFireEvent(elem, event);
  };
}

import type { ElementRef } from '../types/lynx';

/**
 * A worklet with no `_fn` and no `_wkltId`, which runWorklet ignores (see
 * global-callbacks.ts). It holds nothing, so one value serves every element.
 */
const NO_HANDLER = {
  type: 'worklet',
  value: { _workletType: 'main-thread' },
} as const;

/**
 * Takes the handler for an event off a native element.
 *
 * `__AddEvent` with `undefined` removes only a `global-bindEvent` handler on
 * native Lynx. The others are worklets, which an element keeps in
 * `lepus_events_`, while `AttributeHolder::RemoveEvent` erases from
 * `static_events_` and `global_bind_events_` only (attribute_holder.cc in
 * Lynx 4.1, and still on Lynx's develop branch in November 2026). So the
 * handler is replaced with one that does nothing: Lynx keeps one per event
 * name, and React Lynx removes its worklet handlers the same way
 * (updateWorkletEvent in workletEvent.ts). With the same type, Lynx's
 * listener refactor (`EnableEventHandleRefactor`) matches and removes the
 * listener it made for the handler too.
 *
 * A handler left in place kept the function registered for it, and the
 * native element holds that function, which holds what the function holds:
 * a LynxElement's dispatcher holds the element, and with it the listeners
 * of the view it's in. Those hold the native element again, a loop through
 * native code the garbage collector can't follow, so a screen left behind
 * kept all of its elements and the UI drawn for them (#261).
 *
 * @param element - The native element.
 * @param eventType - The type the handler was added with.
 * @param eventName - The event's name, such as `tap`.
 */
export const removeNativeHandler = (
  element: ElementRef,
  eventType: string,
  eventName: string,
): void => {
  __AddEvent(
    element,
    eventType,
    eventName,
    eventType === 'global-bindEvent' ? undefined : NO_HANDLER,
  );
};

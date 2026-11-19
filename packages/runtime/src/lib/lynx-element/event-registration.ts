import type { ElementRef } from '../types/lynx';

/**
 * How many Lynx events are running on Lynx for Web right now: one, or more
 * when an event's code makes another happen.
 */
let runningEvents = 0;

/** What waits for the running events to finish, in order. */
let waiting: (() => void)[] | null = null;

/**
 * Runs `run`, which handles a Lynx event: Lynx for Web's runWorklet (see
 * global-callbacks.ts), the one way an event reaches main-thread code. Only
 * the web counts them (see addNativeEvent).
 */
export const runLynxEvent = <T>(run: () => T): T => {
  runningEvents++;
  try {
    return run();
  } finally {
    runningEvents--;
  }
};

/**
 * `__AddEvent`, which gives an element a handler for an event or replaces
 * it: now, or on Lynx for Web, once the Lynx event that's running has
 * finished.
 *
 * Lynx for Web keeps every element's handlers in one WebAssembly object,
 * which it holds while it runs an event's handler. A handler added or
 * removed meanwhile changes that object, which Rust doesn't allow: web-core
 * throws "recursive use of an object detected which would lead to unsafe
 * aliasing in rust", and drops the error. Angular's `@defer (on
 * interaction)` takes its `click` listener off the trigger as it fires, from
 * that listener, so the throw stopped it before the block rendered (issue
 * #459). The same happened to anything that starts or stops listening from
 * a tap: an IntersectionObserver or ResizeObserver observing an element, or
 * a listener that removes itself.
 *
 * The element's listeners change at once, so a listener removed doesn't run
 * again; only its native handler waits, for a microtask, which runs once
 * web-core's handling of the event has returned. iOS and Android take the
 * change at once.
 */
export const addNativeEvent = (
  element: ElementRef,
  eventType: string,
  eventName: string,
  handler: Record<string, unknown> | undefined,
): void => {
  if (!__WEB__ || runningEvents === 0) {
    __AddEvent(element, eventType, eventName, handler);
    return;
  }
  if (!waiting) {
    waiting = [];
    queueMicrotask(addWaitingEvents);
  }
  waiting.push(() => __AddEvent(element, eventType, eventName, handler));
};

const addWaitingEvents = (): void => {
  // Taken first: adding one doesn't run an event, but a new list keeps any
  // that's queued meanwhile for a microtask of its own.
  const queued = waiting!;
  waiting = null;
  for (const add of queued) add();
};

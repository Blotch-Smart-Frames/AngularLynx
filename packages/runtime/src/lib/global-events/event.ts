/**
 * `Event` and `CustomEvent` for Lynx's main thread, which has neither.
 * Code that dispatches an event of its own on the window or the document,
 * such as `window.dispatchEvent(new Event('resize'))` to make a layout
 * library measure again, threw "Event is not defined" without them. Each is
 * installed only where it's missing (see installEventClasses), so the web
 * preview, a browser frame, keeps the browser's.
 */

type EventInitLike = {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
};

export class LynxEvent {
  static readonly NONE = 0;
  static readonly CAPTURING_PHASE = 1;
  static readonly AT_TARGET = 2;
  static readonly BUBBLING_PHASE = 3;

  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly timeStamp = Date.now();
  readonly isTrusted = false;
  // Set as the event is dispatched (see dispatchThrough in event-target.ts).
  target: object | null = null;
  currentTarget: object | null = null;
  eventPhase = 0;
  defaultPrevented = false;
  cancelBubble = false;

  constructor(type: string, init: EventInitLike = {}) {
    this.type = String(type);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
  }

  get srcElement(): object | null {
    return this.target;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.cancelBubble = true;
  }

  stopImmediatePropagation(): void {
    this.cancelBubble = true;
  }

  composedPath(): object[] {
    return this.currentTarget ? [this.currentTarget] : [];
  }
}

export class LynxCustomEvent<T = unknown> extends LynxEvent {
  readonly detail: T | null;

  constructor(type: string, init: EventInitLike & { detail?: T } = {}) {
    super(type, init);
    this.detail = init.detail ?? null;
  }
}

/**
 * Installs `Event` and `CustomEvent` on `target` where it has none.
 */
export const installEventClasses = (target: Record<string, unknown>): void => {
  if (typeof target['Event'] === 'undefined') target['Event'] = LynxEvent;
  if (typeof target['CustomEvent'] === 'undefined') {
    target['CustomEvent'] = LynxCustomEvent;
  }
};

/**
 * A new event of `type` from the realm's own Event class, which on Lynx's
 * main thread is LynxEvent (see installEventClasses).
 */
export const createEvent = (type: string): LynxEvent => {
  const EventClass =
    (globalThis as { Event?: typeof LynxEvent }).Event ?? LynxEvent;
  return new EventClass(type);
};

/**
 * Pointer events on Lynx elements.
 *
 * Lynx sends touch events (touchstart, touchmove, touchend, touchcancel), and
 * no pointer events. Libraries written for the web listen for pointer events
 * instead: angular-three's event system (pointerdown, pointermove, pointerup,
 * pointercancel, pointerleave, lostpointercapture), gesture libraries, and
 * any template's `(pointerdown)`. So an element with a pointer listener
 * listens for its touches, and turns each into the pointer events a browser
 * fires for a touch, in a browser's order:
 *
 * - touchstart: pointerover, pointerenter, pointerdown
 * - touchmove: pointermove
 * - touchend: pointerup, then lostpointercapture if the pointer was captured,
 *   then pointerout and pointerleave (a touch leaves when it lifts)
 * - touchcancel: pointercancel, lostpointercapture, pointerout, pointerleave
 *
 * Each finger is a pointer: `pointerId` is its touch's identifier, and
 * `isPrimary` marks the first one down. `offsetX`/`offsetY` are relative to
 * the element, from the touch's `x`/`y` when the element itself was touched
 * and from its last layout otherwise; `clientX`/`clientY` and
 * `pageX`/`pageY` are in the LynxView's coordinates.
 *
 * A touch's events go to the element it started on wherever the finger
 * moves, as if every pointer were captured: Lynx targets touchmove and
 * touchend at touchstart's target. So `setPointerCapture()` changes nothing
 * but `hasPointerCapture()` and the capture events.
 *
 * On Lynx for Web the element is a DOM element with real pointer events
 * (and a mouse's), so the listeners go straight to it.
 */

/** The pointer events an element can listen for. */
export const POINTER_EVENT_NAMES: ReadonlySet<string> = new Set([
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'gotpointercapture',
  'lostpointercapture',
]);

/** A Lynx touch, as its touch events carry it. */
type LynxTouch = {
  identifier: number;
  x?: number;
  y?: number;
  pageX?: number;
  pageY?: number;
  clientX?: number;
  clientY?: number;
};

type LynxTouchEvent = {
  type?: string;
  timestamp?: number;
  target?: { uid?: number };
  touches?: LynxTouch[];
  changedTouches?: LynxTouch[];
};

/** What the source needs from its element. */
export type PointerEventHost = {
  /** The element's unique id, which a touch event's `target.uid` names. */
  readonly uid: number;
  /** The element's last layout, relative to the LynxView. */
  layoutOrigin(): { left: number; top: number } | null;
  /** Adds a touch listener to the element itself (`bindtouchstart`, …). */
  listen(name: string, listener: (event: LynxTouchEvent) => void): () => void;
  /** The object to set as the events' `target` and `currentTarget`. */
  readonly eventTarget: object;
};

type PointerListener = (event: LynxPointerEvent) => unknown;

/**
 * A pointer event made from a touch: the PointerEvent fields a library reads,
 * with `preventDefault()` and the propagation methods (which change nothing,
 * as Lynx decides a touch's propagation when it's bound).
 */
export class LynxPointerEvent {
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed = true;
  readonly pointerType = 'touch';
  readonly width = 1;
  readonly height = 1;
  readonly tiltX = 0;
  readonly tiltY = 0;
  readonly twist = 0;
  readonly tangentialPressure = 0;
  readonly altKey = false;
  readonly ctrlKey = false;
  readonly metaKey = false;
  readonly shiftKey = false;
  readonly detail = 0;
  readonly eventPhase = 2;
  readonly isTrusted = true;
  readonly target: object;
  readonly currentTarget: object;
  readonly srcElement: object;
  readonly relatedTarget = null;
  readonly x: number;
  readonly y: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly movementX = 0;
  readonly movementY = 0;
  defaultPrevented = false;
  #stopped = false;

  constructor(
    readonly type: string,
    readonly pointerId: number,
    readonly isPrimary: boolean,
    readonly clientX: number,
    readonly clientY: number,
    readonly pageX: number,
    readonly pageY: number,
    readonly offsetX: number,
    readonly offsetY: number,
    readonly button: number,
    readonly buttons: number,
    readonly pressure: number,
    readonly timeStamp: number,
    target: object,
  ) {
    this.bubbles = type !== 'pointerenter' && type !== 'pointerleave';
    this.cancelable =
      type !== 'pointerenter' &&
      type !== 'pointerleave' &&
      type !== 'pointercancel' &&
      type !== 'gotpointercapture' &&
      type !== 'lostpointercapture';
    this.target = target;
    this.currentTarget = target;
    this.srcElement = target;
    this.x = clientX;
    this.y = clientY;
    this.screenX = clientX;
    this.screenY = clientY;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {}

  stopImmediatePropagation(): void {
    this.#stopped = true;
  }

  /**
   * @internal Whether a listener stopped the others.
   */
  get immediatePropagationStopped(): boolean {
    return this.#stopped;
  }

  getCoalescedEvents(): LynxPointerEvent[] {
    return [this];
  }

  getPredictedEvents(): LynxPointerEvent[] {
    return [];
  }
}

/**
 * One element's pointer events: its listeners, by event name, and the touch
 * listeners it adds to the element while it has any.
 */
export class PointerEventSource {
  readonly #host: PointerEventHost;
  readonly #listeners = new Map<string, PointerListener[]>();
  readonly #captured = new Set<number>();
  /** Fingers down on the element, by touch identifier: the primary first. */
  readonly #down = new Map<number, { offsetX: number; offsetY: number }>();
  #primary: number | null = null;
  #unlisten: (() => void)[] = [];
  /** Where the last pointer was on the element, for the click that follows. */
  lastOffset: { offsetX: number; offsetY: number } | null = null;

  constructor(host: PointerEventHost) {
    this.#host = host;
  }

  add(type: string, listener: PointerListener): () => void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
    this.#listen();
    return () => this.remove(type, listener);
  }

  remove(type: string, listener: PointerListener): void {
    const list = this.#listeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
    if (list.length === 0) this.#listeners.delete(type);
    if (this.#listeners.size === 0) this.#stopListening();
  }

  setPointerCapture(pointerId: number): void {
    if (!this.#down.has(pointerId) || this.#captured.has(pointerId)) return;
    this.#captured.add(pointerId);
    this.#fire('gotpointercapture', pointerId, null);
  }

  releasePointerCapture(pointerId: number): void {
    if (!this.#captured.delete(pointerId)) return;
    this.#fire('lostpointercapture', pointerId, null);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.#captured.has(pointerId);
  }

  #listen(): void {
    if (this.#unlisten.length > 0) return;
    this.#unlisten = [
      this.#host.listen('bindtouchstart', (event) => this.#onStart(event)),
      this.#host.listen('bindtouchmove', (event) => this.#onMove(event)),
      this.#host.listen('bindtouchend', (event) => this.#onEnd(event, false)),
      this.#host.listen('bindtouchcancel', (event) => this.#onEnd(event, true)),
    ];
  }

  #stopListening(): void {
    for (const unlisten of this.#unlisten) unlisten();
    this.#unlisten = [];
  }

  #offset(
    event: LynxTouchEvent,
    touch: LynxTouch,
  ): {
    offsetX: number;
    offsetY: number;
  } {
    // A touch's x and y are relative to the element it hit: this one, unless
    // a child of it was touched.
    if (
      event.target?.uid === this.#host.uid &&
      typeof touch.x === 'number' &&
      typeof touch.y === 'number'
    ) {
      return { offsetX: touch.x, offsetY: touch.y };
    }
    const origin = this.#host.layoutOrigin() ?? { left: 0, top: 0 };
    return {
      offsetX: (touch.pageX ?? touch.clientX ?? 0) - origin.left,
      offsetY: (touch.pageY ?? touch.clientY ?? 0) - origin.top,
    };
  }

  #onStart(event: LynxTouchEvent): void {
    for (const touch of event.changedTouches ?? []) {
      const offset = this.#offset(event, touch);
      this.#down.set(touch.identifier, offset);
      this.#primary ??= touch.identifier;
      this.lastOffset = offset;
      this.#fire('pointerover', touch.identifier, touch, event, offset);
      this.#fire('pointerenter', touch.identifier, touch, event, offset);
      this.#fire('pointerdown', touch.identifier, touch, event, offset);
    }
  }

  #onMove(event: LynxTouchEvent): void {
    for (const touch of event.changedTouches ?? []) {
      if (!this.#down.has(touch.identifier)) continue;
      const offset = this.#offset(event, touch);
      this.#down.set(touch.identifier, offset);
      this.lastOffset = offset;
      this.#fire('pointermove', touch.identifier, touch, event, offset);
    }
  }

  #onEnd(event: LynxTouchEvent, canceled: boolean): void {
    for (const touch of event.changedTouches ?? []) {
      if (!this.#down.has(touch.identifier)) continue;
      const offset = canceled
        ? this.#down.get(touch.identifier)!
        : this.#offset(event, touch);
      this.lastOffset = offset;
      this.#fire(
        canceled ? 'pointercancel' : 'pointerup',
        touch.identifier,
        touch,
        event,
        offset,
      );
      // A browser releases a touch's capture when it lifts.
      if (this.#captured.delete(touch.identifier)) {
        this.#fire(
          'lostpointercapture',
          touch.identifier,
          touch,
          event,
          offset,
        );
      }
      this.#fire('pointerout', touch.identifier, touch, event, offset);
      this.#fire('pointerleave', touch.identifier, touch, event, offset);
      this.#down.delete(touch.identifier);
      if (this.#primary === touch.identifier) this.#primary = null;
    }
  }

  #fire(
    type: string,
    pointerId: number,
    touch: LynxTouch | null,
    event?: LynxTouchEvent,
    offset?: { offsetX: number; offsetY: number },
  ): void {
    // remove() drops a type with no listeners left.
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    // Only a finger that's down can be captured or released, so a capture
    // event, which has no touch, is where that finger is.
    const position = offset ?? this.#down.get(pointerId)!;
    const pressed =
      type === 'pointerdown' || type === 'pointermove' || type === 'pointerover'
        ? 1
        : 0;
    const pointerEvent = new LynxPointerEvent(
      type,
      pointerId,
      this.#primary === null || this.#primary === pointerId,
      touch?.clientX ?? touch?.pageX ?? 0,
      touch?.clientY ?? touch?.pageY ?? 0,
      touch?.pageX ?? 0,
      touch?.pageY ?? 0,
      position.offsetX,
      position.offsetY,
      // `button` is the one that changed: none for a move.
      type === 'pointermove' ? -1 : 0,
      pressed,
      pressed ? 0.5 : 0,
      event?.timestamp ?? Date.now(),
      this.#host.eventTarget,
    );
    // A copy: a listener may remove itself as it runs.
    for (const listener of listeners.slice()) {
      listener(pointerEvent);
      if (pointerEvent.immediatePropagationStopped) break;
    }
  }
}

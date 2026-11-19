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
 * - touchstart: pointerover, pointerenter, mouseover, mouseenter,
 *   pointerdown
 * - touchmove: pointermove
 * - touchend: pointerup, then lostpointercapture if the pointer was captured,
 *   then pointerout, pointerleave, mouseout and mouseleave (a touch leaves
 *   when it lifts)
 * - touchcancel: pointercancel, lostpointercapture, pointerout, pointerleave,
 *   mouseout, mouseleave
 *
 * The mouse events are the ones that say a pointer is over the element, which
 * code written for a mouse listens for to show something on hover: Angular's
 * `@defer (on hover)` listens for `mouseover` and `mouseenter` (issue #459). A
 * phone's browser fires them for a tap; here the first finger fires them, as
 * it does the pointer events, while it's down. Lynx has no other mouse
 * events to stand in for, so `mousedown`, `mousemove` and `mouseup` stay
 * ignored.
 *
 * Each finger is a pointer, whose `pointerId` stays the same until it lifts
 * (see pointerIdOf), and `isPrimary` marks the first one down. `offsetX`/`offsetY` are relative to
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

/**
 * The pointer events an element can listen for, with the mouse events that
 * say the pointer is over it.
 */
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
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
]);

/** The events that don't bubble, as the DOM's don't. */
const NOT_BUBBLING: ReadonlySet<string> = new Set([
  'pointerenter',
  'pointerleave',
  'mouseenter',
  'mouseleave',
]);

/** A Lynx touch, as its touch events carry it. */
export type LynxTouch = {
  identifier: number;
  x?: number;
  y?: number;
  pageX?: number;
  pageY?: number;
  clientX?: number;
  clientY?: number;
};

export type LynxTouchEvent = {
  type?: string;
  timestamp?: number;
  target?: { uid?: number };
  touches?: LynxTouch[];
  changedTouches?: LynxTouch[];
};

/**
 * Above this, a touch's `identifier` isn't a number Lynx gave the finger.
 */
const MAX_TOUCH_NUMBER = 0xffff;

/**
 * A touch's pointerId, the same in each of its events, at an element and at
 * the document.
 *
 * With multi-touch on, Lynx numbers each finger from 0 and keeps its number
 * until it lifts (`touches_map_` in iOS's LynxTouchHandler.mm, and Android's
 * `MotionEvent.getPointerId()`). With it off, Lynx's default (the
 * `enableMultiTouch` page config, which the build's `multiTouch` option
 * sets), there's one touch at a time, and its `identifier` is the address
 * of the dictionary Lynx builds the touch in (`reinterpret_cast<int64_t>(&touch)`
 * in TouchEventHandler::GetTouchEventParam), which changes from one event to
 * the next: on the iOS 27 Simulator, a drag's touchmove events had one and its
 * touchend another. So a touch with such an identifier is the one touch, and
 * gets the number multi-touch gives the first finger.
 */
export const pointerIdOf = (touch: LynxTouch): number =>
  touch.identifier >= 0 && touch.identifier <= MAX_TOUCH_NUMBER
    ? touch.identifier
    : 0;

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
    this.bubbles = !NOT_BUBBLING.has(type);
    this.cancelable =
      this.bubbles &&
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
  /** Fingers down on the element, by pointerId: the primary first. */
  readonly #down = new Map<number, { offsetX: number; offsetY: number }>();
  #primary: number | null = null;
  #unlisten: (() => void)[] = [];
  /**
   * The listening session: one more each time the source starts or stops
   * listening. Each touch handler belongs to the session that added it (see
   * #live).
   */
  #session = 0;
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
    const session = ++this.#session;
    this.#unlisten = [
      this.#host.listen('bindtouchstart', (event) =>
        this.#onStart(event, session),
      ),
      this.#host.listen('bindtouchmove', (event) =>
        this.#onMove(event, session),
      ),
      this.#host.listen('bindtouchend', (event) =>
        this.#onEnd(event, false, session),
      ),
      this.#host.listen('bindtouchcancel', (event) =>
        this.#onEnd(event, true, session),
      ),
    ];
  }

  /**
   * Whether `session` is still listening. A listener can stop the source
   * while a touch event is being dispatched to it: Angular's `@defer (on
   * hover)` does, from its mouseover listener. The rest of that event then
   * goes no further. It would give the stopped source fingers again, which
   * it can't hear lift, or give a listener added meanwhile the end of a
   * touch whose start it never got.
   */
  #live(session: number): boolean {
    return this.#session === session;
  }

  #stopListening(): void {
    for (const unlisten of this.#unlisten) unlisten();
    this.#unlisten = [];
    this.#session++;
    // Without its touch listeners the source can't hear a finger lift, and
    // the last listener can go while one is down: Angular's `@defer (on
    // hover)` stops listening on the touch that fires it. Kept, that finger
    // would stay down and primary for good, and a later touch with another
    // pointerId would get no mouse events. So the source forgets its
    // fingers and starts again as a new one does, which follows only the
    // touches that start while it listens.
    this.#down.clear();
    this.#captured.clear();
    this.#primary = null;
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

  #onStart(event: LynxTouchEvent, session: number): void {
    for (const touch of event.changedTouches ?? []) {
      if (!this.#live(session)) return;
      const id = pointerIdOf(touch);
      const offset = this.#offset(event, touch);
      this.#down.set(id, offset);
      this.#primary ??= id;
      this.lastOffset = offset;
      const fire = (type: string) => {
        if (this.#live(session)) this.#fire(type, id, touch, event, offset);
      };
      fire('pointerover');
      fire('pointerenter');
      // A browser makes mouse events from the primary pointer only.
      if (this.#primary === id) {
        fire('mouseover');
        fire('mouseenter');
      }
      fire('pointerdown');
    }
  }

  #onMove(event: LynxTouchEvent, session: number): void {
    for (const touch of event.changedTouches ?? []) {
      if (!this.#live(session)) return;
      const id = pointerIdOf(touch);
      if (!this.#down.has(id)) continue;
      const offset = this.#offset(event, touch);
      this.#down.set(id, offset);
      this.lastOffset = offset;
      this.#fire('pointermove', id, touch, event, offset);
    }
  }

  #onEnd(event: LynxTouchEvent, canceled: boolean, session: number): void {
    for (const touch of event.changedTouches ?? []) {
      if (!this.#live(session)) return;
      const id = pointerIdOf(touch);
      if (!this.#down.has(id)) continue;
      const offset = canceled
        ? this.#down.get(id)!
        : this.#offset(event, touch);
      this.lastOffset = offset;
      const fire = (type: string) => {
        if (this.#live(session)) this.#fire(type, id, touch, event, offset);
      };
      fire(canceled ? 'pointercancel' : 'pointerup');
      // A browser releases a touch's capture when it lifts. Stopping cleared
      // the captures, so this finds none once the session has ended.
      if (this.#captured.delete(id)) fire('lostpointercapture');
      fire('pointerout');
      fire('pointerleave');
      if (this.#primary === id) {
        fire('mouseout');
        fire('mouseleave');
      }
      this.#down.delete(id);
      if (this.#primary === id) this.#primary = null;
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
    const pointerEvent = pointerEventFor(
      type,
      {
        pointerId,
        isPrimary: this.#primary === null || this.#primary === pointerId,
        ...position,
      },
      touch,
      event?.timestamp,
      this.#host.eventTarget,
    );
    // A copy: a listener may remove itself as it runs.
    for (const listener of listeners.slice()) {
      listener(pointerEvent);
      if (pointerEvent.immediatePropagationStopped) break;
    }
  }
}

/**
 * The pointer event a browser fires for `touch`: the one an element makes
 * (see PointerEventSource), and the one the document gets for a touch
 * anywhere (see global-events/native-source.ts). `pointer` says which finger
 * it is and where it is on the target; a capture event, which no touch
 * causes, has no `touch`.
 */
export const pointerEventFor = (
  type: string,
  pointer: {
    pointerId: number;
    isPrimary: boolean;
    offsetX: number;
    offsetY: number;
  },
  touch: LynxTouch | null,
  timeStamp: number | undefined,
  target: object,
): LynxPointerEvent => {
  // The finger is down for the events a touch starts with, as a mouse's
  // button is for a press that moves over an element.
  const pressed =
    type === 'pointerdown' ||
    type === 'pointermove' ||
    type === 'pointerover' ||
    type === 'mouseover'
      ? 1
      : 0;
  return new LynxPointerEvent(
    type,
    pointer.pointerId,
    pointer.isPrimary,
    touch?.clientX ?? touch?.pageX ?? 0,
    touch?.clientY ?? touch?.pageY ?? 0,
    touch?.pageX ?? 0,
    touch?.pageY ?? 0,
    pointer.offsetX,
    pointer.offsetY,
    // `button` is the one that changed: none for a move.
    type === 'pointermove' ? -1 : 0,
    pressed,
    pressed ? 0.5 : 0,
    timeStamp ?? Date.now(),
    target,
  );
};

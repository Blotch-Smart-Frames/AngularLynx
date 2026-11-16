import {
  type LynxTouch,
  type LynxTouchEvent,
  pointerEventFor,
  pointerIdOf,
} from '../lynx-element/pointer-events';
import type {
  Delivery,
  GlobalEvents,
  GlobalEventsPage,
  ScreenSource,
  ViewportSize,
} from './global-events';

/**
 * Screen events on iOS and Android (see global-events.ts), from listeners on
 * the page element:
 *
 * - A `global-bind` listener hears a touch on any element, whatever stops it
 *   on its way up (`TouchEventHandler::HandleEventInternal` in Lynx's
 *   `core/renderer/events/touch_event_handler.cc` runs every global-bind
 *   handler for it, before the touched element's own). Each touch event is
 *   turned into the pointer events a browser fires for it, in a browser's
 *   order, then dispatched itself: touchstart's are pointerover, pointerdown
 *   and touchstart. `tap` reaches the `click` listeners, as an element's
 *   does (see DOM_EVENT_ALIASES).
 * - A `bind` listener of the same event is the last to hear it, when it
 *   bubbles up to the page, after the page's own listeners, so the second
 *   half of its dispatch runs there (see GlobalEvents.late).
 * - `bindresize`: Lynx sends the page a `resize` event when the LynxView's
 *   size changes, as when the device rotates, and after its first layout
 *   (`LayoutContext::OnLayoutAfter` compares the root's size with the last,
 *   which starts at zero, and `LayoutMediator::OnCalculatedViewportChanged`
 *   sends the new one; see sizeOf).
 *
 * A pointer event's target is the element the touch landed on, and its
 * `offsetX`/`offsetY` the touch's `x`/`y`, which Lynx gives relative to that
 * element. A touch event and a tap keep Lynx's own event object, as an
 * element's listeners get them.
 */

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];

/** The prefix of the page listeners that hear an event on any element. */
const GLOBAL_BIND = 'global-bind';

/** The pointer events a document hears: those that bubble. */
const POINTER_EVENTS = new Set([
  'pointerover',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerout',
]);

/** The pointer events each touch event makes, in a browser's order. */
const POINTERS_FOR: Record<string, string[]> = {
  touchstart: ['pointerover', 'pointerdown'],
  touchmove: ['pointermove'],
  touchend: ['pointerup', 'pointerout'],
  touchcancel: ['pointercancel', 'pointerout'],
};

/**
 * The LynxView's size, from a `resize` event's detail: the arguments
 * LayoutMediator::OnCalculatedViewportChanged emits, which on the iOS 27
 * Simulator were `['onWindowResize', [402, 874]]`.
 */
const sizeOf = (event: { detail?: unknown }): ViewportSize | null => {
  const size = Array.isArray(event.detail) ? event.detail[1] : undefined;
  if (!Array.isArray(size) || size.length < 2) return null;
  return { width: Number(size[0]), height: Number(size[1]) };
};

export class NativeScreenSource implements ScreenSource {
  readonly #events: GlobalEvents;
  #page: GlobalEventsPage | null = null;
  /**
   * The page listeners, by the name the page took each under
   * (`global-bindtouchstart`, `bindtouchstart`, `bindresize`, …).
   */
  readonly #listening = new Map<string, () => void>();
  /** The fingers that are down, by pointerId (see pointerIdOf). */
  readonly #down = new Set<number>();
  #primary: number | null = null;

  constructor(events: GlobalEvents) {
    this.#events = events;
  }

  sync(page: GlobalEventsPage | null, types: ReadonlySet<string>): void {
    if (page !== this.#page) {
      this.#stop([...this.#listening.keys()]);
      this.#page = page;
    }
    if (!page) return;
    const wanted = new Set<string>(['bindresize']);
    const typeList = [...types];
    if (
      typeList.some((t) => POINTER_EVENTS.has(t) || TOUCH_EVENTS.includes(t))
    ) {
      for (const name of TOUCH_EVENTS) {
        // The global-bind listener begins each dispatch (see #begin). The
        // touchmove's is wanted even when nothing listens for a move (a
        // click-outside `pointerdown` is the usual document listener): its
        // first job is finishing the last event's dispatch, so a caught
        // touchstart's pointerdown still reaches the document before the
        // next move's listeners run. #begin does nothing more for a move
        // nobody hears.
        wanted.add(`global-bind${name}`);
        // The page's own bubbling listener for each: it shares the page's
        // native handler with an app's listener for the event on the page,
        // so a capture one there (`capture-bindtouchmove` on the root
        // component's host) stays registered bubbling, after its
        // descendants' (see combinedEventType). With nothing pending, it
        // does nothing.
        wanted.add(`bind${name}`);
      }
    }
    if (types.has('click')) {
      wanted.add('global-bindtap');
      wanted.add('bindtap');
    }
    this.#stop([...this.#listening.keys()].filter((n) => !wanted.has(n)));
    for (const name of wanted) {
      if (!this.#listening.has(name)) {
        this.#listening.set(name, this.#listen(page, name));
      }
    }
  }

  /**
   * Adds the page listener `listener` names: a `global-bind` one, which
   * begins each dispatch (see #begin), a `bind` one, which runs after the
   * page's own listeners and finishes it (see GlobalEvents.late), or
   * `bindresize`.
   */
  #listen(page: GlobalEventsPage, listener: string): () => void {
    if (listener === 'bindresize') {
      return page.addEventListener('bindresize', (event) => {
        const size = sizeOf(event);
        if (size) this.#events.resized(size);
      });
    }
    if (listener.startsWith(GLOBAL_BIND)) {
      const name = listener.slice(GLOBAL_BIND.length);
      return page.addEventListener(listener, (event) =>
        this.#begin(name, event),
      );
    }
    const name = listener.slice('bind'.length);
    return page.addTrailingEventListener(listener, () =>
      this.#events.late(name),
    );
  }

  #stop(listeners: string[]): void {
    for (const listener of listeners) {
      this.#listening.get(listener)?.();
      this.#listening.delete(listener);
      // Fingers that went down while touches were heard can't be followed
      // any more.
      if (listener === `${GLOBAL_BIND}touchstart`) {
        this.#down.clear();
        this.#primary = null;
      }
    }
  }

  #begin(name: string, event: LynxTouchEvent): void {
    // The last event's listeners all ran before this one began, so one
    // still pending was stopped before it reached the page.
    this.#events.finishPending();
    // A move that no pointermove or touchmove listener hears has nothing
    // to deliver, and following the fingers takes only touches' starts and
    // ends (see #pointers). Returning here spares every touchmove anywhere
    // on the screen, all through a scroll, a dispatch built for nothing.
    if (
      name === 'touchmove' &&
      !this.#events.hasListeners('pointermove') &&
      !this.#events.hasListeners('touchmove')
    ) {
      return;
    }
    const target = this.#events.targetFor(event.target?.uid);
    const deliveries: Delivery[] =
      name === 'tap'
        ? [{ type: 'click', event, target }]
        : [
            ...this.#pointers(name, event, target),
            { type: name, event, target },
          ];
    this.#events.early(
      name,
      deliveries.filter((d) => this.#events.hasListeners(d.type)),
    );
  }

  /**
   * The pointer events of touch event `name`, one set per finger.
   */
  #pointers(name: string, event: LynxTouchEvent, target: object): Delivery[] {
    const deliveries: Delivery[] = [];
    for (const touch of event.changedTouches ?? []) {
      const id = pointerIdOf(touch);
      if (name === 'touchstart') {
        this.#down.add(id);
        this.#primary ??= id;
      } else if (!this.#down.has(id)) {
        // A finger that went down before the document listened.
        continue;
      }
      for (const type of POINTERS_FOR[name]) {
        // Only the pointer events something listens for are made: each is
        // a LynxPointerEvent of some 35 fields, and #begin would drop the
        // others unheard.
        if (!this.#events.hasListeners(type)) continue;
        deliveries.push({
          type,
          event: this.#pointerEvent(type, touch, event, target),
          target,
        });
      }
      if (name === 'touchend' || name === 'touchcancel') {
        this.#down.delete(id);
        if (this.#primary === id) this.#primary = null;
      }
    }
    return deliveries;
  }

  #pointerEvent(
    type: string,
    touch: LynxTouch,
    event: LynxTouchEvent,
    target: object,
  ): object {
    return pointerEventFor(
      type,
      {
        pointerId: pointerIdOf(touch),
        isPrimary: this.#primary === pointerIdOf(touch),
        offsetX: touch.x ?? 0,
        offsetY: touch.y ?? 0,
      },
      touch,
      event.timestamp,
      target,
    );
  }
}

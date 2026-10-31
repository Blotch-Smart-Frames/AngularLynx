import type { ElementRef } from '../../types/lynx';
import { GestureType } from '../types';
import { FlingTrigger } from './fling-trigger';
import {
  createHandlers,
  FLING_END,
  HandlerState,
  type WebGestureDetector,
  type WebGestureHandler,
} from './handlers';
import {
  ORIGIN,
  type Point,
  type TouchPoint,
  type TouchType,
  touchPointOf,
  VelocityTracker,
} from './touch-point';

/**
 * Gestures on Lynx for Web.
 *
 * `@lynx-js/web-core` recognizes no gestures: its `__SetGestureDetector` and
 * `__RemoveGestureDetector` do nothing, and it has no `__SetGestureState` or
 * `__ConsumeGesture`. So `[lynxGesture]` did nothing in the web preview. This
 * is Lynx's own gesture arena, ported from its iOS sources
 * (LynxGestureArenaManager.m, LynxGestureHandlerTrigger.m and
 * LynxGestureDetectorManager.m in lynx-family/lynx) and fed with the
 * browser's pointer events instead of UITouches, so that gestures compete,
 * wait for each other and fling in the preview as they do on a phone.
 *
 * How the arena works, as on iOS:
 * - Every element with a gesture is a member. When a touch starts, the
 *   members it's on, from the innermost out, form its chain, and the first
 *   of them is the winner: only the winner's gestures (and those set to
 *   recognize simultaneously with them) see the touch.
 * - When all of the winner's gestures fail, the next member in the chain
 *   gets its gestures reset and becomes the winner, and is handed the event.
 *   `waitFor` an ancestor's gesture moves that ancestor ahead in the chain.
 * - On one element, gestures race: the first to activate fails the others,
 *   except those it's simultaneous with. `waitFor` between gestures of the
 *   same element changes nothing, on iOS as here.
 * - When the touch lifts fast enough, a fling follows, whose frames go to the
 *   winner's fling gestures.
 *
 * The browser can't see Lynx's arena, so it would scroll the page under a
 * pan, or select the text a mouse drags over. While a pan of the touch is
 * still in play, its `touchmove`s, text selections and drags are canceled
 * (see #panning).
 */

/**
 * Lynx's state codes for `__SetGestureState` (LynxGestureState).
 */
const FAIL_STATE = 2;
const END_STATE = 3;

const POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel'];

/**
 * What a mouse drag does in a browser by default, which a pan's drag mustn't:
 * select text, or drag it (or an image) out, which also cancels the pointer.
 */
const DRAG_EVENTS = ['selectstart', 'dragstart'];

type Member = {
  readonly element: HTMLElement;
  /**
   * By gesture ID, in the order they were set.
   */
  readonly detectors: Map<number, WebGestureDetector>;
  /**
   * Built when a touch first needs them, and again after `detectors` change.
   */
  handlers: WebGestureHandler[] | null;
};

/**
 * The pointer the arena is following. Lynx follows one finger at a time.
 */
type Pointer = {
  readonly id: number;
  /**
   * The element the touch started on, which `x`/`y` are measured from.
   */
  readonly target: Element;
  readonly document: Document;
};

export class WebGestureArena {
  readonly #afterDispatch: () => void;
  /**
   * By element: the native ref, which on the web is the DOM element.
   */
  readonly #members = new Map<object, Member>();
  /**
   * Which members have each gesture, for the relations between them.
   */
  readonly #gestureMembers = new Map<number, Set<Member>>();
  readonly #velocity = new VelocityTracker();
  readonly #flinger = new FlingTrigger(() => this.#onFling());
  #pointer: Pointer | null = null;
  /**
   * The members the touch is on, innermost first.
   */
  #bubble: Member[] = [];
  /**
   * The order the members compete in.
   */
  #chain: Member[] = [];
  #winner: Member | null = null;
  #lastWinner: Member | null = null;
  #lastFlingWinner: Member | null = null;
  #simultaneousMembers = new Set<Member>();
  #simultaneousIds = new Set<number>();

  /**
   * @param afterDispatch Runs after each gesture callback. Callbacks run
   *   from pointer events, outside Angular's change detection, so whatever
   *   they change in the element tree needs committing, as an event
   *   handler's changes do (see LynxElement's #dispatch).
   */
  constructor(afterDispatch: () => void) {
    this.#afterDispatch = afterDispatch;
  }

  /**
   * `__SetGestureDetector`: adds a gesture to an element, or replaces it.
   */
  setDetector(
    node: ElementRef,
    id: number,
    type: number,
    config: {
      callbacks: Array<{ name: string; callback: unknown }>;
      config?: Record<string, unknown>;
    },
    relations: Record<string, number[]>,
  ): void {
    let member = this.#members.get(node);
    if (!member) {
      const element = node as HTMLElement;
      member = { element, detectors: new Map(), handlers: null };
      this.#members.set(node, member);
      element.addEventListener('pointerdown', this.#onPointerDown);
      // Not passive, or it couldn't cancel the move (see #onTouchMove).
      element.addEventListener('touchmove', this.#onTouchMove, {
        passive: false,
      });
    }
    member.detectors.set(id, {
      id,
      type,
      config: config.config,
      callbacks: new Map(
        config.callbacks.map(({ name, callback }) => [name, callback]),
      ),
      waitFor: relations['waitFor'] ?? [],
      simultaneous: relations['simultaneous'] ?? [],
      continueWith: relations['continueWith'] ?? [],
    });
    this.#invalidate(member);
    let members = this.#gestureMembers.get(id);
    if (!members) {
      members = new Set();
      this.#gestureMembers.set(id, members);
    }
    members.add(member);
  }

  /**
   * `__RemoveGestureDetector`.
   */
  removeDetector(node: ElementRef, id: number): void {
    const member = this.#members.get(node);
    if (!member?.detectors.delete(id)) return;
    this.#invalidate(member);
    const members = this.#gestureMembers.get(id)!;
    members.delete(member);
    if (!members.size) this.#gestureMembers.delete(id);
    if (member.detectors.size) return;
    this.#members.delete(node);
    member.element.removeEventListener('pointerdown', this.#onPointerDown);
    member.element.removeEventListener('touchmove', this.#onTouchMove);
  }

  /**
   * `__SetGestureState`, from a callback's state manager. As on iOS, failing
   * or ending a gesture takes effect at once, and activating one does nothing
   * (LynxGestureHandlerTrigger's handleGestureDetectorState ignores it).
   */
  setState(node: ElementRef, id: number, state: number): void {
    const handler = this.#members
      .get(node)
      ?.handlers?.find((other) => other.detector.id === id);
    if (state === FAIL_STATE) handler?.fail();
    else if (state === END_STATE) handler?.end();
  }

  /**
   * A member's gestures changed: its handlers start over.
   */
  #invalidate(member: Member): void {
    for (const handler of member.handlers ?? []) handler.dispose();
    member.handlers = null;
  }

  #handlersOf(member: Member): WebGestureHandler[] {
    member.handlers ??= createHandlers(member.detectors.values(), this.#emit);
    return member.handlers;
  }

  /**
   * Calls a gesture's callback with Lynx's event envelope, whose data is
   * under `params` (see mapGestureEvent). A callback that throws mustn't
   * leave the arena halfway through an event, so its error is thrown again
   * once the event is done.
   */
  readonly #emit = (
    detector: WebGestureDetector,
    name: string,
    params: Record<string, unknown>,
  ): void => {
    // LynxGestureDetector registers each callback as `{ _fn }` (see its
    // NativeCallbackEntry).
    const callback = detector.callbacks.get(name) as {
      _fn?: (event: unknown) => void;
    };
    try {
      callback._fn?.({ type: name, timestamp: Date.now(), params });
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
    this.#afterDispatch();
  };

  // Pointer events

  readonly #onPointerDown = (event: PointerEvent): void => {
    // The first member the event bubbles to takes the touch for all of them,
    // so the others see a pointer already followed. A second finger, or a
    // mouse's other buttons, aren't followed.
    if (this.#pointer || event.button > 0) return;
    const bubble = [
      ...new Set(
        event
          .composedPath()
          .map((node) => this.#members.get(node))
          .filter((member) => member !== undefined),
      ),
    ];
    const target = event.target as Element;
    const { ownerDocument } = target;
    this.#pointer = { id: event.pointerId, target, document: ownerDocument };
    // On the document, and capturing, so that the touch is followed off the
    // element and past listeners that stop the events.
    for (const type of POINTER_EVENTS) {
      ownerDocument.addEventListener(type, this.#onPointer, true);
    }
    for (const type of DRAG_EVENTS) {
      ownerDocument.addEventListener(type, this.#onDrag, true);
    }
    // A new touch stops a fling still running. Lynx stops it only when the
    // touch is on the flinging element, but it then gives both touches the
    // same handlers.
    this.#flinger.stop();
    this.#bubble = bubble;
    this.#chain = this.#competeChain(bubble);
    const [winner] = this.#chain;
    this.#winner = winner;
    this.#lastWinner = winner;
    this.#updateSimultaneous(winner);
    this.#velocity.reset();
    this.#touch(event, 'touchstart');
  };

  /**
   * `pointermove`, `pointerup` and `pointercancel`, on the whole document.
   */
  readonly #onPointer = (domEvent: Event): void => {
    const event = domEvent as PointerEvent;
    if (event.pointerId !== this.#pointer?.id) return;
    if (event.type === 'pointermove') {
      this.#touch(event, 'touchmove');
      return;
    }
    const { document } = this.#pointer;
    for (const type of POINTER_EVENTS) {
      document.removeEventListener(type, this.#onPointer, true);
    }
    for (const type of DRAG_EVENTS) {
      document.removeEventListener(type, this.#onDrag, true);
    }
    try {
      this.#touch(
        event,
        event.type === 'pointerup' ? 'touchend' : 'touchcancel',
      );
    } finally {
      this.#pointer = null;
    }
  };

  /**
   * Keeps the browser from scrolling while a pan could still take the touch,
   * as Lynx's arena keeps a scroll view from moving under a pan on iOS.
   */
  readonly #onTouchMove = (event: Event): void => {
    if (this.#pointer && event.cancelable && this.#panning()) {
      event.preventDefault();
    }
  };

  /**
   * Keeps a mouse drag from selecting or dragging out what's under a pan.
   */
  readonly #onDrag = (event: Event): void => {
    if (this.#panning()) event.preventDefault();
  };

  /**
   * Whether a pan of the touch is still in play.
   */
  #panning(): boolean {
    const members = [...this.#chain, ...this.#simultaneousMembers];
    return members.some((member) =>
      this.#handlersOf(member).some(
        (handler) =>
          handler.detector.type === GestureType.PAN &&
          handler.status < HandlerState.Fail,
      ),
    );
  }

  #touch(event: PointerEvent, type: TouchType): void {
    const touch = touchPointOf(event, type, this.#pointer!.target);
    this.#velocity.add(touch);
    // As on iOS, every member of the touch hears of it first
    // (`onTouchesDown` and the like), then the arena resolves it.
    if (this.#winner) {
      for (const member of this.#bubble) {
        for (const handler of this.#handlersOf(member)) {
          handler.touches(type, touch);
        }
      }
    }
    this.#resolve(type, touch);
  }

  // LynxGestureHandlerTrigger

  /**
   * resolveTouchEvent: hands a touch to the winner, which may change.
   */
  #resolve(type: TouchType, touch: TouchPoint): void {
    if (type === 'touchstart') {
      for (const member of this.#chain) this.#reset(member);
      this.#dispatch(type, touch, this.#winner, ORIGIN, true);
      this.#findNextWinner(type, touch);
      return;
    }
    if (type === 'touchmove') {
      this.#winner = this.#reCompete(this.#winner);
      if (this.#winner === this.#lastWinner) {
        this.#dispatch(type, touch, this.#winner, ORIGIN, false);
      }
      this.#findNextWinner(type, touch);
      return;
    }
    this.#dispatch(type, touch, this.#winner, ORIGIN, true);
    // A touch the browser canceled has no momentum to follow.
    const velocity = type === 'touchend' ? this.#velocity.velocity() : ORIGIN;
    const view = this.#pointer!.document.defaultView!;
    if (this.#winner && this.#flinger.start(velocity, view)) {
      this.#lastFlingWinner = this.#lastWinner;
      return;
    }
    this.#flinger.reset();
    this.#dispatch(null, null, this.#winner, FLING_END, true);
    if (this.#winner) this.#onFling();
  }

  /**
   * handleFling: one of the fling's frames.
   */
  #onFling(): void {
    const { distance, lastDistance, state } = this.#flinger;
    const step = {
      x: lastDistance.x - distance.x,
      y: lastDistance.y - distance.y,
    };
    this.#lastFlingWinner = this.#reCompete(this.#lastFlingWinner);
    this.#findNextWinner(null, null);
    if (!this.#winner || !this.#lastFlingWinner) {
      this.#lastFlingWinner = null;
      this.#flinger.stop();
      return;
    }
    if (state === 'end') {
      this.#dispatch(null, null, this.#lastFlingWinner, FLING_END, true);
    } else {
      this.#dispatch(null, null, this.#lastFlingWinner, step, false);
    }
  }

  /**
   * dispatchUIEventWithSimultaneousAndReCompete: hands an event to a
   * member's handlers and to the members simultaneous with the winner, then
   * (when `reCompete`) lets the winner change.
   */
  #dispatch(
    type: TouchType | null,
    touch: TouchPoint | null,
    member: Member | null,
    step: Point,
    reCompete: boolean,
  ): void {
    if (!member) return;
    for (const handler of this.#handlersOf(member)) {
      handler.handle(type, touch, step);
    }
    for (const other of this.#simultaneousMembers) {
      for (const handler of this.#handlersOf(other)) {
        handler.handle(type, touch, step);
      }
    }
    if (reCompete) this.#winner = this.#reCompete(this.#winner);
  }

  /**
   * findNextWinnerInBegin: while the winner keeps changing, hands the event
   * to each new one.
   */
  #findNextWinner(type: TouchType | null, touch: TouchPoint | null): void {
    for (let i = 0; i < this.#chain.length; i++) {
      if (this.#winner === this.#lastWinner || !this.#winner) return;
      this.#lastWinner = this.#winner;
      this.#updateSimultaneous(this.#winner);
      this.#dispatch(type, touch, this.#winner, ORIGIN, true);
    }
    this.#dispatch(type, touch, this.#lastWinner, ORIGIN, true);
  }

  /**
   * reCompeteByGestures: the winner while its gestures are still in play,
   * else the next member of the chain (after it, then before it) whose
   * gestures are, after resetting them. None once a gesture was ended from
   * code.
   */
  #reCompete(current: Member | null): Member | null {
    if (!current && !this.#lastWinner) return null;
    let lost = false;
    if (!current) {
      // On iOS, a touch whose winner lost goes back to it on the next event,
      // with its gestures reset.
      current = this.#lastWinner!;
      lost = true;
      this.#resetWithSimultaneous(current);
    }
    const state = this.#stateOf(current);
    if (state <= HandlerState.Active) return current;
    if (state === HandlerState.End || lost) return null;
    // The winner is always in the chain (it starts as its first member, and
    // only ever changes to another), so Lynx's checks for one that isn't, or
    // is in it twice, aren't needed.
    const index = this.#chain.indexOf(current);
    const next = [
      ...this.#chain.slice(index + 1),
      ...this.#chain.slice(0, index),
    ];
    // Lynx checks each member's state twice, before and after resetting it,
    // and gives up on one that was ended. The first check stays for what it
    // does (it resets an ended member and forgets the last winner), which is
    // also why the second never sees the member ended.
    return (
      next.find((member) => {
        this.#stateOf(member);
        this.#resetWithSimultaneous(member);
        return this.#stateOf(member) <= HandlerState.Active;
      }) ?? null
    );
  }

  /**
   * getCurrentMemberState: End when one of its gestures was ended (which
   * resets them all), Active when one is active (which fails the others it
   * isn't simultaneous with), else the least advanced of their states.
   */
  #stateOf(member: Member): HandlerState {
    const handlers = this.#handlersOf(member);
    if (!handlers.length) return HandlerState.Fail;
    let least: HandlerState = HandlerState.Undetermined;
    for (const handler of handlers) {
      if (handler.status === HandlerState.End) {
        this.#resetWithSimultaneous(member);
        this.#lastWinner = null;
        return HandlerState.End;
      }
      if (handler.status === HandlerState.Active) {
        for (const other of handlers) {
          if (
            other !== handler &&
            !this.#simultaneousIds.has(other.detector.id)
          ) {
            other.fail();
          }
        }
        return HandlerState.Active;
      }
      least = Math.min(least, handler.status) as HandlerState;
    }
    return least;
  }

  #reset(member: Member): void {
    for (const handler of this.#handlersOf(member)) handler.reset();
  }

  #resetWithSimultaneous(member: Member): void {
    this.#reset(member);
    for (const other of this.#simultaneousMembers) this.#reset(other);
  }

  // LynxGestureDetectorManager

  /**
   * convertResponseChainToCompeteChain: the touch's members in the order
   * they compete. A member whose first related gesture waits for an
   * ancestor's goes after that ancestor (and the chain ends there); one that
   * continues with other gestures is followed by their members only.
   */
  #competeChain(bubble: Member[]): Member[] {
    const chain: Member[] = [];
    for (const [index, member] of bubble.entries()) {
      // Lynx reads the relations of one gesture: the first, by ID, with any.
      const related = [...member.detectors.values()]
        .sort((a, b) => a.id - b.id)
        .find(
          (detector) => detector.waitFor.length + detector.continueWith.length,
        );
      const ahead = related
        ? this.#membersOf(related.waitFor).filter((other) =>
            bubble.slice(index + 1).includes(other),
          )
        : [];
      chain.push(...ahead, member);
      // A gesture waiting for no other member of the touch keeps none of its
      // relations, on iOS: not even its continueWith.
      if (related?.waitFor.length && !ahead.length) continue;
      if (related?.continueWith.length) {
        chain.push(...this.#membersOf(related.continueWith));
        break;
      }
      if (ahead.length) break;
    }
    return [...new Set(chain)];
  }

  #membersOf(ids: readonly number[]): Member[] {
    return [
      ...new Set(
        ids.flatMap((id) => [...(this.#gestureMembers.get(id) ?? [])]),
      ),
    ];
  }

  /**
   * handleSimultaneousWinner: the other members whose gestures the winner's
   * recognize simultaneously with, and which of the winner's own gestures
   * are simultaneous (and so don't fail each other).
   */
  #updateSimultaneous(winner: Member): void {
    this.#simultaneousMembers = new Set();
    this.#simultaneousIds = new Set();
    for (const detector of winner.detectors.values()) {
      for (const id of detector.simultaneous) {
        if (winner.detectors.has(id)) {
          this.#simultaneousIds.add(id);
          continue;
        }
        // The winner isn't among them: it would have had the gesture.
        for (const member of this.#gestureMembers.get(id) ?? []) {
          this.#simultaneousMembers.add(member);
        }
      }
    }
  }
}

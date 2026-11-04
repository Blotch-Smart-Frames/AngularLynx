/**
 * The listener registry behind the `document` and `window` stand-ins (see
 * global-events.ts): `addEventListener()`, `removeEventListener()` and
 * `dispatchEvent()` as a DOM EventTarget has them, for Lynx's main thread,
 * which has no EventTarget.
 *
 * Code written for the browser listens on these two objects without checking
 * they can be listened on: Angular's `document:`/`window:` host listeners,
 * RxJS's `fromEvent(document, …)`, and libraries that close a menu on a
 * `click` anywhere. So the registry keeps the DOM's rules, which such code
 * relies on: a listener added twice runs once, `once` and `signal` remove
 * it, an object's `handleEvent()` is called, a listener removed by an
 * earlier one doesn't run, and one that throws doesn't stop the others.
 */

/** A listener, as addEventListener takes it. */
export type EventListenerLike =
  | ((event: any) => unknown)
  | { handleEvent(event: any): unknown };

/** The third argument of addEventListener and removeEventListener. */
export type ListenerOptionsLike =
  | boolean
  | {
      capture?: boolean;
      once?: boolean;
      passive?: boolean;
      signal?: AbortSignalLike;
    };

type AbortSignalLike = {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
};

type Entry = {
  readonly callback: EventListenerLike;
  readonly capture: boolean;
  readonly once: boolean;
  /** Stops listening to the entry's abort signal. */
  unlinkSignal: (() => void) | null;
};

/** `Event.eventPhase`'s values. */
export const CAPTURING_PHASE = 1;
export const AT_TARGET = 2;
export const BUBBLING_PHASE = 3;

/**
 * What the listeners of one dispatch did to it, across the targets it goes
 * through.
 */
export type PropagationState = {
  stopped: boolean;
  stoppedImmediately: boolean;
};

const captureOf = (options: ListenerOptionsLike | undefined): boolean =>
  typeof options === 'boolean' ? options : !!options?.capture;

/**
 * Sets a property of an event object, whatever kind it is: a DOM Event's
 * `target` and `currentTarget` are getters on its prototype, which an own
 * property shadows.
 */
export const setEventProperty = (
  event: object,
  name: string,
  value: unknown,
): void => {
  Object.defineProperty(event, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
};

/**
 * Runs `run` with `values` set on `event`, then puts back what it had. On
 * Lynx for Web the event is the browser's, which goes on to the DOM's own
 * listeners after these have run (see web-source.ts), and they must see its
 * own `currentTarget`, `eventPhase` and methods. An event of the app's own
 * ends with no currentTarget and phase NONE, as a DOM event does.
 */
const withProperties = (
  event: object,
  values: Record<string, unknown>,
  run: () => void,
): void => {
  const saved = Object.keys(values).map(
    (name) => [name, Object.getOwnPropertyDescriptor(event, name)] as const,
  );
  for (const [name, value] of Object.entries(values)) {
    setEventProperty(event, name, value);
  }
  try {
    run();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(event, name, descriptor);
      else delete (event as Record<string, unknown>)[name];
    }
  }
};

/**
 * One object's listeners. `owner` is the object they're added to, which
 * listeners see as the event's `currentTarget`: the document stand-in is its
 * own, and the window's is `globalThis`.
 */
export class GlobalEventTarget {
  readonly #entries = new Map<string, Entry[]>();
  readonly #owner: object;
  /** Called when a type gets its first listener, and after its last goes. */
  #onTypesChange: () => void = () => {};

  constructor(owner?: object) {
    this.#owner = owner ?? this;
  }

  /**
   * @internal Called whenever the set of types with listeners changes, so
   * the events for them can be listened for (see global-events.ts).
   */
  set onTypesChange(callback: () => void) {
    this.#onTypesChange = callback;
  }

  addEventListener(
    type: string,
    callback: EventListenerLike | null | undefined,
    options?: ListenerOptionsLike,
  ): void {
    if (!callback) return;
    const capture = captureOf(options);
    const signal = typeof options === 'object' ? options.signal : undefined;
    if (signal?.aborted) return;
    const list = this.#entries.get(type) ?? [];
    // As the DOM does: the same listener, for the same phase, is added once.
    if (list.some((e) => e.callback === callback && e.capture === capture)) {
      return;
    }
    const entry: Entry = {
      callback,
      capture,
      once: typeof options === 'object' && !!options.once,
      unlinkSignal: null,
    };
    if (signal) {
      const abort = () => this.#remove(type, entry);
      signal.addEventListener('abort', abort);
      entry.unlinkSignal = () => signal.removeEventListener?.('abort', abort);
    }
    list.push(entry);
    this.#entries.set(type, list);
    if (list.length === 1) this.#onTypesChange();
  }

  removeEventListener(
    type: string,
    callback: EventListenerLike | null | undefined,
    options?: ListenerOptionsLike,
  ): void {
    const capture = captureOf(options);
    const entry = this.#entries
      .get(type)
      ?.find((e) => e.callback === callback && e.capture === capture);
    if (entry) this.#remove(type, entry);
  }

  /**
   * Dispatches `event` to this object's own listeners, as the DOM does for
   * an object with no parent. The document stand-in overrides it, since the
   * window is its parent.
   */
  dispatchEvent(event: any): boolean {
    return dispatchThrough(event, this.#owner, [this]);
  }

  /**
   * The types that have a listener.
   */
  get types(): string[] {
    return [...this.#entries.keys()];
  }

  hasListeners(type: string): boolean {
    return this.#entries.has(type);
  }

  /**
   * The object listeners are added to, which they see as currentTarget.
   */
  get owner(): object {
    return this.#owner;
  }

  /**
   * @internal Runs this object's listeners for `type` in `phase`: the
   * capturing ones in the capturing phase, the others in the bubbling one,
   * and both at the target, capturing first, as Chrome and Firefox do.
   * `type` is passed apart from the event, since a Lynx `tap` reaches the
   * listeners for `click`.
   */
  invoke(
    type: string,
    event: any,
    phase: number,
    state: PropagationState,
  ): void {
    const list = this.#entries.get(type);
    if (!list) return;
    const ordered =
      phase === AT_TARGET
        ? [...list.filter((e) => e.capture), ...list.filter((e) => !e.capture)]
        : list.filter((e) => e.capture === (phase === CAPTURING_PHASE));
    withProperties(
      event,
      { currentTarget: this.#owner, eventPhase: phase },
      () => this.#run(type, ordered, event, state),
    );
  }

  #run(
    type: string,
    entries: Entry[],
    event: any,
    state: PropagationState,
  ): void {
    for (const entry of entries) {
      // A listener an earlier one removed doesn't run, as in the DOM.
      if (!this.#entries.get(type)?.includes(entry)) continue;
      if (entry.once) this.#remove(type, entry);
      try {
        if (typeof entry.callback === 'function') {
          entry.callback.call(this.#owner, event);
        } else {
          entry.callback.handleEvent(event);
        }
      } catch (error) {
        // A browser reports a listener's error and runs the next one. The
        // error is thrown again outside the dispatch, so it reaches Lynx's
        // error reporting as an uncaught one does.
        queueMicrotask(() => {
          throw error;
        });
      }
      if (state.stoppedImmediately) break;
    }
  }

  #remove(type: string, entry: Entry): void {
    const list = this.#entries.get(type);
    const index = list?.indexOf(entry) ?? -1;
    if (!list || index < 0) return;
    list.splice(index, 1);
    entry.unlinkSignal?.();
    if (list.length > 0) return;
    this.#entries.delete(type);
    this.#onTypesChange();
  }
}

/**
 * One event's dispatch at `target` through `path`, the listening objects
 * from the target's side out (document, then window): capturing listeners
 * from the outside in, then the others from the inside out, if the event
 * bubbles. When the target is the first object of the path, as for
 * `dispatchEvent()`, its listeners run at the target, in the bubbling half.
 *
 * Otherwise the target is an element, and the event a screen event (see
 * global-events.ts), whose two halves run apart: the capturing one before
 * the elements' own listeners, and the bubbling one after them, as a
 * browser runs a document's listeners.
 *
 * `type` is the listeners' type, which defaults to the event's own.
 */
export class PathDispatch {
  readonly #event: any;
  readonly #target: object;
  readonly #path: GlobalEventTarget[];
  readonly #type: string;
  readonly #state: PropagationState;

  constructor(
    event: any,
    target: object,
    path: GlobalEventTarget[],
    type: string = event.type,
  ) {
    this.#event = event;
    this.#target = target;
    this.#path = path;
    this.#type = type;
    if (event.target == null) setEventProperty(event, 'target', target);
    this.#state = { stopped: false, stoppedImmediately: false };
  }

  /**
   * Runs `run` with the event's `stopPropagation()` and
   * `stopImmediatePropagation()` telling this dispatch when they're called.
   * They still call the event's own, which on Lynx for Web also stop the
   * browser's dispatch. Lynx's own event objects get theirs from the element
   * that heard them (see LynxElement's #dispatch).
   */
  #tracking(run: () => void): void {
    const event = this.#event;
    const state = this.#state;
    const stop = event.stopPropagation;
    const stopImmediately = event.stopImmediatePropagation;
    withProperties(
      event,
      {
        stopPropagation: () => {
          state.stopped = true;
          stop.call(event);
        },
        stopImmediatePropagation: () => {
          state.stopped = true;
          state.stoppedImmediately = true;
          stopImmediately.call(event);
        },
      },
      run,
    );
  }

  #phaseOf(index: number, outerPhase: number): number {
    return this.#path[index].owner === this.#target ? AT_TARGET : outerPhase;
  }

  /**
   * Runs the capturing listeners of the objects around the target.
   */
  capture(): void {
    this.#tracking(() => {
      for (let i = this.#path.length - 1; i >= 0; i--) {
        if (this.#state.stopped) return;
        const phase = this.#phaseOf(i, CAPTURING_PHASE);
        // At the target, both kinds run in bubble().
        if (phase === AT_TARGET) continue;
        this.#path[i].invoke(this.#type, this.#event, phase, this.#state);
      }
    });
  }

  /**
   * Runs the target's listeners, if it's in the path, then the bubbling
   * listeners around it. Returns false if a listener canceled the event, as
   * dispatchEvent does.
   */
  bubble(): boolean {
    const bubbles = this.#event.bubbles !== false;
    this.#tracking(() => {
      for (let i = 0; i < this.#path.length; i++) {
        if (this.#state.stopped) return;
        const phase = this.#phaseOf(i, BUBBLING_PHASE);
        if (phase === AT_TARGET || bubbles) {
          this.#path[i].invoke(this.#type, this.#event, phase, this.#state);
        }
      }
    });
    return !this.#event.defaultPrevented;
  }
}

/**
 * Dispatches `event` at `target` through `path` at once (see PathDispatch).
 */
export const dispatchThrough = (
  event: any,
  target: object,
  path: GlobalEventTarget[],
): boolean => {
  const dispatch = new PathDispatch(event, target, path);
  dispatch.capture();
  return dispatch.bubble();
};

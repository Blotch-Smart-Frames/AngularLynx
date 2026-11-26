import {
  type Injector,
  type Signal,
  DestroyRef,
  effect,
  ErrorHandler,
  inject,
  Injectable,
  InjectionToken,
  signal,
} from '@angular/core';
import { LynxNativeModule } from '../native-module/native-module';
import {
  type BackGestureEdge,
  type BackGestureFollower,
  BackGestures,
} from './back-gesture';

/**
 * The native module and global event of the Android app that
 * `ng build --platform android` makes (`ShellModule.kt` in
 * `packages/native/templates/android`).
 */
const SHELL_MODULE = 'AngularLynxShell';
const BACK_EVENT = 'angularLynxBack';
/**
 * Android's predictive back gesture as it goes, before it's back: sent as the
 * gesture starts, as the finger moves, and if it's canceled. Letting go so
 * back happens sends BACK_EVENT, as a press does.
 */
const BACK_GESTURE_EVENT = 'angularLynxBackGesture';

/** What the shell sends with BACK_GESTURE_EVENT. */
type BackGestureEvent = {
  readonly phase?: 'started' | 'progressed' | 'canceled';
  /** How far the gesture has gone, 0 to 1, as Android measures it. */
  readonly progress?: number;
  readonly edge?: BackGestureEdge;
};

type ShellModule = {
  setBackHandlerEnabled(enabled: boolean): unknown;
};

type GlobalEventEmitter = {
  addListener(name: string, listener: (...args: any[]) => void): unknown;
};

/** What a handler registered with {@link LynxBackButton.on} is. */
export type LynxBackHandler = () => void;

/**
 * Where back goes once no handler takes it: the router's history.
 * `provideRouter()` provides it, rather than LynxBackButton importing the
 * router, so an app without routes doesn't bundle one. Null when the app has
 * a `LocationStrategy` of its own, which can't say whether there's a screen
 * to go back to; without `provideRouter()` the token is missing.
 */
export const BACK_NAVIGATION = new InjectionToken<{
  /** Whether there's a screen to go back to. */
  readonly canGoBack: Signal<boolean>;
  /** Goes back a screen. */
  back(): void;
} | null>('back-navigation');

/**
 * The DestroyRef of whatever is being constructed, or null outside an
 * injection context. Angular has no public check for one, and `inject()`
 * throws outside it.
 */
const currentDestroyRef = (): DestroyRef | null => {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
};

/**
 * Hears the Android back button (and the back gesture), so that back closes
 * what's open on top, and otherwise goes back a screen, as the browser's back
 * button does in a web app.
 *
 * A press goes to the handler registered last with {@link on}, such as a
 * popover's while it's open. With none, the router goes back a screen
 * (`Location.back()`, so guards and resolvers run). On the router's first
 * screen, or without `provideRouter()`, back is Android's: it leaves the app.
 *
 * Android decides whether an app handles back when the gesture starts, before
 * JavaScript could answer, so the shell can't ask the app each time. Instead
 * back is Android's until the app enables the shell's handler, and while it's
 * enabled each press arrives as the `angularLynxBack` global event. This keeps
 * the handler enabled while a handler is registered or the router has a
 * screen to go back to.
 *
 * Android's predictive back gesture follows the finger: while nothing
 * registered with {@link on} takes back, a `<lynx-stack-outlet>` whose top
 * page back would leave moves the page with the gesture, as a finger
 * dragging it in the app does, and either finishes going back as the finger
 * lets go or brings the page back if the gesture is canceled.
 *
 * While an `<overlay>` shows, Android gives back to it instead, as its
 * `requestclose` event: a sheet or dialog in one closes on that.
 *
 * Other hosts (the iOS app, Lynx Explorer, the web preview) have no
 * `AngularLynxShell` module and never send the event, so nothing reaches the
 * handlers there.
 *
 * @usageNotes
 * ```typescript
 * export class SearchScreen {
 *   readonly searching = signal(false);
 *
 *   constructor() {
 *     const backButton = inject(LynxBackButton);
 *     effect((onCleanup) => {
 *       if (this.searching()) {
 *         onCleanup(backButton.on(() => this.searching.set(false)));
 *       }
 *     });
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxBackButton {
  /** The handlers, last registered last. */
  readonly #handlers = signal<readonly LynxBackHandler[]>([]);
  readonly #navigation = inject(BACK_NAVIGATION, { optional: true });
  readonly #errorHandler = inject(ErrorHandler);
  readonly #gestures = inject(BackGestures);
  /** What follows the back gesture in progress, if anything does. */
  #follower: BackGestureFollower | null = null;

  constructor() {
    const modules = inject(LynxNativeModule);

    // On the main thread, where Angular runs, both are proxies whose calls go
    // through the background thread and return promises. A host without the
    // module rejects the call, and then never gets another.
    const shell = modules.getNativeModule(SHELL_MODULE) as
      | ShellModule
      | undefined;
    let hasShell = true;
    effect(() => {
      const enabled =
        this.#handlers().length > 0 || (this.#navigation?.canGoBack() ?? false);
      if (!hasShell) return;
      Promise.resolve()
        .then(() => shell?.setBackHandlerEnabled(enabled))
        .catch(() => (hasShell = false));
    });

    const emitter =
      modules.getJSModule<GlobalEventEmitter>('GlobalEventEmitter');
    Promise.resolve()
      .then(() => {
        emitter?.addListener(BACK_EVENT, () => this.#press());
        emitter?.addListener(BACK_GESTURE_EVENT, (event?: BackGestureEvent) =>
          this.#gesture(event),
        );
      })
      .catch(() => {
        // Without a background thread there are no global events to hear.
      });
  }

  /**
   * Gives the back button's presses to `handler` until the function it
   * returns is called. Register one while something that back should close
   * is open, and remove it as that closes: while it's registered, back
   * doesn't leave the app or go back a screen.
   *
   * The handler registered last gets each press, so the one on top closes
   * first. Called from an injection context, such as a constructor, the
   * handler is removed when the component or service is destroyed; pass an
   * `injector` to tie it to another one.
   *
   * @param handler - Called on each press while it's the last registered.
   * @returns A function that removes the handler.
   */
  on(
    handler: LynxBackHandler,
    options?: { readonly injector?: Injector },
  ): () => void {
    /**
     * A function of its own each time, so registering one handler twice
     * makes two entries that each removal takes away separately.
     */
    const entry: LynxBackHandler = () => handler();
    this.#handlers.update((handlers) => [...handlers, entry]);
    const drop = () =>
      this.#handlers.update((handlers) => handlers.filter((h) => h !== entry));
    const unregister = (
      options?.injector?.get(DestroyRef) ?? currentDestroyRef()
    )?.onDestroy(drop);
    // Removed by hand, the handler also leaves the DestroyRef, which would
    // otherwise keep it, and what it holds, until a long-lived injector
    // goes. Angular's unregister ignores a callback that's already gone, so
    // removing twice is harmless.
    return () => {
      unregister?.();
      drop();
    };
  }

  #gesture(event: BackGestureEvent | undefined): void {
    try {
      switch (event?.phase) {
        case 'started':
          // A start without the last one's end: that one is over.
          this.#follower?.cancel();
          // What a handler closes doesn't follow the finger: the handler
          // hears back once it's done, as before. Nor does a gesture with
          // nowhere to go back to.
          this.#follower =
            this.#handlers().length === 0 && this.#navigation?.canGoBack()
              ? this.#gestures.start(event.edge === 'right' ? 'right' : 'left')
              : null;
          if (event.progress) this.#follower?.progress(event.progress);
          break;
        case 'progressed':
          this.#follower?.progress(event.progress ?? 0);
          break;
        case 'canceled': {
          const follower = this.#follower;
          this.#follower = null;
          follower?.cancel();
          break;
        }
      }
    } catch (error) {
      this.#follower = null;
      this.#errorHandler.handleError(error);
    }
  }

  #press(): void {
    const handlers = this.#handlers();
    const follower = this.#follower;
    this.#follower = null;
    try {
      // The gesture a stack followed ends there, where the page already is.
      // A handler registered meanwhile takes back from it.
      if (follower) {
        if (handlers.length === 0 && follower.commit()) return;
        follower.cancel();
      }
      if (handlers.length > 0) handlers[handlers.length - 1]();
      // The press can come just after the router's last screen went, while
      // the shell's handler is still enabled: there's nowhere to go then.
      else if (this.#navigation?.canGoBack()) this.#navigation.back();
    } catch (error) {
      this.#errorHandler.handleError(error);
    }
  }
}

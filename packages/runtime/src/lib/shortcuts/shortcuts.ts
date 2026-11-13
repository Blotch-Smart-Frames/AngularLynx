import {
  DestroyRef,
  ErrorHandler,
  inject,
  Injectable,
  InjectionToken,
  type Injector,
} from '@angular/core';
import { callOnBackground } from '../background-call';
import { LynxNativeModule } from '../native-module/native-module';

/**
 * The native module and global event of the apps `ng build --platform` makes
 * (`ShortcutsModule.swift` and `ShortcutsModule.kt` in
 * `packages/native/templates`).
 */
const SHORTCUTS_MODULE = 'AngularLynxShortcuts';
const SHORTCUT_EVENT = 'angularLynxShortcut';

/** A shortcut the person ran, as {@link LynxShortcuts.on} hands it over. */
export type LynxShortcut = {
  /** The shortcut's `id` in angular.json's `shortcuts`. */
  readonly id: string;
  /**
   * Its `route` there, if it has one. The router has already been told to
   * go to it.
   */
  readonly route?: string;
};

/** What a handler registered with {@link LynxShortcuts.on} is called with. */
export type LynxShortcutHandler = (shortcut: LynxShortcut) => void;

/** What the shell's `take` calls back with. */
type TakeResult = { readonly shortcuts?: readonly LynxShortcut[] };

type GlobalEventEmitter = {
  addListener(name: string, listener: () => void): unknown;
};

/**
 * Navigates to a shortcut's `route`. `provideRouter()` provides it, rather
 * than LynxShortcuts importing the router itself, so an app without routes
 * doesn't get the whole router in its bundle for it. Without
 * `provideRouter()` there's no router to navigate, and the token is missing.
 */
export const SHORTCUT_NAVIGATE = new InjectionToken<(route: string) => unknown>(
  'shortcut-navigate',
);

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
 * Hears the app's shortcuts: the things angular.json's `shortcuts` says the
 * app does, which the person runs from outside it.
 *
 * - **iOS:** by asking Siri with one of the shortcut's phrases, from
 *   Spotlight, or from the Shortcuts app, where it can go on the Action
 *   button or in an automation. iOS 16 and later.
 * - **Android:** from the menu a long press on the app's icon opens.
 *
 * Either way the phone brings the app to the front, starting it if it has
 * to, and then the shortcut arrives here. A shortcut with a `route` makes
 * the router navigate there, which needs no code. For anything else, such as
 * reloading what's on screen, register a handler with {@link on}.
 *
 * Only the apps `ng build --platform` and `ng serve --platform` make have
 * shortcuts. In Lynx Explorer and on the web, no shortcut ever arrives.
 *
 * @usageNotes
 * ```json
 * "shortcuts": [
 *   { "id": "refresh", "title": "Refresh", "phrases": ["Refresh {appName}"] },
 *   { "id": "photos", "title": "Show photos", "route": "/photos" }
 * ]
 * ```
 *
 * ```typescript
 * export class Feed {
 *   readonly posts = resource({ loader: loadPosts });
 *
 *   constructor() {
 *     inject(LynxShortcuts).on('refresh', () => this.posts.reload());
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxShortcuts {
  readonly #handlers = new Map<string, Set<LynxShortcutHandler>>();
  /** The shortcuts that ran before anything handled their ID, by ID. */
  readonly #unhandled = new Map<string, LynxShortcut[]>();
  readonly #navigate = inject(SHORTCUT_NAVIGATE, { optional: true });
  readonly #errorHandler = inject(ErrorHandler);

  constructor() {
    // The shell keeps each shortcut until it's taken, and sends the event
    // when one arrives. Listening before the first take means none is
    // missed: one that arrives in between is taken by whichever call comes
    // next, and one from before the app started, such as the shortcut that
    // launched it, by the first.
    //
    // On the main thread, where Angular runs, the emitter is a proxy whose
    // calls go through the background thread and return promises.
    const emitter =
      inject(LynxNativeModule).getJSModule<GlobalEventEmitter>(
        'GlobalEventEmitter',
      );
    void Promise.resolve()
      .then(() => emitter?.addListener(SHORTCUT_EVENT, () => void this.#take()))
      .catch(() => {
        // Without a background thread there are no global events to hear.
      })
      .then(() => this.#take());
  }

  /**
   * Calls `handler` each time the person runs the shortcut `id`.
   *
   * A shortcut that ran before anything handled its ID waits for the first
   * handler registered for it, which is called once the code registering it
   * has finished. That's how the shortcut that started the app reaches a
   * component created later, such as the screen its `route` leads to.
   *
   * Called from an injection context, such as a constructor, the handler is
   * removed when the component or service is destroyed; pass an `injector`
   * to tie it to another one. The function it returns removes it sooner.
   *
   * @param id - The shortcut's `id` in angular.json's `shortcuts`.
   * @param handler - Called with the shortcut each time it runs.
   * @returns A function that removes the handler.
   */
  on(
    id: string,
    handler: LynxShortcutHandler,
    options?: { readonly injector?: Injector },
  ): () => void {
    let handlers = this.#handlers.get(id);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(id, handlers);
    }
    handlers.add(handler);
    const remove = () => {
      handlers.delete(handler);
    };
    (options?.injector?.get(DestroyRef) ?? currentDestroyRef())?.onDestroy(
      remove,
    );

    const unhandled = this.#unhandled.get(id);
    if (unhandled) {
      this.#unhandled.delete(id);
      // After the caller has finished: a constructor that registers its
      // handler first hasn't yet set the fields the handler reads.
      queueMicrotask(() => {
        for (const shortcut of unhandled) {
          if (handlers.has(handler)) this.#call(handler, shortcut);
        }
      });
    }
    return remove;
  }

  /**
   * Asks the shell for the shortcuts that ran since the last time.
   */
  async #take(): Promise<void> {
    let result: TakeResult | undefined;
    try {
      // The module answers through a callback on the background thread,
      // where `NativeModules` lives (see callNativeModuleAsync in
      // background-call.ts).
      result = (await callOnBackground(
        'callNativeModuleAsync',
        SHORTCUTS_MODULE,
        'take',
        [],
      )) as TakeResult | undefined;
    } catch {
      // A host without the module, such as Lynx Explorer or the web, has no
      // shortcuts.
      return;
    }
    for (const shortcut of result?.shortcuts ?? []) {
      this.#run(shortcut);
    }
  }

  #run(shortcut: LynxShortcut): void {
    if (shortcut.route !== undefined) {
      try {
        this.#navigate?.(shortcut.route);
      } catch (error) {
        this.#errorHandler.handleError(error);
      }
    }
    const handlers = this.#handlers.get(shortcut.id);
    if (!handlers?.size) {
      const unhandled = this.#unhandled.get(shortcut.id) ?? [];
      unhandled.push(shortcut);
      this.#unhandled.set(shortcut.id, unhandled);
      return;
    }
    // A handler may remove itself as it's called: a Set skips what was
    // removed and carries on.
    for (const handler of handlers) {
      this.#call(handler, shortcut);
    }
  }

  /**
   * One handler's error mustn't keep the shortcut from the others.
   */
  #call(handler: LynxShortcutHandler, shortcut: LynxShortcut): void {
    try {
      handler(shortcut);
    } catch (error) {
      this.#errorHandler.handleError(error);
    }
  }
}

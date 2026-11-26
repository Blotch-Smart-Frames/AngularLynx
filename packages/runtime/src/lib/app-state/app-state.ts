import {
  afterNextRender,
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';

/**
 * Where the app is, as {@link LynxAppState.state} reports it:
 *
 * - `active`: in the foreground, taking touches.
 * - `inactive`: still on screen, or on its way on or off it, but not taking
 *   touches: Control Center or Notification Center is pulled over it, the
 *   app switcher is open, a call came in, or, on Android, another app's
 *   window has the focus in split screen or picture in picture.
 * - `background`: out of sight. Lynx pauses the app's timers and animations
 *   there, and the system may end it.
 */
export type LynxAppStateValue = 'active' | 'inactive' | 'background';

/**
 * The global prop the apps `ng build --platform` makes send the state in, with
 * the others, and send again each time it changes (`LynxViewController.swift`
 * and `MainActivity.kt` in `packages/native/templates`).
 *
 * A global prop rather than a global event, as the accessibility settings
 * are: the app reads the right state from its first line, and can't miss a
 * change that came before something listened. A global event reaches only
 * the listeners already there.
 */
const APP_STATE_PROP = 'appState';

const isAppState = (value: unknown): value is LynxAppStateValue =>
  value === 'active' || value === 'inactive' || value === 'background';

/**
 * The page's document, on Lynx for Web: its main thread runs in an iframe
 * while its elements belong to the page, so whether the app is in sight is the
 * page's visibility, not this realm's. Native Lynx has no document.
 */
const pageDocument = (): PageDocument | undefined => {
  if (!__WEB__ || typeof __GetPageElement !== 'function') return undefined;
  const page = __GetPageElement() as unknown as
    | { ownerDocument?: PageDocument }
    | undefined;
  return page?.ownerDocument ?? undefined;
};

/**
 * The part of the page's `document` this reads. The runtime builds without
 * the DOM's types, since Lynx has no DOM.
 */
type PageDocument = {
  readonly visibilityState?: string;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
};

/**
 * The web preview's state, from the page's visibility: `background` while its
 * tab is hidden or its window minimized, as the Page Visibility API reports,
 * and `active` otherwise. Undefined off the web, and until there's a page.
 *
 * The page doesn't exist until the root component is created, and an app
 * initializer, or a provider's factory, can inject this before that. So when
 * there's no page yet, it looks again after the first render, which comes
 * once there is.
 */
const watchPageVisibility = (
  destroyRef: DestroyRef,
): Signal<LynxAppStateValue | undefined> => {
  const state = signal<LynxAppStateValue | undefined>(undefined);
  if (!__WEB__) return state.asReadonly();
  const attach = (): void => {
    const document = pageDocument();
    if (typeof document?.visibilityState !== 'string') return;
    const update = () =>
      state.set(
        document.visibilityState === 'hidden' ? 'background' : 'active',
      );
    update();
    document.addEventListener?.('visibilitychange', update);
    destroyRef.onDestroy(() =>
      document.removeEventListener?.('visibilitychange', update),
    );
  };
  if (pageDocument()) {
    attach();
  } else {
    afterNextRender(attach);
  }
  return state.asReadonly();
};

/**
 * Whether the app is in the foreground, as signals, so an app can catch up
 * when it comes back: read again what isn't live, move a clock on, restart
 * an animation, or refresh a token. Lynx pauses timers in the background, and
 * nothing says how soon a paused timer fires once the app wakes.
 *
 * Lynx tells the app's code nothing about it, so the state comes from the
 * host app, in the `appState` global prop, as the accessibility settings do.
 * The apps `ng build --platform` makes send it, and send it again on each
 * change:
 *
 * - **iOS:** the scene's activation. `active` once it's active,
 *   `inactive` when it resigns (Control Center, Notification Center, the app
 *   switcher, a call), and `background` when it leaves the screen.
 * - **Android:** the activity's lifecycle. `active` from `onResume`,
 *   `inactive` from `onPause` (another window has the focus, as in split
 *   screen), and `background` from `onStop`.
 *
 * In the web preview it follows the page's visibility: `background` while the
 * tab is hidden, and `active` otherwise. Lynx Explorer sends no state, so the
 * app is always `active` there.
 *
 * Under the testing library, `setAppState()` sends the app to the
 * background and brings it back.
 *
 * @usageNotes
 * ```typescript
 * const appState = inject(LynxAppState);
 *
 * // Catch up the moment the app comes back, rather than whenever a paused
 * // timer fires.
 * effect(() => {
 *   if (appState.active()) untracked(() => this.#now.set(new Date()));
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxAppState {
  readonly #globalData = inject(LynxGlobalData);
  readonly #page = watchPageVisibility(inject(DestroyRef));

  /**
   * Where the app is: `active`, `inactive` or `background`. An app that
   * starts without a state from its host, as in Lynx Explorer, is `active`.
   */
  readonly state: Signal<LynxAppStateValue> = computed(() => {
    const sent = (this.#globalData.globalData() as Record<string, unknown>)[
      APP_STATE_PROP
    ];
    if (isAppState(sent)) return sent;
    return this.#page() ?? 'active';
  });

  /**
   * Whether the app is in the foreground and taking touches: `state()` is
   * `active`. It turns `false` as soon as the app stops taking them, before
   * it leaves the screen, and `true` again once it's back.
   */
  readonly active: Signal<boolean> = computed(() => this.state() === 'active');
}

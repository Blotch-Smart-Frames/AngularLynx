import {
  type ApplicationRef,
  Injectable,
  InjectionToken,
  type Signal,
  signal,
} from '@angular/core';
import { callOnBackground } from '../background-call';
import { afterNextFlush } from '../lynx-element/lynx-element';

/**
 * The native module of the apps `ng build --platform` makes (`ShellModule` in
 * `packages/native/templates`), whose `hideSplashScreen()` lets the launch
 * screen go.
 */
const SHELL_MODULE = 'AngularLynxShell';

/**
 * When {@link provideSplashScreen} hides the splash screen:
 *
 * - `'afterFirstNavigation'`: once the router's first navigation has ended,
 *   with its guards, resolvers and lazy routes, and its screen is drawn.
 * - `'manual'`: when the app calls {@link LynxSplashScreen.hide}.
 */
export type SplashScreenHide = 'afterFirstNavigation' | 'manual';

/**
 * Set by {@link provideSplashScreen}: the app says when the splash screen
 * goes. Without it, it goes at the first frame Angular commits.
 */
export const SPLASH_SCREEN_HIDE = new InjectionToken<SplashScreenHide>(
  'splash-screen-hide',
);

/**
 * The launch screen of the apps `ng build --platform` and
 * `ng serve --platform` make: angular.json's `splash`, an image on a color,
 * which the phone shows from the tap on the app's icon.
 *
 * The phone takes a launch screen down at the app's first frame, which would
 * be an empty screen: the app's first screen may have work to do before it
 * can draw, such as restoring a session or loading a lazy route. So the
 * shells keep it up until the app hides it here, and then fade it out. By
 * default that's at the first frame Angular commits; with
 * {@link provideSplashScreen}, after the router's first navigation, or when
 * the app calls {@link hide}. The shells hide it after five seconds anyway,
 * so a first screen that never settles can't leave the app behind its logo.
 *
 * Lynx Explorer and the web have no launch screen of the app's own, so there
 * `hide()` only changes {@link visible}, as it does in tests: a spec can
 * check that the app hid it.
 *
 * @usageNotes
 * ```typescript
 * export const appConfig: ApplicationConfig = {
 *   providers: [provideRouter(routes), provideSplashScreen({ hide: 'manual' })],
 * };
 *
 * export class App {
 *   readonly #splash = inject(LynxSplashScreen);
 *   readonly #session = inject(Session);
 *
 *   constructor() {
 *     this.#session.restore().finally(() => this.#splash.hide());
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxSplashScreen {
  readonly #visible = signal(true);

  /**
   * Whether the splash screen is still up: true until {@link hide} is
   * called, or the runtime hides it.
   */
  readonly visible: Signal<boolean> = this.#visible.asReadonly();

  /**
   * Fades the splash screen out, once what the app has drawn so far is on
   * screen under it. Calling it again does nothing.
   */
  hide(): void {
    if (!this.#visible()) return;
    this.#visible.set(false);
    // The testing library has no shell to ask, and its first render never
    // ends (it doesn't bootstrap through bootstrapApplication), so a wait for
    // the flush would never be over: the signal is all a spec can see.
    if ((globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv) return;
    // After the flush that carries the app's latest changes to native, so the
    // screen they make is there when the splash screen goes. The shells fade
    // it out over a quarter of a second, by which time native has drawn it.
    afterNextFlush(() => {
      // Through the background thread, where NativeModules lives. A host
      // without the module (Lynx Explorer, the web, a test) rejects the call:
      // it has no splash screen to hide.
      callOnBackground(
        'callModule',
        'native',
        SHELL_MODULE,
        'hideSplashScreen',
        [],
      ).catch(() => {});
    });
  }
}

/**
 * Hides the splash screen at the first frame Angular commits, unless the app
 * said when with {@link provideSplashScreen}. Called by bootstrapApplication
 * once the app is bootstrapped: the root component's first view is then in
 * the element tree, and goes to native with the next flush.
 */
export const hideSplashScreenUnlessProvided = (
  appRef: ApplicationRef,
): void => {
  if (appRef.injector.get(SPLASH_SCREEN_HIDE, null) !== null) return;
  // Optional for an app whose injector has no root scope, as a test's may
  // not: the service is `providedIn: 'root'`.
  appRef.injector.get(LynxSplashScreen, null)?.hide();
};

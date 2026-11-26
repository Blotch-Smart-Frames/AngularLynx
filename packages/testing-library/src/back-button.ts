/** What `LynxBackButton` calls and hears, named as the Android shell names them. */
const MODULE = 'AngularLynxShell';
const EVENT = 'angularLynxBack';

type FakeShellModule = {
  /** Whether the app has enabled the shell's back handler. */
  enabled: boolean;
  setBackHandlerEnabled(enabled: boolean): void;
};

type BackgroundGlobals = {
  NativeModules?: Record<string, unknown>;
  lynx?: {
    getJSModule?(name: string): { emit(name: string): void } | undefined;
  };
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: { readonly globalThis: BackgroundGlobals };
  switchToBackgroundThread(): void;
  switchToMainThread(): void;
};

/**
 * Gives the environment's background thread an `AngularLynxShell` module with
 * the Android shell's `setBackHandlerEnabled()`, so that {@link
 * pressBackButton} knows whether the app takes back, as Android does.
 * `LynxBackButton` reaches it through the background thread, as it reaches
 * the shell's module, so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so each test starts
 * with the handler off, as an app does. Only `NativeModules.AngularLynxShell`
 * is added: every other module stays as it was.
 */
export const installShellModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeShellModule = {
    enabled: false,
    setBackHandlerEnabled(enabled) {
      module.enabled = enabled;
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * Presses Android's back button, so a spec can check what the app does with
 * it: close what's open on top (a handler registered with
 * `LynxBackButton.on()`), or go back a screen through the router.
 *
 * As on Android, the press reaches the app only while the app has said it
 * takes back. Otherwise Android would leave the app, and nothing reaches it:
 * the call returns `false` then. The press reaches the app as it does on a
 * phone, through the background thread: wait for it with `waitForUpdate()`.
 *
 * An `<overlay>` takes back before the app does, on a phone: fire its
 * `requestclose` event for that instead.
 *
 * @example
 * ```ts
 * await render(Search);
 * fireEvent.tap(screen.getByText('Search'));
 * await waitForUpdate();
 * expect(pressBackButton()).toBe(true);
 * await waitForUpdate();
 * expect(screen.queryByText('Results')).toBeNull();
 * ```
 *
 * @returns Whether the app took the press: `false` when Android would have
 *   left the app.
 */
export const pressBackButton = (): boolean => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const background = env?.backgroundThread.globalThis;
  const module = background?.NativeModules?.[MODULE] as
    | FakeShellModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      "pressBackButton() needs the testing library's environment, which its setup file installs.",
    );
  }
  if (!module.enabled) return false;
  // What the shell sends while its handler is enabled. A global event
  // arrives on the background thread, and the listener there calls the
  // app's on the main thread through that thread's `lynx`, so the event is
  // sent from it. Specs run on the main thread, which comes back afterwards.
  env.switchToBackgroundThread();
  try {
    background?.lynx?.getJSModule?.('GlobalEventEmitter')?.emit(EVENT);
  } finally {
    env.switchToMainThread();
  }
  return true;
};

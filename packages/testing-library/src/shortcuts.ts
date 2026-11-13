/** What `LynxShortcuts` calls and hears, named as the shells name them. */
const MODULE = 'AngularLynxShortcuts';
const EVENT = 'angularLynxShortcut';

type Shortcut = { readonly id: string; readonly route?: string };

type FakeShortcutsModule = {
  readonly waiting: Shortcut[];
  take(done: (result: { shortcuts: Shortcut[] }) => void): void;
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
 * Gives the environment's background thread an `AngularLynxShortcuts` module,
 * as the apps `ng build --platform` makes have: it keeps the shortcuts
 * {@link runShortcut} runs until `LynxShortcuts` takes them. `LynxShortcuts`
 * reaches it through the background thread, as it reaches the shells' module,
 * so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so no shortcut is left
 * waiting for the next test. Only `NativeModules.AngularLynxShortcuts` is
 * added: every other module stays as it was.
 */
export const installShortcutsModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const waiting: Shortcut[] = [];
  const module: FakeShortcutsModule = {
    waiting,
    take: (done) => done({ shortcuts: waiting.splice(0) }),
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * Runs one of the app's shortcuts, as the person does by asking Siri or from
 * the app icon's menu, so a spec can check what the app does with it.
 *
 * A spec doesn't read angular.json's `shortcuts`, so the `id` only has to be
 * one the code under test handles with `LynxShortcuts.on()`, and a shortcut
 * that has a `route` there gets it here. The shortcut reaches the app as it
 * does on a phone, through the background thread: wait for it with
 * `waitForUpdate()`. Run before the app has injected `LynxShortcuts`, it
 * waits for it, as the shortcut that starts an app does.
 *
 * @example
 * ```ts
 * await render(Feed);
 * runShortcut('refresh');
 * await waitForUpdate();
 * expect(screen.getByText('Refreshed')).toBeInTheDocument();
 * ```
 *
 * @param id - The shortcut's `id` in angular.json's `shortcuts`.
 * @param options - `route`: the shortcut's `route` there, which the router
 *   navigates to.
 */
export const runShortcut = (
  id: string,
  options: { readonly route?: string } = {},
): void => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const background = env?.backgroundThread.globalThis;
  const module = background?.NativeModules?.[MODULE] as
    | FakeShortcutsModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      "runShortcut() needs the testing library's environment, which its setup file installs.",
    );
  }
  module.waiting.push({
    id,
    ...(options.route !== undefined && { route: options.route }),
  });
  // What the shells send when a shortcut arrives: LynxShortcuts answers by
  // taking the ones waiting. A global event arrives on the background
  // thread, and the listener there calls the app's on the main thread
  // through that thread's `lynx`, so the event is sent from it. Specs run on
  // the main thread, which comes back afterwards.
  env.switchToBackgroundThread();
  try {
    background?.lynx?.getJSModule?.('GlobalEventEmitter')?.emit(EVENT);
  } finally {
    env.switchToMainThread();
  }
};

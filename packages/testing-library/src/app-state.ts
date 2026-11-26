/**
 * Where the app is, as the runtime's `LynxAppState.state` reports it. Kept
 * here rather than imported, so the library's types don't reach into the
 * runtime's.
 */
export type AppState = 'active' | 'inactive' | 'background';

/**
 * The global prop the shells send the state in (see the runtime's
 * app-state.ts).
 */
const APP_STATE_PROP = 'appState';

type Thread = {
  readonly globalThis: { lynx: { __globalProps?: Record<string, unknown> } };
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly mainThread: Thread;
  readonly backgroundThread: Thread;
};

/**
 * Sends the app to the background, or brings it back, as the person does by
 * leaving the app and coming back to it, so a spec can check what the app
 * does on its return. `LynxAppState.state()` becomes `state`, and
 * `LynxAppState.active()` is `true` only for `'active'`.
 *
 * It reaches the app as it does on a phone, as a change to the host's global
 * props: change detection runs on its own, so wait for it with
 * `waitForUpdate()`. Each test starts `active`.
 *
 * @example
 * ```ts
 * await render(Schedule);
 * setAppState('background');
 * vi.setSystemTime(new Date('2026-01-02T09:00'));
 * setAppState('active');
 * await waitForUpdate();
 * expect(screen.getByText('Today: 2 January')).toBeInTheDocument();
 * ```
 *
 * @param state - `'background'` when the app leaves the screen, `'inactive'`
 *   while it's on screen but not taking touches (Control Center pulled over
 *   it, or a call coming in), and `'active'` when it's back.
 */
export const setAppState = (state: AppState): void => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  // The runtime's callback for the engine, which it puts on the global as it
  // loads: specs run on the main thread, whose globals the environment copies
  // there.
  const update = (globalThis as any).updateGlobalProps as
    | ((data: Record<string, unknown>) => void)
    | undefined;
  if (!env || typeof update !== 'function') {
    throw new Error(
      "setAppState() needs the testing library's environment, which its setup file installs, and the runtime, which render() loads.",
    );
  }
  // The background thread's props, as the engine keeps both threads'. The
  // environment gives each thread a `lynx`.
  const background = env.backgroundThread.globalThis.lynx;
  background.__globalProps = {
    ...background.__globalProps,
    [APP_STATE_PROP]: state,
  };
  // What the engine calls on the main thread, where the app runs, when the
  // host sends new global props: the runtime merges them and LynxGlobalData
  // hears them.
  update({
    ...env.mainThread.globalThis.lynx.__globalProps,
    [APP_STATE_PROP]: state,
  });
};

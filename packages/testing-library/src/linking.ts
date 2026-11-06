/**
 * A link the app opened with `LynxLinking`, as {@link openedURLs} lists it.
 */
export type OpenedURL = {
  /** The URL, as the app gave it. */
  readonly url: string;
  /**
   * Whether it opened in the browser sheet over the app (`openInApp()`)
   * rather than where the system opens it (`openURL()`).
   */
  readonly inApp: boolean;
};

/** What `LynxLinking` calls, named as the shells name their module. */
const MODULE = 'AngularLynxLinking';

type Done = (result: { value?: boolean }) => void;

type FakeLinkingModule = {
  readonly opened: OpenedURL[];
  openURL(url: string, done: Done): void;
  openInApp(url: string, request: unknown, done: Done): void;
  canOpenURL(url: string, done: Done): void;
};

/**
 * Gives the environment's background thread an `AngularLynxLinking` module,
 * as the apps `ng build --platform` makes have, which records each URL rather
 * than opening it. `LynxLinking` reaches it through the background thread, as
 * it reaches the shells' module, so specs see the runtime's own behavior:
 * `openURL()` and `openInApp()` resolve, and `canOpenURL()` resolves `true`.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so each test starts
 * with no URLs recorded. Only `NativeModules.AngularLynxLinking` is added:
 * every other module stays missing, as in Lynx Explorer.
 */
export const installLinkingModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const opened: OpenedURL[] = [];
  const module: FakeLinkingModule = {
    opened,
    openURL: (url, done) => {
      opened.push({ url, inApp: false });
      done({});
    },
    openInApp: (url, _request, done) => {
      opened.push({ url, inApp: true });
      done({});
    },
    canOpenURL: (_url, done) => done({ value: true }),
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * The links the app has opened with `LynxLinking` in this test, oldest
 * first, so a spec can check where a tap leads. Each test starts with none.
 *
 * @example
 * ```ts
 * fireEvent.tap(screen.getByText('Help'));
 * await waitForUpdate();
 * expect(openedURLs()).toEqual([
 *   { url: 'https://example.com/help', inApp: true },
 * ]);
 * ```
 */
export const openedURLs = (): readonly OpenedURL[] => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const module = (globalThis as any).lynxTestingEnv?.backgroundThread.globalThis
    .NativeModules?.[MODULE] as FakeLinkingModule | undefined;
  return [...(module?.opened ?? [])];
};

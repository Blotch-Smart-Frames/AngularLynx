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

/**
 * What `LynxLinking` calls and hears, named as the shells name their module
 * and global event.
 */
const MODULE = 'AngularLynxLinking';
const EVENT = 'angularLynxURL';

type Done = (result: { value?: boolean }) => void;

type FakeLinkingModule = {
  readonly opened: OpenedURL[];
  /** The links to the app {@link openLink} sent that aren't taken yet. */
  readonly waiting: string[];
  openURL(url: string, done: Done): void;
  openInApp(url: string, request: unknown, done: Done): void;
  canOpenURL(url: string, done: Done): void;
  takeURLs(done: (result: { urls: string[] }) => void): void;
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
 * Gives the environment's background thread an `AngularLynxLinking` module,
 * as the apps `ng build --platform` makes have, which records each URL rather
 * than opening it, and keeps the links to the app {@link openLink} sends
 * until `LynxLinking` takes them. `LynxLinking` reaches it through the
 * background thread, as it reaches the shells' module, so specs see the
 * runtime's own behavior: `openURL()` and `openInApp()` resolve, and
 * `canOpenURL()` resolves `true`.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so each test starts
 * with no URLs recorded and no link waiting. Only
 * `NativeModules.AngularLynxLinking` is added:
 * every other module stays missing, as in Lynx Explorer.
 */
export const installLinkingModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const opened: OpenedURL[] = [];
  const waiting: string[] = [];
  const module: FakeLinkingModule = {
    opened,
    waiting,
    openURL: (url, done) => {
      opened.push({ url, inApp: false });
      done({});
    },
    openInApp: (url, _request, done) => {
      opened.push({ url, inApp: true });
      done({});
    },
    canOpenURL: (_url, done) => done({ value: true }),
    takeURLs: (done) => done({ urls: waiting.splice(0) }),
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

/**
 * Opens the app with a link, as the person does by tapping a link with one of
 * angular.json's `deepLinkSchemes` while the app is open, so a spec can check
 * where it leads. With `provideRouter()`, the router navigates to the link's
 * route, and each `LynxLinking.onURL()` handler is called with the URL.
 *
 * The link reaches the app as it does on a phone, through the background
 * thread: wait for it with `waitForUpdate()`. Sent before the app listens,
 * it waits for the first handler, as a link that arrives while an app is
 * starting does. It's never the link that started the app:
 * `LynxLinking.getInitialURL()` stays `null`. Give that one to `render()` as
 * its `initialURL` option.
 *
 * @example
 * ```ts
 * await render(App, { providers: [provideRouter(routes)] });
 * openLink('myapp://orders/42');
 * await waitForUpdate();
 * expect(screen.getByText('Order 42')).toBeInTheDocument();
 * ```
 *
 * @param url - The whole URL, such as `myapp://orders/42?tab=items`.
 */
export const openLink = (url: string): void => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const background = env?.backgroundThread.globalThis;
  const module = background?.NativeModules?.[MODULE] as
    | FakeLinkingModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      "openLink() needs the testing library's environment, which its setup file installs.",
    );
  }
  module.waiting.push(url);
  // What the shells send when a link arrives: LynxLinking answers by taking
  // the ones waiting. A global event arrives on the background thread, and
  // the listener there calls the app's on the main thread through that
  // thread's `lynx`, so the event is sent from it. Specs run on the main
  // thread, which comes back afterwards.
  env.switchToBackgroundThread();
  try {
    background?.lynx?.getJSModule?.('GlobalEventEmitter')?.emit(EVENT);
  } finally {
    env.switchToMainThread();
  }
};

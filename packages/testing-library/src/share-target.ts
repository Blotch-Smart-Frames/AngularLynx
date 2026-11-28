/** What `LynxShareTarget` calls and hears, named as the shells name them. */
const MODULE = 'AngularLynxShareTarget';
const EVENT = 'angularLynxShare';

/** A share as the shells hand it to `LynxShareTarget`. */
type NativeShare = {
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
  readonly files: readonly {
    readonly base64: string;
    readonly name: string;
    readonly type: string;
  }[];
};

type FakeShareTargetModule = {
  readonly waiting: NativeShare[];
  take(done: (result: { shares: NativeShare[] }) => void): void;
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

/** What {@link receiveShare} shares to the app. */
export type FakeShare = {
  /** Text, such as a selection or a note. */
  readonly text?: string;
  /** A link, such as a page from the browser. */
  readonly url?: string;
  /** The share's subject, such as the page's title. */
  readonly title?: string;
  /**
   * Files, each a Blob with its name. The type is the Blob's, or
   * `application/octet-stream` when it has none.
   */
  readonly files?: readonly { readonly blob: Blob; readonly name: string }[];
};

/**
 * Gives the environment's background thread an `AngularLynxShareTarget`
 * module, as the apps `ng build --platform` makes with `shareTarget` have:
 * it keeps the shares {@link receiveShare} sends until `LynxShareTarget`
 * takes them. `LynxShareTarget` reaches it through the background thread, as
 * it reaches the shells' module, so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so no share is left
 * waiting for the next test. Only `NativeModules.AngularLynxShareTarget` is
 * added: every other module stays as it was.
 */
export const installShareTargetModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const waiting: NativeShare[] = [];
  const module: FakeShareTargetModule = {
    waiting,
    take: (done) => done({ shares: waiting.splice(0) }),
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * Bytes as base64, as the shells send a file's. 
 */
const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // In pieces: String.fromCharCode takes only so many arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/**
 * Shares to the app, as the person does by picking it in another app's
 * share sheet, so a spec can check what the app does with what it receives
 * through `LynxShareTarget.onShare()`.
 *
 * A spec doesn't read angular.json's `shareTarget`, so any text, link or
 * file arrives, whatever `mimeTypes` lists. The share reaches the app as it
 * does on a phone, through the background thread: await this, then wait for
 * it with `waitForUpdate()`. Sent before the app has registered a handler,
 * it waits for the first one, as the share that starts an app does.
 *
 * @example
 * ```ts
 * await render(Inbox);
 * await receiveShare({
 *   text: 'Read later',
 *   files: [{ blob: new Blob(['…'], { type: 'image/jpeg' }), name: 'photo.jpg' }],
 * });
 * await waitForUpdate();
 * expect(screen.getByText('photo.jpg')).toBeInTheDocument();
 * ```
 */
export const receiveShare = async (share: FakeShare): Promise<void> => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const background = env?.backgroundThread.globalThis;
  const module = background?.NativeModules?.[MODULE] as
    | FakeShareTargetModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      "receiveShare() needs the testing library's environment, which its setup file installs.",
    );
  }
  const files = await Promise.all(
    (share.files ?? []).map(async ({ blob, name }) => ({
      base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
      name,
      type: blob.type || 'application/octet-stream',
    })),
  );
  module.waiting.push({
    files,
    ...(share.title !== undefined && { title: share.title }),
    ...(share.text !== undefined && { text: share.text }),
    ...(share.url !== undefined && { url: share.url }),
  });
  // What the shells send when a share arrives: LynxShareTarget answers by
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

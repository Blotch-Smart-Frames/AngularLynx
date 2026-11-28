/** What `LynxBarcodeScanner` calls, named as the shells name their module. */
const MODULE = 'AngularLynxBarcodeScanner';

/** A code the fake scanner reads, as `LynxBarcodeScanner.scan()` resolves. */
export type QueuedBarcodeScan = {
  /** The kind of code, one of `@blotch/angular-lynx`'s `BarcodeFormat`s. */
  readonly format: string;
  /** What the code holds. */
  readonly value: string;
};

/** Why a scan read no code, as `BarcodeScannerError`'s `code` names it. */
export type BarcodeScanFailure = 'unavailable' | 'denied' | 'failed';

/** How a scan ends, as the shells' module calls back. */
type Answer =
  | { readonly format: string; readonly value: string }
  | { readonly error: string; readonly message?: string };

type Done = (answer: Answer) => void;

type FakeBarcodeScannerModule = {
  /** Answers given before a scan opened, for the next scans in turn. */
  readonly queued: Answer[];
  /** The open scan's callback, until it's answered. */
  open: Done | undefined;
  scan(request: unknown, done: Done): void;
};

type BackgroundGlobals = { NativeModules?: Record<string, unknown> };

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: { readonly globalThis: BackgroundGlobals };
  switchToBackgroundThread(): void;
  switchToMainThread(): void;
};

/**
 * Gives the environment's background thread an `AngularLynxBarcodeScanner`
 * module, as the apps `ng build --platform` makes with `permissions.camera`
 * have. There's no camera to point in a spec, so a scan stays open until
 * {@link queueBarcodeScan}, {@link cancelBarcodeScan} or
 * {@link failBarcodeScan} answers it, or ends at once with what one of them
 * queued before it opened. `LynxBarcodeScanner` reaches it through the
 * background thread, as it reaches the shells' module, so specs see the
 * runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's globals:
 * when it's created, and on the reset after each test, so each test starts
 * with no scan open and nothing queued. Only
 * `NativeModules.AngularLynxBarcodeScanner` is added: every other module
 * stays as it was.
 */
export const installBarcodeScannerModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeBarcodeScannerModule = {
    queued: [],
    open: undefined,
    scan(_request, done) {
      if (this.open) {
        done({ error: 'failed', message: 'A scan is already open.' });
        return;
      }
      const answer = this.queued.shift();
      if (answer) {
        done(answer);
        return;
      }
      this.open = done;
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

const answer = (name: string, result: Answer): void => {
  // Read through the environment rather than kept here: under `ng test`, the
  // setup file and the specs can load different copies of this module.
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const module = env?.backgroundThread.globalThis.NativeModules?.[MODULE] as
    | FakeBarcodeScannerModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      `${name}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  const open = module.open;
  if (!open) {
    module.queued.push(result);
    return;
  }
  module.open = undefined;
  // The shells call back on the background thread, which relays the answer
  // to the main thread, where specs run: it comes back afterwards.
  env.switchToBackgroundThread();
  try {
    open(result);
  } finally {
    env.switchToMainThread();
  }
};

/**
 * Has the scanner read `scan`, as if the person pointed the camera at it: the
 * open `LynxBarcodeScanner.scan()` resolves with it, or, when none is open,
 * the next one does as soon as it's called. Each call answers one scan, in
 * order. The answer reaches the app through the background thread, as on a
 * phone: wait for it with `waitForUpdate()`.
 *
 * @example
 * ```ts
 * await render(CheckIn);
 * queueBarcodeScan({ format: 'qr', value: 'TICKET-42' });
 * fireEvent.tap(screen.getByText('Scan ticket'));
 * await waitForUpdate();
 * expect(screen.getByText('Welcome, ticket 42')).toBeInTheDocument();
 * ```
 */
export const queueBarcodeScan = (scan: QueuedBarcodeScan): void =>
  answer('queueBarcodeScan', { format: scan.format, value: scan.value });

/**
 * Closes the scanner without a code, as the person does with Cancel: the open
 * `LynxBarcodeScanner.scan()`, or the next one, rejects with a
 * `BarcodeScannerError` whose code is `canceled`.
 */
export const cancelBarcodeScan = (): void =>
  answer('cancelBarcodeScan', {
    error: 'canceled',
    message: 'The scan was canceled.',
  });

/**
 * Ends the open `LynxBarcodeScanner.scan()`, or the next one, with a
 * `BarcodeScannerError` of `code`: `denied` for a person who doesn't let the
 * app use the camera, `unavailable` for a phone without a scanner, or
 * `failed`.
 */
export const failBarcodeScan = (
  code: BarcodeScanFailure,
  message?: string,
): void =>
  answer('failBarcodeScan', {
    error: code,
    ...(message !== undefined && { message }),
  });

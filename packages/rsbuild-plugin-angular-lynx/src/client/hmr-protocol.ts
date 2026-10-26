/**
 * The messages the two hot update clients exchange (hmr-background.ts and
 * hmr-main-thread.ts). They travel over Lynx's cross-thread event channel:
 * the background thread dispatches on `lynx.getCoreContext()` and the main
 * thread listens on `lynx.getJSContext()`, and the reverse. Each payload is a
 * JSON string, as in the runtime's other relays.
 */

/** Main → background: fetch a hot update file the main thread needs. */
export const HMR_FETCH = 'AngularLynx.HmrFetch';
/** Background → main: the fetched file, or why it couldn't be fetched. */
export const HMR_FETCH_RESULT = 'AngularLynx.HmrFetchResult';
/** Background → main: check for and apply the update to `hash`. */
export const HMR_CHECK = 'AngularLynx.HmrCheck';
/** Main → background: whether the main thread applied it. */
export const HMR_CHECK_RESULT = 'AngularLynx.HmrCheckResult';
/**
 * Main → background: an update the main thread took in can't be shown, so
 * reload the page. Sent by the stylesheet updater (css-hot-update.ts), which
 * runs after the update itself has already succeeded.
 */
export const HMR_RELOAD = 'AngularLynx.HmrReload';

export type FetchRequest = { id: number; url: string };
export type FetchResult =
  | { id: number; status: number; text: string }
  | { id: number; error: string };
export type CheckRequest = { id: number; hash: string };
export type ReloadRequest = { reason: string };
/** Whether the main thread applied an update, and if not, why. */
export type CheckOutcome =
  | { ok: true; updatedModules: number }
  | { ok: false; reason: string };
export type CheckResult = { id: number } & CheckOutcome;

/** A thread's end of the cross-thread event channel. */
export type ThreadContext = {
  addEventListener(
    type: string,
    listener: (event: { data: string }) => void,
  ): void;
  dispatchEvent(event: { type: string; data: string }): void;
};

/** The parts of webpack's `module.hot` API the clients use. */
export type HotApi = {
  check(autoApply: true): Promise<(string | number)[] | null>;
  status(): string;
};

export const send = (
  context: ThreadContext,
  type: string,
  message: object,
): void => {
  context.dispatchEvent({ type, data: JSON.stringify(message) });
};

export const listen = <T>(
  context: ThreadContext,
  type: string,
  listener: (message: T) => void,
): void => {
  context.addEventListener(type, (event) =>
    listener(JSON.parse(event.data) as T),
  );
};

/**
 * An error as text for the logs, with its stack. PrimJS, which runs the main
 * thread, leaves the name and message out of `error.stack`, so they're added
 * when the stack doesn't start with them.
 */
export const formatError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const heading = `${error.name}: ${error.message}`;
  if (!error.stack) return heading;
  return error.stack.startsWith(heading)
    ? error.stack
    : `${heading}\n${error.stack}`;
};

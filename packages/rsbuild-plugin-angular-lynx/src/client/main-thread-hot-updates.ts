import {
  type CheckOutcome,
  type CheckRequest,
  type CheckResult,
  type FetchRequest,
  type FetchResult,
  formatError,
  HMR_CHECK,
  HMR_CHECK_RESULT,
  HMR_FETCH,
  HMR_FETCH_RESULT,
  type HotApi,
  listen,
  send,
  type ThreadContext,
} from './hmr-protocol.js';

/** Lynx's `requireModuleAsync`, which the hot update runtime loads with. */
type RequireModuleAsync = (
  url: string,
  callback: (
    error: (Error & { code?: string }) | null,
    exports?: unknown,
  ) => void,
) => void;

export type MainThreadHotUpdatesOptions = {
  /** The main thread's `import.meta.webpackHot`. */
  hot: HotApi;
  /** The main thread's `lynx` global. */
  lynx: { requireModuleAsync?: RequireModuleAsync };
  /** Lynx's `getJSContext()`, which reaches the background thread. */
  context: ThreadContext;
  /**
   * Where `bootstrapApplication()` leaves its latest promise. Read through a
   * function because each call replaces it.
   */
  currentBootstrap: () => unknown;
  /** Whether an app is running: the last bootstrap succeeded. */
  appRunning: () => boolean;
};

/**
 * Runs a hot update chunk, which webpack emits as a CommonJS module, and
 * returns its exports. The main thread runs the code it gets this way the
 * same way React Lynx's runtime evaluates the snapshots its hot updates send
 * it: PrimJS evaluates code at runtime in development builds.
 */
const evaluateChunk = (source: string, url: string): unknown => {
  const module = { exports: {} };
  // The source URL names the chunk in the stack traces of its modules.
  // oxlint-disable-next-line no-new-func
  new Function('module', 'exports', `${source}\n//# sourceURL=${url}`)(
    module,
    module.exports,
  );
  return module.exports;
};

/**
 * Applies the main thread's half of each hot update, when the background
 * thread asks (see background-hot-updates.ts).
 *
 * Webpack's hot update runtime is already in the main-thread bundle, with
 * `module.hot` on every module, but nothing ever asked it to check, and it
 * loads updates with `lynx.requireModuleAsync()`, which the main thread
 * doesn't have. This gives the main thread one that has the background
 * thread fetch the file (only it has network access) and runs it here, then
 * runs the checks.
 *
 * After an update, it waits for the app to bootstrap again if the update
 * re-ran the app's entry: the old app is gone by then, so a failure has to
 * reload the page rather than leave it blank. It reports failure too when no
 * app is running at all.
 */
export const startMainThreadHotUpdates = ({
  hot,
  lynx,
  context,
  currentBootstrap,
  appRunning,
}: MainThreadHotUpdatesOptions): void => {
  const fetches = new Map<number, (result: FetchResult) => void>();
  let nextFetchId = 0;
  listen<FetchResult>(context, HMR_FETCH_RESULT, (result) => {
    fetches.get(result.id)?.(result);
    fetches.delete(result.id);
  });

  lynx.requireModuleAsync ??= (url, callback) => {
    const id = nextFetchId++;
    fetches.set(id, (result) => {
      if ('error' in result) {
        callback(new Error(`Loading ${url} failed: ${result.error}`));
        return;
      }
      if (result.status === 404) {
        // The hot update runtime treats a missing manifest as "no update"
        // only when the error says so, like Lynx's own requireModuleAsync.
        const error: Error & { code?: string } = new Error(
          `Cannot find module '${url}'`,
        );
        error.code = 'MODULE_NOT_FOUND';
        callback(error);
        return;
      }
      if (result.status >= 400) {
        callback(new Error(`Loading ${url} failed with HTTP ${result.status}`));
        return;
      }
      let exports: unknown;
      try {
        exports = url.endsWith('.json')
          ? JSON.parse(result.text)
          : evaluateChunk(result.text, url);
      } catch (error) {
        callback(error as Error);
        return;
      }
      callback(null, exports);
    });
    send(context, HMR_FETCH, { id, url } satisfies FetchRequest);
  };

  const apply = async (): Promise<CheckOutcome> => {
    const status = hot.status();
    if (status !== 'idle') {
      return { ok: false, reason: `The hot update status is "${status}".` };
    }
    const bootstrapBefore = currentBootstrap();
    try {
      const updatedModules = await hot.check(true);
      if (!updatedModules) {
        return { ok: false, reason: 'Cannot find update.' };
      }
      const bootstrap = currentBootstrap();
      if (bootstrap !== bootstrapBefore) await bootstrap;
      if (!appRunning()) {
        // The page loaded code that failed to start the app, so the modules
        // an update would replace never finished running. Applying it
        // changes nothing on screen; a reload starts the fixed code.
        return { ok: false, reason: 'The app is not running.' };
      }
      return { ok: true, updatedModules: updatedModules.length };
    } catch (error) {
      return { ok: false, reason: formatError(error) };
    }
  };

  listen<CheckRequest>(context, HMR_CHECK, ({ id }) => {
    void apply().then((result) =>
      send(context, HMR_CHECK_RESULT, { id, ...result } satisfies CheckResult),
    );
  });
};

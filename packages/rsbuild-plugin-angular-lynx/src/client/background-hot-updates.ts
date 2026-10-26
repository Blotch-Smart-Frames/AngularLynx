import {
  type CheckRequest,
  type CheckResult,
  type FetchRequest,
  type FetchResult,
  formatError,
  HMR_CHECK,
  HMR_CHECK_RESULT,
  HMR_FETCH,
  HMR_FETCH_RESULT,
  HMR_RELOAD,
  type HotApi,
  listen,
  type ReloadRequest,
  send,
  type ThreadContext,
} from './hmr-protocol.js';

/**
 * How long the background thread waits for the main thread to apply an
 * update. A main thread without the client, or one stuck in a module that
 * never returns, would otherwise block every later update.
 */
export const MAIN_THREAD_TIMEOUT_MS = 60_000;

type Log = (level: 'info' | 'warning', message: string) => void;

export type BackgroundHotUpdatesOptions = {
  /** The background thread's `import.meta.webpackHot`. */
  hot: HotApi;
  /** Where the dev transport announces each new build's hash. */
  emitter: {
    on(event: 'webpackHotUpdate', listener: (hash: string) => void): void;
  };
  /** The hash of the code the background thread runs, `__webpack_hash__`. */
  currentHash: () => string;
  /** Lynx's `getCoreContext()`, which reaches the main thread. */
  context: ThreadContext;
  fetch: (url: string) => Promise<{ status: number; text(): Promise<string> }>;
  /** Reloads the whole page, through Lynx DevTool. */
  reloadPage: () => void;
  log: Log;
  logApplyResult: (
    updatedModules: (string | number)[],
    renewedModules: (string | number)[],
  ) => void;
};

/**
 * Applies hot updates on both threads, replacing `@rspack/core/hot/dev-server`
 * on the background thread.
 *
 * Webpack's hot update client runs on the background thread, where the dev
 * server's connection is, and only updates the code there. But on Lynx the
 * app runs on the main thread, which has no network access of its own (its
 * `fetch` is the runtime's relay to this thread). So for each new
 * build this:
 *
 * 1. applies the update on the background thread, which registers the
 *    updated modules' background functions again;
 * 2. asks the main thread to apply its own half of the update (see
 *    main-thread-hot-updates.ts), and fetches the files it needs for it;
 * 3. falls back to a full page reload if either thread can't apply it, so the
 *    screen never keeps showing old code.
 *
 * The background thread goes first so that a background function the updated
 * app calls straight away is already the new one.
 */
export const startBackgroundHotUpdates = ({
  hot,
  emitter,
  currentHash,
  context,
  fetch,
  reloadPage,
  log,
  logApplyResult,
}: BackgroundHotUpdatesOptions): void => {
  listen<FetchRequest>(context, HMR_FETCH, ({ id, url }) => {
    fetch(url)
      .then(async (response) => ({
        id,
        status: response.status,
        text: await response.text(),
      }))
      .catch((error: unknown) => ({ id, error: formatError(error) }))
      .then((result: FetchResult) => send(context, HMR_FETCH_RESULT, result));
  });

  const checks = new Map<number, (result: CheckResult) => void>();
  let nextCheckId = 0;
  listen<CheckResult>(context, HMR_CHECK_RESULT, (result) => {
    checks.get(result.id)?.(result);
  });

  const checkMainThread = (hash: string): Promise<CheckResult> => {
    const id = nextCheckId++;
    return new Promise<CheckResult>((resolve) => {
      const timer = setTimeout(
        () =>
          finish({
            id,
            ok: false,
            reason: `The main thread didn't apply the update within ${MAIN_THREAD_TIMEOUT_MS / 1000}s.`,
          }),
        MAIN_THREAD_TIMEOUT_MS,
      );
      const finish = (result: CheckResult) => {
        clearTimeout(timer);
        checks.delete(id);
        resolve(result);
      };
      checks.set(id, finish);
      send(context, HMR_CHECK, { id, hash } satisfies CheckRequest);
    });
  };

  const fullReload = (reason: string) => {
    log('warning', '[HMR] Cannot apply update. Need to do a full reload!');
    log('warning', `[HMR] ${reason}`);
    reloadPage();
  };
  listen<ReloadRequest>(context, HMR_RELOAD, ({ reason }) =>
    fullReload(`Main thread: ${reason}`),
  );

  // The hash of the newest build the dev transport announced.
  let lastHash = '';
  let checking = false;
  const upToDate = () => lastHash.includes(currentHash());

  const check = async (): Promise<void> => {
    const hash = lastHash;
    let updatedModules: (string | number)[] | null;
    try {
      updatedModules = await hot.check(true);
    } catch (error) {
      // `abort` and `fail` are terminal: this thread can never apply another
      // update, so only a reload brings it back. Other errors leave both
      // threads on the old build, which is still consistent.
      const status = hot.status();
      if (status === 'abort' || status === 'fail') {
        fullReload(formatError(error));
      } else {
        log('warning', `[HMR] Update failed: ${formatError(error)}`);
      }
      return;
    }
    if (!updatedModules) {
      // Usually because the dev server restarted, so it doesn't have the
      // update from the hash this page runs.
      fullReload('Cannot find update.');
      return;
    }
    const mainThread = await checkMainThread(hash);
    if (!mainThread.ok) {
      fullReload(`Main thread: ${mainThread.reason}`);
      return;
    }
    logApplyResult(updatedModules, updatedModules);
    if (!upToDate()) {
      await check();
      return;
    }
    log('info', '[HMR] App is up to date.');
  };

  emitter.on('webpackHotUpdate', (hash) => {
    lastHash = hash;
    if (upToDate() || checking || hot.status() !== 'idle') return;
    log('info', '[HMR] Checking for updates on the server...');
    checking = true;
    void check().finally(() => {
      checking = false;
    });
  });
  log('info', '[HMR] Waiting for update signal from WDS...');
};

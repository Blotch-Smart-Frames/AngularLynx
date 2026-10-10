declare const __MAIN_THREAD__: boolean;

/**
 * The lazy-bundle import mode the chunk-loading runtime passes through from
 * `import(..., { with: { mode } })`. Only FetchBundle (engine 3.9+) can honor it.
 */
type LazyBundleMode = 'sync' | 'async';

/** The QueryComponent callback payload (`detail.schema` is the bundle URL). */
type QueryComponentResult = {
  code: number;
  detail: { schema: string };
};

/**
 * The parts of the background-thread `lynx` global the loader uses. They are
 * not all declared in `@lynx-js/types` (e.g. `getDynamicComponentExports`), so
 * they're typed here rather than reaching for `any` at each call site.
 */
type BackgroundLynx = {
  QueryComponent?: (
    source: string,
    callback: (result: QueryComponentResult) => void,
  ) => void;
  getNativeLynx(): {
    QueryComponent(
      source: string,
      callback: (result: QueryComponentResult) => void,
    ): void;
  };
  getApp(): { getDynamicComponentExports(schema: string): unknown };
};

type LoadLazyBundle = (
  source: string,
  mode?: LazyBundleMode,
) => Promise<unknown>;

/**
 * Installs `lynx.loadLazyBundle`, the hook Lynx's chunk-loading runtime calls
 * for every async chunk (each `loadComponent()` route and `@defer` block).
 *
 * Since rspeedy 0.17 the Lynx build engine encodes async chunks as lazy
 * bundles (`lazy-bundle/*.bundle`) and its `ChunkLoadingWebpackPlugin` runtime
 * loads them through `lynx.loadLazyBundle(url, mode, host)`. The platform does
 * not provide that function — the framework does (React Lynx installs it from
 * `@lynx-js/react`'s `core/lynx/lazy-bundle.ts`). Without it every dynamic
 * import throws `lynx.loadLazyBundle is not a function`.
 *
 * This is a port of React Lynx's QueryComponent loader, which is what React
 * uses for the default `engineVersion` (below 3.9, where FetchBundle is
 * unavailable) — the same default this plugin's `targetSdkVersion` uses.
 *
 * Calling it again (HMR re-bootstraps call `bootstrapApplication` a second
 * time) is safe: it only reassigns the same stateless function.
 */
export const installLazyBundleLoader = (): void => {
  const host = lynx as unknown as { loadLazyBundle?: LoadLazyBundle };
  host.loadLazyBundle = loadLazyBundleWithQueryComponent;
};

/**
 * Dispatches by thread, because each thread has a different native API: the
 * main thread evaluates synchronously via `__QueryComponent`, the background
 * thread loads asynchronously via `lynx.QueryComponent`.
 *
 * The chunk-loading runtime also passes a third `host` argument. It is
 * deliberately ignored: it only routes FetchBundle's main-thread prepare step
 * to the right host, and QueryComponent has no such step.
 */
const loadLazyBundleWithQueryComponent: LoadLazyBundle = (source, mode) => {
  if (__MAIN_THREAD__) {
    return loadOnMainThread(source);
  }
  return loadOnBackgroundThread(source, mode);
};

/**
 * Main thread: `__QueryComponent` evaluates the bundle synchronously. The
 * returned promise gets a synchronous `then` so first-screen rendering can use
 * the module in the same tick — the main thread renders exactly once, so an
 * async resolution would arrive after the first screen is already committed.
 */
const loadOnMainThread = (source: string): Promise<unknown> => {
  let result: unknown;
  try {
    // The native PAPI ignores the callback on the main thread; it's only part
    // of the shared signature.
    result = __QueryComponent(source, () => {}).evalResult;
  } catch {
    // A rejected promise here would surface as an unhandled rejection (an
    // error overlay) for something the main thread can't recover from anyway. A
    // never-settling promise matches React Lynx: the lazy content simply isn't
    // part of the first screen, and the background thread loads it instead.
    return new Promise(() => {});
  }
  return syncResolved(result);
};

/**
 * Background thread: `QueryComponent` fetches and evaluates the bundle, then
 * the exports are read back by schema. A cached bundle calls back
 * synchronously, in which case the result is also handed back with a sync
 * `then` (as React Lynx does) so already-loaded routes don't pay a microtask.
 */
const loadOnBackgroundThread = (
  source: string,
  mode: LazyBundleMode | undefined,
): Promise<unknown> => {
  if (__DEV__ && mode !== undefined) {
    // Same guard as React Lynx: honoring `mode` needs FetchBundle, so silently
    // ignoring it would load a `sync` import asynchronously.
    throw new Error(
      `Lazy bundle import \`mode: '${mode}'\` requires FetchBundle, but the current build uses QueryComponent.`,
    );
  }

  const bgLynx = lynx as unknown as BackgroundLynx;
  // QueryComponent may invoke the callback synchronously (bundle already
  // cached) or later (bundle still downloading), and we can't tell which up
  // front. So the callback records a synchronous outcome in
  // `syncResult`/`syncError`, and only once QueryComponent has returned without
  // calling back do we create a pending promise and hand its resolvers to
  // `settle`. The callback fires at most once, so exactly one of these paths
  // runs.
  let settle: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  } | null = null;
  let syncResult: { value: unknown } | null = null;
  let syncError: Error | null = null;

  const callback = (result: QueryComponentResult): void => {
    const { code, detail } = result;
    if (code === 0) {
      const exports = bgLynx.getApp().getDynamicComponentExports(detail.schema);
      // `code === 0` only means the bundle parsed; its JS may still have
      // thrown, in which case there are no exports to hand back.
      if (exports) {
        if (settle) {
          settle.resolve(exports);
        } else {
          syncResult = { value: exports };
        }
        return;
      }
    }
    const error = new Error(
      'Lazy bundle load failed, schema: ' + result.detail.schema,
    );
    // ES5 targets have no `new Error(message, { cause })`, so assign it.
    (error as Error & { cause?: unknown }).cause = JSON.stringify(result);
    if (settle) {
      settle.reject(error);
    } else {
      syncError = error;
    }
  };

  // web-core exposes QueryComponent directly on the `lynx` global, while the
  // native background runtime exposes it on the native Lynx object. React Lynx
  // uses the same fallback.
  if (typeof bgLynx.QueryComponent === 'function') {
    bgLynx.QueryComponent(source, callback);
  } else {
    bgLynx.getNativeLynx().QueryComponent(source, callback);
  }

  if (syncResult !== null) {
    // The cast is needed because TypeScript can't see that the callback above
    // assigned `syncResult`, so it still narrows the variable to `null` here.
    return syncResolved((syncResult as { value: unknown }).value);
  }
  if (syncError !== null) {
    return Promise.reject(syncError);
  }
  return new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
};

/**
 * A resolved promise whose `then` runs its callback synchronously, so a chain
 * like `import('./x').then(m => m.Foo)` yields its value in the same tick.
 * Port of React Lynx's `makeSyncThen`.
 */
const syncResolved = <T>(value: T): Promise<T> => {
  const promise = Promise.resolve(value) as Promise<T>;
  // A sync `then` on a real promise is the point here (see above), so the
  // rule against adding `then` doesn't apply.
  // oxlint-disable-next-line unicorn/no-thenable
  promise.then = makeSyncThen(value) as unknown as Promise<T>['then'];
  return promise;
};

/**
 * Builds the synchronous `then` used by `syncResolved` (a port of React Lynx's
 * `makeSyncThen`).
 *
 * There is no `onRejected` parameter because the value is already resolved, so
 * a rejection handler could never run. A missing `onFulfilled` returns another
 * sync-resolved promise so further chaining stays synchronous. A throwing
 * callback becomes a normal rejected promise, matching native `then`.
 */
const makeSyncThen =
  <T>(value: T) =>
  <R>(onFulfilled?: ((value: T) => R | PromiseLike<R>) | null) => {
    if (!onFulfilled) {
      return syncResolved(value);
    }
    let next: R | PromiseLike<R>;
    try {
      next = onFulfilled(value);
    } catch (e) {
      return Promise.reject(e as Error);
    }
    // A thenable returned from the chain can't be made synchronous; hand it
    // back as-is (on the main thread its callback never fires, as in React).
    if (next && typeof (next as PromiseLike<R>).then === 'function') {
      return next as Promise<R>;
    }
    return syncResolved(next as R);
  };

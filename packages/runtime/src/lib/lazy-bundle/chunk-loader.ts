declare const __MAIN_THREAD__: boolean;

/**
 * The sections a lazy bundle is built in (LynxTemplatePlugin with
 * `lazyBundleFetcher: 'FetchBundle'`, which the build plugin sets with
 * `experimental_isLazyBundle`).
 */
const SECTION_MAIN_THREAD = 'main-thread';
const SECTION_BACKGROUND = 'background';
const SECTION_CSS = 'CSS';

/** What `lynx.fetchBundle()` answers with once the bundle is loaded, or not. */
type FetchBundleResponse = {
  code: number;
  url: string;
};

/**
 * `lynx.fetchBundle()`'s handler. Native calls `then`'s callback on the
 * thread that asked, once the bundle has downloaded, or at once if it already
 * had; Lynx for Web's handler is a promise.
 */
type ResponseHandler = {
  then(callback: (response: FetchBundleResponse) => void): unknown;
};

/**
 * The parts of the `lynx` global the loader uses, on either thread. Lynx has
 * had them since 3.9 (`loadScript` since 3.7). `__LoadStyleSheet` and
 * `__AdoptStyleSheet` are main-thread globals of native Lynx only.
 */
type FetchBundleLynx = {
  fetchBundle?: (url: string, options: object) => ResponseHandler;
  loadScript<T>(sectionName: string, options: { bundleName: string }): T;
};

type StyleSheetGlobals = {
  __LoadStyleSheet?: (sectionName: string, bundleUrl: string) => object | null;
  __AdoptStyleSheet?: (styleSheet: object) => void;
};

type LoadLazyBundle = (source: string) => Promise<unknown>;

/**
 * Installs `lynx.loadLazyBundle`, the hook Lynx's chunk-loading runtime calls
 * for every async chunk (each `loadComponent()` route and `@defer` block) when
 * the app builds with `experimental_isLazyBundle`.
 *
 * The chunk-loading runtime loads each lazy bundle through
 * `lynx.loadLazyBundle(url, mode, host)` and installs the chunk the promise
 * resolves with. The platform doesn't provide that function: the framework
 * does (React Lynx installs it from `@lynx-js/react`'s
 * `core/lynx/lazy-bundle.ts`).
 *
 * Calling it again (HMR re-bootstraps call `bootstrapApplication` a second
 * time) is safe: it only reassigns the same stateless function.
 */
export const installLazyBundleLoader = (): void => {
  const host = lynx as unknown as { loadLazyBundle?: LoadLazyBundle };
  host.loadLazyBundle = loadLazyBundleWithFetchBundle;
};

/**
 * Loads a lazy bundle with FetchBundle and resolves with its chunk once it
 * has downloaded.
 *
 * Angular routes and renders on the main thread, so that's where a lazy route
 * or `@defer` block is loaded, and it has to wait for the bundle. React Lynx's
 * main thread doesn't: it only renders the first screen, and lazy content
 * that isn't loaded yet is left to its background thread. Before FetchBundle,
 * Lynx's main thread could only load a bundle that was already there
 * (`__QueryComponent`), so a route's first navigation never got its
 * component (issue #451).
 *
 * The chunk-loading runtime's other two arguments are left out. `mode` asks
 * React Lynx's main thread to block on a `'sync'` import for its one first
 * render; Angular waits for every import either way. `host` routes a chunk's
 * modules to the app that loaded it, and an Angular app loads its own.
 *
 * A failure rejects, so the router's navigation (or the `@defer` block's
 * `@error`) gets the error, where React Lynx's main thread leaves the promise
 * pending.
 */
const loadLazyBundleWithFetchBundle: LoadLazyBundle = (source) => {
  const host = lynx as unknown as FetchBundleLynx;
  if (typeof host.fetchBundle !== 'function') {
    return Promise.reject(
      new Error(
        `Lazy bundle ${source} can't load: lazy bundles need Lynx 3.9 or later (lynx.fetchBundle).`,
      ),
    );
  }
  const fetchBundle = host.fetchBundle;
  return new Promise((resolve, reject) => {
    // Native calls back at once for a bundle it already has, and the promise
    // takes the first answer, so there's nothing to tell apart here.
    fetchBundle(source, {}).then((response) => {
      if (!response || response.code !== 0) {
        const error = new Error(`Lazy bundle load failed, schema: ${source}`);
        // ES5 targets have no `new Error(message, { cause })`, so assign it.
        (error as Error & { cause?: unknown }).cause = JSON.stringify(response);
        reject(error);
        return;
      }
      try {
        resolve(
          __MAIN_THREAD__
            ? evaluateMainThreadSection(host, source, response.url)
            : evaluateBackgroundSection(host, source, response.url),
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
};

/**
 * Runs the bundle's main-thread code and adopts its CSS.
 *
 * On native Lynx, `loadScript()` returns what the section evaluates to: a
 * function of the bundle's entry that returns the chunk, as the build plugin
 * wraps each lazy chunk's main-thread file (angular-webpack-plugin.ts). Lynx
 * for Web runs the section as CommonJS and returns its `module.exports`,
 * which is the chunk itself, so the web's section isn't wrapped.
 *
 * Native Lynx keeps a lazy bundle's CSS in a section of its own, which the
 * page takes only when it's adopted. Lynx for Web has no such globals: its
 * `fetchBundle()` loads the bundle's styles with it.
 */
const evaluateMainThreadSection = (
  host: FetchBundleLynx,
  source: string,
  bundleUrl: string,
): unknown => {
  const evaluated = host.loadScript<unknown>(SECTION_MAIN_THREAD, {
    bundleName: bundleUrl,
  });
  const chunk =
    typeof evaluated === 'function'
      ? (evaluated as (entry: string) => unknown)(source)
      : evaluated;
  const { __LoadStyleSheet: load, __AdoptStyleSheet: adopt } =
    globalThis as StyleSheetGlobals;
  if (typeof load === 'function' && typeof adopt === 'function') {
    const styleSheet = load(SECTION_CSS, bundleUrl);
    if (styleSheet !== null) {
      adopt(styleSheet);
    }
  }
  return chunk;
};

/**
 * Runs the bundle's background code, for an `import()` in a background
 * function. Its wrapper reads `globDynamicComponentEntry` once, to resolve its
 * modules (and any `import()` in them) against this bundle rather than the
 * app's, so it's set for the call and put back after, as React Lynx does.
 */
const evaluateBackgroundSection = (
  host: FetchBundleLynx,
  source: string,
  bundleUrl: string,
): unknown => {
  const g = globalThis as { globDynamicComponentEntry?: string };
  const previous = g.globDynamicComponentEntry;
  g.globDynamicComponentEntry = source;
  try {
    return host.loadScript(SECTION_BACKGROUND, { bundleName: bundleUrl });
  } finally {
    g.globDynamicComponentEntry = previous;
  }
};

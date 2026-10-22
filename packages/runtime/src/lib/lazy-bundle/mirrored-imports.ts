/**
 * The background thread loads every lazy chunk the main thread loads.
 *
 * Angular runs on the main thread only, so only the main thread's router and
 * `@defer` blocks run `import()`. A lazy chunk's module-level code has to run
 * on the background thread as well: a `backgroundFn()` defined in a lazy route
 * registers there, and runOnBackground() finds it by ID. So the build rewrites
 * each `import('./x')` in the app's own files (cross-thread-transform.ts in the
 * build plugin) into
 *
 *     ɵmirrorImport('<key>', () => import('./x'))
 *
 * and registers the same loader once the module has run:
 *
 *     ɵregisterMirroredImport('<key>', () => import('./x'));
 *
 * The key comes from the file and the import's position, so it's the same in
 * both bundles. When the main thread runs an import, it sends the key, and the
 * background thread runs its own loader for it, which loads the background half
 * of the same lazy bundle.
 *
 * A first-screen lazy route loads while the background bundle may still be
 * starting. Native Lynx holds the main thread's messages until the background
 * bundle has run (BTSRuntime::QueueOrExecTask in Lynx core), but nothing
 * promises the same of Lynx for Web, and a message to a thread that hasn't
 * added its listener is lost. So both threads announce themselves when they
 * start. The background
 * thread asks for the keys so far, and the main thread answers with all of
 * them, marked `synced`. The main thread also sends an empty `synced` list when
 * it starts, for a background thread that was listening first. Whichever
 * thread starts first, the background thread gets every key and `synced`.
 */

const MIRROR_EVENT = 'AngularLynx.MirrorImports';
const BACKGROUND_READY_EVENT = 'AngularLynx.BackgroundReady';

type MirrorMessage = {
  keys: string[];
  /** Set once the list holds every key the main thread has sent. */
  synced?: boolean;
};

/**
 * `__MAIN_THREAD__` is set per bundle. Unit tests don't define it, and run as
 * the background thread unless they stub it.
 */
const isMainThread = (): boolean =>
  typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__;

/** Main thread: the keys of the imports that have run, in order. */
const importedKeys: string[] = [];

/** Background thread: each registered loader, by key. */
const loaders = new Map<string, () => Promise<unknown>>();
/** Background thread: the keys the main thread has sent. */
const mirroredKeys = new Set<string>();
/** Background thread: settles once every mirrored load so far has. */
let loading: Promise<void> = Promise.resolve();
let markSynced!: () => void;
/** Background thread: resolves when the main thread's list has arrived. */
const synced = new Promise<void>((resolve) => {
  markSynced = resolve;
});

/**
 * Sends keys to the background thread. Without a Lynx host there's no
 * background thread to send them to.
 */
const sendToBackground = (message: MirrorMessage): void => {
  try {
    (lynx as any).getJSContext().dispatchEvent({
      type: MIRROR_EVENT,
      data: JSON.stringify(message),
    });
  } catch {
    // Outside a Lynx host there's no background thread to tell.
  }
};

/**
 * Runs a lazy import that the build rewrote. On the main thread it also tells
 * the background thread to load the same chunk. It returns `load()`'s promise
 * itself: on the main thread a lazy bundle resolves synchronously (see
 * chunk-loader.ts), which first-screen rendering relies on.
 *
 * @param key - The import's key, the same in both bundles.
 * @param load - The original `import()`.
 * @returns The module's promise.
 */
export const ɵmirrorImport = <T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> => {
  if (isMainThread() && !importedKeys.includes(key)) {
    importedKeys.push(key);
    sendToBackground({ keys: [key] });
  }
  return load();
};

/**
 * Records an import's loader on the background thread, where nothing else
 * runs it, so a key from the main thread can. The build adds a call to the end
 * of each module, so it runs when the module has.
 *
 * @param key - The import's key, the same in both bundles.
 * @param load - The original `import()`.
 */
export const ɵregisterMirroredImport = (
  key: string,
  load: () => Promise<unknown>,
): void => {
  if (!isMainThread()) {
    loaders.set(key, load);
  }
};

/**
 * Loads the chunks behind keys the background thread hasn't seen, one at a
 * time and in the main thread's order. A chunk's own imports register their
 * loaders when it runs, so the next key may need the previous chunk.
 */
const mirror = (keys: string[]): void => {
  for (const key of keys) {
    if (mirroredKeys.has(key)) continue;
    mirroredKeys.add(key);
    // A failed load is dropped so the ones after it still run. The main thread
    // has its chunk either way, and a call to a background function the chunk
    // would have registered fails with "not found".
    loading = loading
      .then(() => loaders.get(key)?.())
      .then(
        () => {},
        () => {},
      );
  }
};

/**
 * Background thread: resolves once every lazy chunk the main thread has loaded
 * so far has loaded here too. A call to a background function that isn't
 * registered yet waits for this before giving up, because the function may be
 * in a chunk that's still loading.
 *
 * @returns A promise that settles when the mirrored loads have.
 */
export const whenImportsMirrored = (): Promise<void> =>
  synced.then(() => loading);

const install = (): void => {
  if (typeof lynx === 'undefined') return;
  try {
    if (isMainThread()) {
      (lynx as any)
        .getJSContext()
        .addEventListener(BACKGROUND_READY_EVENT, () =>
          sendToBackground({ keys: [...importedKeys], synced: true }),
        );
      sendToBackground({ keys: [], synced: true });
      return;
    }
    const context = (lynx as any).getCoreContext();
    context.addEventListener(MIRROR_EVENT, (event: { data: string }) => {
      const message: MirrorMessage = JSON.parse(event.data);
      mirror(message.keys);
      if (message.synced) markSynced();
    });
    context.dispatchEvent({ type: BACKGROUND_READY_EVENT, data: '' });
  } catch {
    // The thread contexts may be missing outside a real Lynx host. Nothing
    // loads lazily there.
  }
};

install();

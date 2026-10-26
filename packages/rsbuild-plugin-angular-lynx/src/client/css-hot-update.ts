import {
  formatError,
  HMR_RELOAD,
  type ReloadRequest,
  send,
  type ThreadContext,
} from './hmr-protocol.js';

/** The CSS hot update file css-extract writes for each chunk. */
type CssHotUpdate = {
  /** The chunk's whole stylesheet, encoded as Lynx's CSS binary in base64. */
  content?: string;
  /** For each CSS ID, the IDs of the stylesheets that import it. */
  deps: Record<string, string[]>;
};

export type CssHotUpdateOptions = {
  isMainThread: boolean;
  lynx: {
    requireModuleAsync?: (
      url: string,
      callback: (error: Error | null, update?: CssHotUpdate) => void,
    ) => void;
    getDevtool?: () =>
      | {
          replaceStyleSheetByIdWithBase64?: (
            id: number,
            base64: string,
          ) => void;
        }
      | undefined;
    getJSContext(): ThreadContext;
  };
  /** `__webpack_require__.p`, the dev server's address. */
  publicPath: string;
  /** `__webpack_require__.cssHotUpdateList`: each chunk's CSS update file. */
  cssHotUpdateList: () => [chunkName: string, path: string][] | null;
  flushElementTree: () => void;
};

/**
 * Applies a stylesheet edit on the main thread. It replaces css-extract's
 * `runtime/hotModuleReplacement.cjs` (entry.ts swaps the module), which every
 * CSS module calls when a hot update replaces it.
 *
 * css-extract's version runs on the background thread: it loads the new
 * stylesheet there and sends it to a main-thread listener React Lynx adds. In
 * an AngularLynx app the main thread takes its own hot updates (see
 * main-thread-hot-updates.ts), which include the CSS modules, so the stylesheet
 * is loaded and applied there, with the same Lynx call React Lynx's listener
 * makes. On the background thread the CSS modules do nothing.
 *
 * Lynx can't apply a stylesheet if `replaceStyleSheetByIdWithBase64` is
 * missing, or the file can't be loaded. Then it asks the background thread to
 * reload the page, rather than leave the old styles on screen.
 *
 * @returns css-extract's `update(moduleId, options, cssId)`, which returns the
 *   function each CSS module calls when it's replaced.
 */
export const createCssHotUpdate = ({
  isMainThread,
  lynx,
  publicPath,
  cssHotUpdateList,
  flushElementTree,
}: CssHotUpdateOptions) => {
  const fail = (reason: string) =>
    send(lynx.getJSContext(), HMR_RELOAD, {
      reason: `Can't apply the stylesheet update: ${reason}`,
    } satisfies ReloadRequest);

  const apply = (update: CssHotUpdate, ids: ReadonlySet<number>) => {
    const { content } = update;
    if (!content) return;
    // Despite the name, the main thread's `getDevtool()` and this method are
    // there whether or not Lynx DevTool is on (`Utils::CreateLynx` and
    // `CreateContextProxy` in Lynx core's renderer_ng.cc).
    const devtool = lynx.getDevtool?.();
    if (!devtool?.replaceStyleSheetByIdWithBase64) {
      fail('lynx.getDevtool().replaceStyleSheetByIdWithBase64 is missing.');
      return;
    }
    try {
      for (const id of ids) {
        // The stylesheets that import this one are compiled with it, so they
        // get the new content too.
        for (const dependent of update.deps[id] ?? []) {
          devtool.replaceStyleSheetByIdWithBase64(Number(dependent), content);
        }
        devtool.replaceStyleSheetByIdWithBase64(id, content);
      }
      flushElementTree();
    } catch (error) {
      fail(formatError(error));
    }
  };

  // A hot update replaces many CSS modules at once, and each would load the
  // chunk's whole stylesheet, so the loads are coalesced: one per update,
  // for every CSS ID the replaced modules have.
  const pending = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const updateStyles = () => {
    const ids = new Set(pending);
    pending.clear();
    timer = undefined;
    for (const [, path] of cssHotUpdateList() ?? []) {
      lynx.requireModuleAsync?.(publicPath + path, (error, update) => {
        if (error) {
          fail(formatError(error));
          return;
        }
        apply(update as CssHotUpdate, ids);
      });
    }
  };

  return (
    _moduleId: unknown,
    _options: unknown,
    cssId?: string,
  ): (() => void) => {
    if (!isMainThread) return () => {};
    const id = Number(cssId || 0);
    return () => {
      pending.add(id);
      // The main thread's clearTimeout() throws without a timer ID. Here that
      // would fail the whole hot update, since this runs in its dispose step.
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(updateStyles, 50);
    };
  };
};

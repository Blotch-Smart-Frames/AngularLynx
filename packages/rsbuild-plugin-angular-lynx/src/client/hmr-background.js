// The background thread's hot update client. entry.ts puts it at the start of
// the background half of each bundle in a development build with hot updates,
// in place of `@rspack/core/hot/dev-server`, after the dev transport's client.
//
// Only the wiring is here; the logic is in background-hot-updates.ts. It's
// plain JavaScript, copied into the package as it is, because it uses what
// only the app's development build provides: `import.meta.webpackHot`,
// `__webpack_hash__` (which the library build would replace with its own) and
// the dev server's client modules, which Rspeedy aliases.
import { reloadPage } from '@lynx-js/webpack-dev-transport/reloadApp';
import { emitter } from '@rspack/core/hot/emitter.js';
import { logApplyResult } from '@rspack/core/hot/log-apply-result.js';
import { log } from '@rspack/core/hot/log.js';
import { startBackgroundHotUpdates } from './background-hot-updates.js';

if (!import.meta.webpackHot) {
  throw new Error('[HMR] Hot Module Replacement is disabled.');
}
startBackgroundHotUpdates({
  hot: import.meta.webpackHot,
  emitter,
  currentHash: () => __webpack_hash__,
  context: lynx.getCoreContext(),
  fetch: (url) => fetch(url),
  reloadPage,
  log,
  logApplyResult,
});

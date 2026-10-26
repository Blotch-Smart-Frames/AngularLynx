// The main thread's hot update client. entry.ts puts it at the start of the
// main-thread half of each bundle in a development build with hot updates.
//
// Only the wiring is here; the logic is in main-thread-hot-updates.ts. It's
// plain JavaScript, copied into the package as it is, because it uses
// `import.meta.webpackHot`, which only the app's development build provides.
import { startMainThreadHotUpdates } from './main-thread-hot-updates.js';

if (!import.meta.webpackHot) {
  throw new Error('[HMR] Hot Module Replacement is disabled.');
}
startMainThreadHotUpdates({
  hot: import.meta.webpackHot,
  lynx,
  context: lynx.getJSContext(),
  // Where bootstrapApplication() leaves its latest promise, and the app it
  // started.
  currentBootstrap: () => globalThis.__LYNX_ANGULAR_BOOTSTRAP__,
  appRunning: () => globalThis.__LYNX_ANGULAR_APP_REF__ !== undefined,
});

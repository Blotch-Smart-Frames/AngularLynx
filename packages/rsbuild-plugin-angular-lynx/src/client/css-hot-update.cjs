'use strict';
// Stands in for @lynx-js/css-extract-webpack-plugin's
// runtime/hotModuleReplacement.cjs in development builds (entry.ts swaps it in).
// The CSS modules css-extract generates require() it and call the export, so it
// has to be CommonJS. It only passes this bundle's globals to the updater in
// css-hot-update.ts.
const { createCssHotUpdate } = require('./css-hot-update.js');

module.exports = createCssHotUpdate({
  isMainThread: __MAIN_THREAD__,
  lynx,
  publicPath: __webpack_require__.p,
  cssHotUpdateList: () => __webpack_require__.cssHotUpdateList,
  flushElementTree: () => __FlushElementTree(),
});

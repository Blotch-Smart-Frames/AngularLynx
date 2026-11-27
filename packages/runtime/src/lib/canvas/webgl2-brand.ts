/**
 * The key under which a WebGL2 context made by the runtime says it's one.
 *
 * The `WebGL2RenderingContext` global (dom-globals.ts) recognizes a context
 * by it, rather than by `instanceof LynxWebGL2RenderingContext`: the
 * context's class is in the build only when a module names `'webgl2'` (see
 * enable-webgl2.ts), and the global is installed in every app, so it mustn't
 * import the class. `Symbol.for()`, so a second copy of the runtime's context
 * is recognized too, as `CANVAS_SOURCE` is.
 */
export const WEBGL2_CONTEXT = Symbol.for('angular-lynx.webgl2Context');

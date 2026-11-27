import { setWebGL2ContextFactory } from './canvas-surface';
import { LynxWebGL2RenderingContextGlobal } from './dom-globals';
import { WEBGL2_CONSTANTS } from './webgl-constants';
import { LynxWebGL2RenderingContext } from './webgl2-context';

/**
 * Gives `<canvas>` its WebGL2 context, on iOS and Android.
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `'webgl2'` (three.js, or an app's own
 * `getContext('webgl2')`), so the context is in the bundle only when
 * something can ask for it (see webGL2ContextFactory in canvas-surface.ts).
 * Calling it again changes nothing.
 *
 * It also gives the `WebGL2RenderingContext` global its constants
 * (`WebGL2RenderingContext.FLOAT` and the rest), as a browser's has: here,
 * rather than where the global is made, so they're only in the builds that
 * can make a context.
 *
 * On Lynx for Web a canvas is the browser's, which has its own context and
 * global, so there it does nothing and the build drops the runtime's.
 */
export const ɵenableWebGL2 = (): void => {
  if (__WEB__) return;
  Object.assign(LynxWebGL2RenderingContextGlobal, WEBGL2_CONSTANTS);
  setWebGL2ContextFactory(
    (bridge, contextId, owner, attributes) =>
      new LynxWebGL2RenderingContext(bridge, contextId, owner, attributes),
  );
};

import { setWebGL2ContextFactory } from './canvas-surface';
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
 * On Lynx for Web a canvas is the browser's, which has its own context, so
 * there it does nothing and the build drops the runtime's.
 */
export const ɵenableWebGL2 = (): void => {
  if (__WEB__) return;
  setWebGL2ContextFactory(
    (bridge, contextId, owner, attributes) =>
      new LynxWebGL2RenderingContext(bridge, contextId, owner, attributes),
  );
};

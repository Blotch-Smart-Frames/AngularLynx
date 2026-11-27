import {
  LynxCanvasGradient,
  LynxCanvasPattern,
  LynxCanvasRenderingContext2D,
  LynxTextMetrics,
} from './canvas-2d-context';
import { setCanvas2DContextFactory } from './canvas-surface';
import { LynxPath2D } from './path';

/**
 * Puts the 2D context's classes on the target where it has none of its own:
 * `CanvasRenderingContext2D` (and `OffscreenCanvasRenderingContext2D`, the
 * same class here), `CanvasGradient`, `CanvasPattern`, `TextMetrics` and
 * `Path2D`. Chart and image libraries check a context against them, patch
 * their prototypes, or build a `Path2D` to fill.
 *
 * They're here rather than with the other canvas globals (dom-globals.ts),
 * which every app installs before anything else: there, they'd bring the
 * context into every app. A module that names one gets `ɵenableCanvas2D()`
 * at its top from the build, as one that names `'2d'` does, so the globals
 * are in place before its own code reads them. `ImageData` stays with the
 * other globals, as WebGL takes one too (image-data.ts).
 */
export const install2DGlobals = (target: Record<string, unknown>): void => {
  const install = (name: string, value: unknown): void => {
    if (typeof target[name] === 'undefined') target[name] = value;
  };
  install('CanvasRenderingContext2D', LynxCanvasRenderingContext2D);
  install('OffscreenCanvasRenderingContext2D', LynxCanvasRenderingContext2D);
  install('CanvasGradient', LynxCanvasGradient);
  install('CanvasPattern', LynxCanvasPattern);
  install('TextMetrics', LynxTextMetrics);
  install('Path2D', LynxPath2D);
};

/**
 * Gives `<canvas>`, `document.createElement('canvas')` and `OffscreenCanvas`
 * their 2D context, on iOS and Android, with its classes as globals
 * (install2DGlobals()).
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names `'2d'` (a chart library, a signature pad, an
 * app's own `getContext('2d')`) or one of the context's classes, so the
 * context is in the bundle only when something can ask for it (see
 * canvas2DContextFactory in canvas-surface.ts). PrimJS reads a script's
 * whole bytecode as it loads it, so every app used to pay for it in memory
 * (#729). A module that asks by a name built at runtime can call this first.
 * Calling it again changes nothing.
 *
 * On Lynx for Web a canvas is the browser's, which has its own context and
 * classes, so there it does nothing and the build drops the runtime's.
 */
export const ɵenableCanvas2D = (): void => {
  if (__WEB__) return;
  install2DGlobals(globalThis as unknown as Record<string, unknown>);
  setCanvas2DContextFactory(
    (bridge, contextId, owner, attributes) =>
      new LynxCanvasRenderingContext2D(bridge, contextId, owner, attributes),
  );
};

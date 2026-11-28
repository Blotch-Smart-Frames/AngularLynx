import type { LynxElement } from '../lynx-element/lynx-element';
import type { ElementRef } from '../types/lynx';

/**
 * Makes a template's `<canvas>` wrapper, with HTMLCanvasElement's API
 * (canvas/canvas-element.ts). `ɵenableCanvas()` sets it (canvas/enable-canvas.ts),
 * and the build calls that in every module that can make a canvas: a
 * template with a `<canvas>` names `'canvas'`, as `createElement('canvas')`
 * does. Until then it's null, so the canvas, its surface and the shell's
 * bridges stay out of every other app's main-thread script, which PrimJS
 * reads whole as it loads it (#707).
 */
export type CanvasElementFactory = (element: ElementRef) => LynxElement;

let canvasElementFactory: CanvasElementFactory | null = null;

export const setCanvasElementFactory = (
  factory: CanvasElementFactory | null,
): void => {
  canvasElementFactory = factory;
};

/** Whether the build left the canvas out (see setCanvasElementFactory). */
let warned = false;

/**
 * The `<canvas>` wrapper for a native canvas element, or null without the
 * canvas: then the document makes a plain element, which draws nothing, and
 * says once on the console how to fix it. Only a tag the app builds at
 * runtime gets there, since a template's `<canvas>` names the tag.
 */
export const canvasElementFor = (element: ElementRef): LynxElement | null => {
  if (canvasElementFactory) return canvasElementFactory(element);
  if (!warned) {
    warned = true;
    console.warn(
      "[angular-lynx] A <canvas> was made, but the build includes the canvas only when a module names 'canvas', and none did. Write the tag out in a template, or call ɵenableCanvas() from @blotch/angular-lynx before making it.",
    );
  }
  return null;
};

/** @internal For tests: forget the warning, so the next canvas warns again. */
export const resetCanvasWarningForTesting = (): void => {
  warned = false;
};

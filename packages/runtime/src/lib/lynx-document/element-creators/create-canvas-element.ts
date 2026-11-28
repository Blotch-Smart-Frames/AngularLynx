import type { ElementRef } from '../../types/lynx';

/**
 * Whether this host's shell has the `AngularLynxWebGL` module that draws in
 * a `<canvas>`, which `ɵenableCanvas()` sets (canvas/enable-canvas.ts). It
 * asks the shell through the canvas's bridge, which is in the build only with
 * the canvas; without it, no canvas was asked for, and the element is a view.
 */
let shellHasCanvas: (() => boolean) | null = null;

export const setShellCanvasCheck = (check: (() => boolean) | null): void => {
  shellHasCanvas = check;
};

/**
 * `<canvas>`: Lynx has none, so on iOS and Android the native element is the
 * shell's (`AngularLynxCanvas`, `CanvasUI`), registered under this name next
 * to the `AngularLynxWebGL` module that draws in it. A host without that
 * module, such as Lynx Explorer, has no element for the tag either, and on
 * Android an element nothing is registered for stops the elements after it
 * rendering; so there the canvas is a view, which draws nothing and leaves
 * the rest of the page as it is. So is it in a build without the canvas
 * (see shellHasCanvas). On Lynx for Web it's an HTML `<canvas>`, since
 * web-core creates a tag it has no element of its own for as it is.
 */
export const createCanvasElement = (pageId: number): ElementRef =>
  __WEB__ || shellHasCanvas?.()
    ? __CreateElement('canvas', pageId)
    : __CreateView(pageId);

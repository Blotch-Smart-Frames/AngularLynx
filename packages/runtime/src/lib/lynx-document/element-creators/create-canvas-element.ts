import { getWebGLBridge } from '../../canvas/webgl-bridge';
import type { ElementRef } from '../../types/lynx';

/**
 * `<canvas>`: Lynx has none, so on iOS and Android the native element is the
 * shell's (`AngularLynxCanvas`, `CanvasUI`), registered under this name next
 * to the `AngularLynxWebGL` module that draws in it. A host without that
 * module, such as Lynx Explorer, has no element for the tag either, and on
 * Android an element nothing is registered for stops the elements after it
 * rendering; so there the canvas is a view, which draws nothing and leaves
 * the rest of the page as it is. On Lynx for Web it's an HTML `<canvas>`,
 * since web-core creates a tag it has no element of its own for as it is.
 */
export const createCanvasElement = (pageId: number): ElementRef =>
  __WEB__ || getWebGLBridge()
    ? __CreateElement('canvas', pageId)
    : __CreateView(pageId);

import { setCanvasElementFactory } from '../lynx-document/canvas-element-factory';
import { setShellCanvasCheck } from '../lynx-document/element-creators/create-canvas-element';
import { LynxImageBitmapRenderingContext } from './bitmap-renderer-context';
import { LynxCanvasElement } from './canvas-element';
import { LynxDetachedCanvas, LynxOffscreenCanvas } from './detached-canvas';
import { createImageBitmap, LynxImageBitmap, LynxImageElement } from './image';
import { LynxImageData } from './image-data';
import { wrapRealmImageMethods } from './web-image-sources';
import { getWebGLBridge } from './webgl-bridge';

/**
 * Puts the canvas's classes on the target where it has none of its own:
 * `OffscreenCanvas`, `ImageData`, `Image` and `HTMLImageElement`,
 * `ImageBitmap`, `ImageBitmapRenderingContext` and `createImageBitmap()`, and
 * `document.createElement('canvas')` and `document.createElement('img')` (with
 * `createElementNS()`, as three.js's ImageLoader calls it). Chart and image
 * libraries, and three.js's text textures, draw on a canvas that's never in
 * the page, and load textures through an `Image`.
 *
 * They're here rather than with the canvas globals every app installs before
 * anything else (dom-globals.ts): there they'd bring the canvas, its surface,
 * the image decoder and the shell's bridges into every app. The ones every
 * app keeps, which only tell an object apart (`HTMLCanvasElement`,
 * `WebGL2RenderingContext` and the like), stay there.
 *
 * In the web preview the browser has all of them, so only its canvas APIs
 * change: they take a template's `<video>` or `<canvas>` as an image (see
 * web-image-sources.ts).
 */
export const installCanvasClasses = (target: Record<string, any>): void => {
  const install = (name: string, value: unknown): void => {
    if (typeof target[name] === 'undefined') target[name] = value;
  };
  install('OffscreenCanvas', LynxOffscreenCanvas);
  install('ImageData', LynxImageData);
  install('Image', LynxImageElement);
  install('HTMLImageElement', LynxImageElement);
  install('ImageBitmap', LynxImageBitmap);
  install('ImageBitmapRenderingContext', LynxImageBitmapRenderingContext);
  install('createImageBitmap', createImageBitmap);
  if (__WEB__) wrapRealmImageMethods(target);

  const document = target['document'] as
    | { createElement?: unknown; createElementNS?: unknown }
    | undefined;
  if (document && typeof document.createElement !== 'function') {
    document.createElement = createDetachedElement;
    document.createElementNS = (_namespace: string, name: string) =>
      createDetachedElement(name);
  }
};

/**
 * `document.createElement()` on Lynx's main thread: images and canvases,
 * which web code makes to draw on without showing them.
 */
const createDetachedElement = (
  name: string,
): LynxImageElement | LynxDetachedCanvas => {
  const tag = name.toLowerCase();
  if (tag === 'img') return new LynxImageElement();
  if (tag === 'canvas') return new LynxDetachedCanvas();
  throw new Error(
    `document.createElement('${name}') is not available on Lynx: elements come from templates.`,
  );
};

/**
 * Gives the app the canvas: a template's `<canvas>` with HTMLCanvasElement's
 * API (canvas-element.ts) and the shell's canvas behind it, and the classes
 * of installCanvasClasses() as globals.
 *
 * Apps don't call this: the build plugin calls it at the top of every
 * main-thread module that names the string `'canvas'` (a template with a
 * `<canvas>`, `document.createElement('canvas')`), one of the canvas's
 * classes, or `'img'` as `createElement()`'s tag. `ɵenableCanvas2D()` and
 * `ɵenableWebGL2()` call it too, since a context needs a canvas to draw on.
 * So the canvas is in the bundle only when something can make one: PrimJS
 * reads a script's whole bytecode as it loads it, so every app used to pay
 * for it in memory (#707). A module that makes a canvas by a tag built at
 * runtime can call this first. Calling it again changes nothing.
 */
export const ɵenableCanvas = (): void => {
  setCanvasElementFactory((element) => new LynxCanvasElement(element));
  setShellCanvasCheck(() => getWebGLBridge() !== null);
  installCanvasClasses(globalThis as unknown as Record<string, any>);
};

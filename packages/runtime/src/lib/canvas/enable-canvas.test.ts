import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canvasElementFor,
  setCanvasElementFactory,
} from '../lynx-document/canvas-element-factory';
import {
  createCanvasElement,
  setShellCanvasCheck,
} from '../lynx-document/element-creators/create-canvas-element';
import { createFakeWebGLBridge } from '../testing/fake-webgl-bridge';
import type { ElementRef } from '../types/lynx';
import { LynxImageBitmapRenderingContext } from './bitmap-renderer-context';
import { LynxCanvasElement } from './canvas-element';
import { LynxDetachedCanvas, LynxOffscreenCanvas } from './detached-canvas';
import { installCanvasClasses, ɵenableCanvas } from './enable-canvas';
import { ɵenableCanvas2D } from './enable-canvas-2d';
import { ɵenableWebGL2 } from './enable-webgl2';
import { createImageBitmap, LynxImageBitmap, LynxImageElement } from './image';
import { LynxImageData } from './image-data';
import { setWebGLBridgeForTesting } from './webgl-bridge';

const NAMES = [
  'OffscreenCanvas',
  'ImageData',
  'Image',
  'HTMLImageElement',
  'ImageBitmap',
  'ImageBitmapRenderingContext',
  'createImageBitmap',
];

afterEach(() => {
  setCanvasElementFactory(null);
  setShellCanvasCheck(null);
  setWebGLBridgeForTesting(undefined);
  for (const name of NAMES) {
    delete (globalThis as Record<string, unknown>)[name];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('installCanvasClasses', () => {
  it('installs the classes that make a canvas or an image, where they’re missing', () => {
    const target: Record<string, any> = { document: {} };
    installCanvasClasses(target);
    expect(target['OffscreenCanvas']).toBe(LynxOffscreenCanvas);
    expect(target['ImageData']).toBe(LynxImageData);
    expect(target['Image']).toBe(LynxImageElement);
    expect(target['HTMLImageElement']).toBe(LynxImageElement);
    expect(target['ImageBitmap']).toBe(LynxImageBitmap);
    expect(target['createImageBitmap']).toBe(createImageBitmap);
    expect(target['ImageBitmapRenderingContext']).toBe(
      LynxImageBitmapRenderingContext,
    );
    expect(target['document'].createElement('IMG')).toBeInstanceOf(
      LynxImageElement,
    );
    expect(
      target['document'].createElementNS('http://www.w3.org/1999/xhtml', 'img'),
    ).toBeInstanceOf(LynxImageElement);
    expect(target['document'].createElement('Canvas')).toBeInstanceOf(
      LynxDetachedCanvas,
    );
    expect(() => target['document'].createElement('div')).toThrow(
      /elements come from templates/,
    );
  });

  it('keeps what the runtime has (the web preview)', () => {
    class Image {}
    class OffscreenCanvas {}
    const createElement = () => 'div';
    const target: Record<string, any> = {
      Image,
      OffscreenCanvas,
      document: { createElement },
    };
    installCanvasClasses(target);
    expect(target['Image']).toBe(Image);
    expect(target['OffscreenCanvas']).toBe(OffscreenCanvas);
    expect(target['document'].createElement).toBe(createElement);
  });

  it('leaves a target without a document one', () => {
    const target: Record<string, any> = {};
    installCanvasClasses(target);
    expect(target['document']).toBeUndefined();
  });

  it('makes the web preview’s canvas APIs take a template’s <video> or <canvas> as an image', () => {
    vi.stubGlobal('__WEB__', true);
    const drawImage = vi.fn();
    class CanvasRenderingContext2D {}
    Object.assign(CanvasRenderingContext2D.prototype, { drawImage });
    installCanvasClasses({ CanvasRenderingContext2D });
    // A template's element, holding its DOM element.
    const video = { element: { node: true }, observeLayout: () => () => {} };
    const context = new CanvasRenderingContext2D() as {
      drawImage(...args: unknown[]): void;
    };
    context.drawImage(video, 0, 0);
    expect(drawImage).toHaveBeenCalledWith(video.element, 0, 0);
  });

  it('leaves the canvas APIs alone on Lynx, whose own take one already', () => {
    const drawImage = vi.fn();
    class CanvasRenderingContext2D {}
    Object.assign(CanvasRenderingContext2D.prototype, { drawImage });
    installCanvasClasses({ CanvasRenderingContext2D });
    expect(
      (CanvasRenderingContext2D.prototype as { drawImage: unknown }).drawImage,
    ).toBe(drawImage);
  });
});

describe('ɵenableCanvas', () => {
  const stubElementGlobals = () => {
    let uid = 1;
    globalThis.__GetElementUniqueID = vi.fn(() => uid++);
    globalThis.__SetAttribute = vi.fn();
    globalThis.__AddInlineStyle = vi.fn();
    globalThis.__SetInlineStyles = vi.fn();
    globalThis.__AddEvent = vi.fn();
    globalThis.__SetDataset = vi.fn();
    globalThis.__InvokeUIMethod = vi.fn();
  };

  it('gives a template’s <canvas> HTMLCanvasElement’s API', () => {
    stubElementGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Before: the build left the canvas out (see canvas-element-factory.ts).
    expect(canvasElementFor({} as ElementRef)).toBeNull();
    ɵenableCanvas();
    // A second module that names 'canvas' calls it again.
    ɵenableCanvas();
    const canvas = canvasElementFor({} as ElementRef);
    expect(canvas).toBeInstanceOf(LynxCanvasElement);
    expect(canvas?.tagName).toBe('canvas');
  });

  it('makes the shell’s canvas where it has WebGL', () => {
    globalThis.__CreateElement = vi.fn(() => ({ canvas: true }) as never);
    globalThis.__CreateView = vi.fn(() => ({ view: true }) as never);
    setWebGLBridgeForTesting(createFakeWebGLBridge());
    expect(createCanvasElement(1)).toEqual({ view: true });
    ɵenableCanvas();
    expect(createCanvasElement(1)).toEqual({ canvas: true });
    setWebGLBridgeForTesting(null);
    expect(createCanvasElement(1)).toEqual({ view: true });
  });

  it('installs the canvas’s classes as globals', () => {
    ɵenableCanvas();
    const globals = globalThis as unknown as Record<string, unknown>;
    expect(globals['OffscreenCanvas']).toBe(LynxOffscreenCanvas);
    expect(globals['Image']).toBe(LynxImageElement);
  });

  it('comes with the 2D context and the WebGL2 context, which need a canvas', () => {
    stubElementGlobals();
    ɵenableCanvas2D();
    expect(canvasElementFor({} as ElementRef)).toBeInstanceOf(
      LynxCanvasElement,
    );
    setCanvasElementFactory(null);
    ɵenableWebGL2();
    expect(canvasElementFor({} as ElementRef)).toBeInstanceOf(
      LynxCanvasElement,
    );
  });

  it('comes with the contexts on the web too, where they do nothing more', () => {
    vi.stubGlobal('__WEB__', true);
    ɵenableCanvas2D();
    ɵenableWebGL2();
    expect((globalThis as unknown as Record<string, unknown>)['Image']).toBe(
      LynxImageElement,
    );
  });
});

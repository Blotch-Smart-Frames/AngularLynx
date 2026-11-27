import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCanvasGlobals } from './dom-globals';
import { LynxCanvasRenderingContext2D } from './canvas-2d-context';
import { LynxImageData } from './image-data';
import { LynxDetachedCanvas, LynxOffscreenCanvas } from './detached-canvas';
import { LynxImageBitmapRenderingContext } from './bitmap-renderer-context';
import { createImageBitmap, LynxImageBitmap, LynxImageElement } from './image';
import { CANVAS_SOURCE } from './canvas-source';
import {
  WEBGL2_CONTEXT,
  WEBGL_OBJECT,
  WEBGL_OBJECT_NAMES,
} from './webgl2-brand';
import type { LayoutRect } from '../lynx-element/layout';

/**
 * A Lynx element, as the globals tell one apart: by shape.
 */
const element = (rect: LayoutRect | null = null) => {
  const observers = new Set<(rect: LayoutRect) => void>();
  return {
    element: { node: true },
    layoutRect: rect,
    observeLayout: vi.fn((observer: (rect: LayoutRect) => void) => {
      observers.add(observer);
      return () => observers.delete(observer);
    }),
    layout(next: LayoutRect) {
      for (const observer of Array.from(observers)) observer(next);
    },
    observers,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installCanvasGlobals', () => {
  it('installs what three.js and angular-three need, where it’s missing', () => {
    vi.stubGlobal('lynx', { SystemInfo: { pixelRatio: 3 } });
    const target: Record<string, any> = { document: {} };
    installCanvasGlobals(target);
    expect(target['performance'].now()).toBeGreaterThanOrEqual(0);
    expect(target['performance'].timeOrigin).toBeGreaterThan(0);
    expect(target['crypto'].randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(target['crypto'].getRandomValues).toBeUndefined();
    expect(target['self']).toBe(target);
    expect(target['Image']).toBe(LynxImageElement);
    expect(target['HTMLImageElement']).toBe(LynxImageElement);
    expect(target['ImageBitmap']).toBe(LynxImageBitmap);
    expect(target['createImageBitmap']).toBe(createImageBitmap);
    expect(target['ImageBitmapRenderingContext']).toBe(
      LynxImageBitmapRenderingContext,
    );
    expect(target['devicePixelRatio']).toBe(3);
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
    expect(target['OffscreenCanvas']).toBe(LynxOffscreenCanvas);
    expect(target['ImageData']).toBe(LynxImageData);
    // The 2D context's classes come with the context (enable-canvas-2d.ts),
    // in the apps that ask for one: here they'd be in every app.
    for (const name of [
      'CanvasRenderingContext2D',
      'OffscreenCanvasRenderingContext2D',
      'CanvasGradient',
      'CanvasPattern',
      'TextMetrics',
      'Path2D',
    ]) {
      expect(target[name], name).toBeUndefined();
    }
  });

  it('makes a template’s elements HTMLElements, and canvases HTMLCanvasElements', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    expect(element() instanceof target['HTMLElement']).toBe(true);
    expect({} instanceof target['HTMLElement']).toBe(false);
    expect(null instanceof target['HTMLElement']).toBe(false);
    expect(element() instanceof target['HTMLCanvasElement']).toBe(false);
    expect(null instanceof target['HTMLCanvasElement']).toBe(false);
    expect(
      new LynxDetachedCanvas() instanceof target['HTMLCanvasElement'],
    ).toBe(true);
    expect(
      new LynxOffscreenCanvas(1, 1) instanceof target['HTMLCanvasElement'],
    ).toBe(false);
  });

  it('makes a WebGL2 context a WebGL2RenderingContext, and nothing a WebGLRenderingContext', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    // The runtime's context, as the global tells one apart: by its mark.
    const context = { [WEBGL2_CONTEXT]: true };
    expect(context instanceof target['WebGL2RenderingContext']).toBe(true);
    expect({} instanceof target['WebGL2RenderingContext']).toBe(false);
    expect(
      { [WEBGL2_CONTEXT]: false } instanceof target['WebGL2RenderingContext'],
    ).toBe(false);
    expect(null instanceof target['WebGL2RenderingContext']).toBe(false);
    // A 2D context, without the bridge and canvas a real one is made with.
    const context2D = Object.create(LynxCanvasRenderingContext2D.prototype);
    expect(context2D).toBeInstanceOf(LynxCanvasRenderingContext2D);
    expect(context2D instanceof target['WebGL2RenderingContext']).toBe(false);
    // As in a browser, a WebGL2 context isn't a WebGL1 one.
    expect(context instanceof target['WebGLRenderingContext']).toBe(false);
    expect({} instanceof target['WebGLRenderingContext']).toBe(false);
    // Contexts come from getContext(), as in a browser.
    expect(() => new target['WebGL2RenderingContext']()).toThrow(
      'Illegal constructor',
    );
    expect(() => new target['WebGLRenderingContext']()).toThrow(
      'Illegal constructor',
    );
  });

  it('makes each WebGL object an instance of its interface’s global, and of no other', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    for (const name of WEBGL_OBJECT_NAMES) {
      const Global = target[name];
      // twgl.js asks `typeof WebGLTexture !== 'undefined'` before its check.
      expect(typeof Global).toBe('function');
      expect(Global.name).toBe(name);
      // The runtime's object, as the global tells one apart: by its mark.
      for (const other of WEBGL_OBJECT_NAMES) {
        expect({ [WEBGL_OBJECT]: other } instanceof Global).toBe(
          other === name,
        );
      }
      expect({} instanceof Global).toBe(false);
      expect(null instanceof Global).toBe(false);
      expect(name instanceof Global).toBe(false);
      // The context isn't one of its objects.
      expect({ [WEBGL2_CONTEXT]: true } instanceof Global).toBe(false);
      // The objects come from the context, as in a browser.
      expect(() => new Global()).toThrow('Illegal constructor');
    }
  });

  it('fires progress events', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    const event = new target['ProgressEvent']('progress', {
      lengthComputable: true,
      loaded: 5,
      total: 10,
    });
    expect(event).toMatchObject({
      type: 'progress',
      lengthComputable: true,
      loaded: 5,
      total: 10,
    });
    event.preventDefault();
    event.stopPropagation();
    expect(event.defaultPrevented).toBe(true);
    expect(new target['ProgressEvent']('load')).toMatchObject({
      lengthComputable: false,
      loaded: 0,
      total: 0,
    });
  });

  it('reads the pixel ratio from the global SystemInfo, or assumes 1', () => {
    vi.stubGlobal('lynx', {});
    vi.stubGlobal('SystemInfo', { pixelRatio: 2 });
    const withGlobal: Record<string, any> = {};
    installCanvasGlobals(withGlobal);
    expect(withGlobal['devicePixelRatio']).toBe(2);
    vi.stubGlobal('SystemInfo', {});
    vi.stubGlobal('lynx', undefined);
    const without: Record<string, any> = {};
    installCanvasGlobals(without);
    expect(without['devicePixelRatio']).toBe(1);
  });

  it('keeps what the runtime has (the web preview)', () => {
    const own = { now: () => 1 };
    const createElement = () => 'div';
    class WebGL2RenderingContext {}
    class WebGLRenderingContext {}
    class WebGLTexture {}
    const target: Record<string, any> = {
      performance: own,
      crypto: own,
      devicePixelRatio: 2,
      document: { createElement },
      WebGL2RenderingContext,
      WebGLRenderingContext,
      WebGLTexture,
    };
    installCanvasGlobals(target);
    expect(target['performance']).toBe(own);
    expect(target['WebGL2RenderingContext']).toBe(WebGL2RenderingContext);
    expect(target['WebGLRenderingContext']).toBe(WebGLRenderingContext);
    expect(target['WebGLTexture']).toBe(WebGLTexture);
    expect(target['crypto']).toBe(own);
    expect(target['devicePixelRatio']).toBe(2);
    expect(target['document'].createElement).toBe(createElement);
    // Installed twice: the wrappers aren't wrapped again.
    const resizeObserver = target['ResizeObserver'];
    const getComputedStyle = target['getComputedStyle'];
    installCanvasGlobals(target);
    expect(target['ResizeObserver']).toBe(resizeObserver);
    expect(target['getComputedStyle']).toBe(getComputedStyle);
  });
});

describe('getComputedStyle', () => {
  it('answers empty values on Lynx, which has no computed styles', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    const style = target['getComputedStyle'](element());
    expect(style.overflow).toBe('');
    expect(style.getPropertyValue('overflow')).toBe('');
  });

  it('wraps the browser’s, reading a Lynx element’s DOM node', () => {
    const own = vi.fn(() => ({ overflow: 'own' }));
    const node = {
      ownerDocument: {
        defaultView: { getComputedStyle: () => ({ overflow: 'hidden' }) },
      },
    };
    const target: Record<string, any> = { getComputedStyle: own };
    installCanvasGlobals(target);
    expect(target['getComputedStyle']({ tag: 'div' })).toEqual({
      overflow: 'own',
    });
    const lynxElement = { ...element(), element: node };
    expect(target['getComputedStyle'](lynxElement)).toEqual({
      overflow: 'hidden',
    });
    const detached = { ...element(), element: {} };
    expect(target['getComputedStyle'](detached).overflow).toBe('');
  });
});

describe('ResizeObserver on Lynx', () => {
  const install = () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    return target['ResizeObserver'];
  };

  it('reports an element’s size from its layouts', async () => {
    const ResizeObserver = install();
    const callback = vi.fn();
    const observer = new ResizeObserver(callback);
    const target = element();
    observer.observe(target);
    observer.observe(target);
    expect(target.observeLayout).toHaveBeenCalledOnce();
    target.layout({ left: 1, top: 2, width: 100, height: 50 });
    expect(callback).toHaveBeenCalledOnce();
    const [[entries, which]] = callback.mock.calls;
    expect(which).toBe(observer);
    expect(entries[0]).toMatchObject({
      target,
      contentRect: { x: 0, y: 0, width: 100, height: 50 },
      borderBoxSize: [{ inlineSize: 100, blockSize: 50 }],
      contentBoxSize: [{ inlineSize: 100, blockSize: 50 }],
      devicePixelContentBoxSize: [{ inlineSize: 100, blockSize: 50 }],
    });
    // Moving without resizing isn't a resize.
    target.layout({ left: 9, top: 9, width: 100, height: 50 });
    expect(callback).toHaveBeenCalledOnce();
    target.layout({ left: 9, top: 9, width: 100, height: 60 });
    expect(callback).toHaveBeenCalledTimes(2);
    observer.unobserve(target);
    observer.unobserve({});
    expect(target.observers.size).toBe(0);
  });

  it('reports the size an element already has when observing starts', async () => {
    const ResizeObserver = install();
    const callback = vi.fn();
    const observer = new ResizeObserver(callback);
    observer.observe(element({ left: 0, top: 0, width: 10, height: 10 }));
    expect(callback).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledOnce();

    const stopped = element({ left: 0, top: 0, width: 10, height: 10 });
    observer.observe(stopped);
    observer.disconnect();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('takes only elements', () => {
    const observer = new (install())(() => {});
    expect(() => observer.observe({})).toThrow(TypeError);
    expect(() => observer.observe(null)).toThrow(TypeError);
  });
});

describe('ResizeObserver on the web', () => {
  it('wraps the browser’s, reporting Lynx elements as the targets', () => {
    let fire: (entries: unknown[]) => void = () => {};
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class BrowserResizeObserver {
      constructor(callback: (entries: unknown[]) => void) {
        fire = callback;
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
    const target: Record<string, any> = {
      ResizeObserver: BrowserResizeObserver,
    };
    installCanvasGlobals(target);
    const callback = vi.fn();
    const observer = new target['ResizeObserver'](callback);
    const lynxElement = element();
    const plain = { plain: true };
    observer.observe(lynxElement, { box: 'content-box' });
    observer.observe(plain);
    expect(observe).toHaveBeenCalledWith(lynxElement.element, {
      box: 'content-box',
    });
    expect(observe).toHaveBeenCalledWith(plain, undefined);
    const entry = (of: object) => ({
      target: of,
      contentRect: { width: 1 },
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    });
    fire([entry(lynxElement.element), entry(plain)]);
    const [[entries, which]] = callback.mock.calls;
    expect(which).toBe(observer);
    expect(entries[0].target).toBe(lynxElement);
    expect(entries[0].contentRect).toEqual({ width: 1 });
    expect(entries[1].target).toBe(plain);
    observer.unobserve(lynxElement);
    observer.unobserve(plain);
    expect(unobserve).toHaveBeenCalledWith(lynxElement.element);
    observer.disconnect();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('the canvas APIs on the web', () => {
  it('take a template’s <video> or <canvas> as an image', () => {
    vi.stubGlobal('__WEB__', true);
    const drawImage = vi.fn();
    class CanvasRenderingContext2D {}
    Object.assign(CanvasRenderingContext2D.prototype, { drawImage });
    const target: Record<string, any> = { CanvasRenderingContext2D };
    installCanvasGlobals(target);
    const video = element();
    const context = new CanvasRenderingContext2D() as {
      drawImage(...args: unknown[]): void;
    };
    context.drawImage(video, 0, 0);
    expect(drawImage).toHaveBeenCalledWith(video.element, 0, 0);
  });

  it('take a template’s <video> as an instance of the browser’s class', () => {
    vi.stubGlobal('__WEB__', true);
    /**
     * The page's video, of the window web-core's iframe is in.
     */
    class PageVideo {}
    const page = { HTMLVideoElement: PageVideo };
    class HTMLVideoElement {}
    installCanvasGlobals({ HTMLVideoElement, parent: page });
    const video = Object.assign(element(), { element: new PageVideo() });
    expect(video).toBeInstanceOf(HTMLVideoElement);
  });

  it('keep what the runtime’s classes take, where the realm has none', () => {
    vi.stubGlobal('__WEB__', true);
    // The runtime's classes go in first, then take the page's instances too:
    // what they took before, they still do.
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    const detached = new LynxDetachedCanvas();
    expect(element()).toBeInstanceOf(target['HTMLElement']);
    expect(detached).toBeInstanceOf(target['HTMLElement']);
    expect(detached).toBeInstanceOf(target['HTMLCanvasElement']);
    expect({ [CANVAS_SOURCE]: {}, tagName: 'video' }).toBeInstanceOf(
      target['HTMLVideoElement'],
    );
  });

  it('are left alone on Lynx, whose own take one already', () => {
    const drawImage = vi.fn();
    class CanvasRenderingContext2D {}
    Object.assign(CanvasRenderingContext2D.prototype, { drawImage });
    installCanvasGlobals({ CanvasRenderingContext2D });
    expect(
      (CanvasRenderingContext2D.prototype as { drawImage: unknown }).drawImage,
    ).toBe(drawImage);
  });
});

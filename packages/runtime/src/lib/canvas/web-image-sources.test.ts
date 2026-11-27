import { describe, expect, it, vi } from 'vitest';
import {
  unwrapImageSource,
  wrapContextImageMethods,
  wrapRealmImageMethods,
} from './web-image-sources';

/**
 * A template's element, as the wrappers tell one apart: by shape.
 */
const templateElement = (element: object) => ({
  element,
  observeLayout: () => () => {},
});

describe('unwrapImageSource', () => {
  it('reads a template element as its DOM element, and leaves the rest', () => {
    const video = { tagName: 'VIDEO' };
    expect(unwrapImageSource(templateElement(video))).toBe(video);
    const image = { width: 1 };
    expect(unwrapImageSource(image)).toBe(image);
    // An object holding an `element` that isn't a template element.
    const other = { element: video };
    expect(unwrapImageSource(other)).toBe(other);
    expect(unwrapImageSource(null)).toBeNull();
    expect(unwrapImageSource(3)).toBe(3);
  });
});

describe('wrapContextImageMethods', () => {
  /**
   * A context of the page, whose methods are its prototype's.
   */
  const pageContext = () => {
    const drawImage = vi.fn(function (this: unknown) {
      return this;
    });
    const texImage2D = vi.fn();
    const getError = vi.fn();
    class Context {}
    Object.assign(Context.prototype, { drawImage, texImage2D, getError });
    return { context: new Context(), Context, drawImage, texImage2D, getError };
  };

  it('passes a template element’s DOM element, in any argument', () => {
    const { context, Context, drawImage, texImage2D, getError } = pageContext();
    wrapContextImageMethods(context);
    const typed = context as {
      drawImage(...args: unknown[]): unknown;
      texImage2D(...args: unknown[]): unknown;
      getError(): unknown;
    };
    const video = { tagName: 'VIDEO' };
    const canvas = { tagName: 'CANVAS' };
    expect(typed.drawImage(templateElement(video), 0, 0)).toBe(context);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0);
    // texImage2D's source is its 6th argument, or its 9th.
    typed.texImage2D(1, 0, 2, 3, 4, templateElement(canvas));
    expect(texImage2D).toHaveBeenLastCalledWith(1, 0, 2, 3, 4, canvas);
    const pixels = new Uint8Array(4);
    typed.texImage2D(1, 0, 2, 1, 1, 0, 3, 4, pixels);
    expect(texImage2D).toHaveBeenLastCalledWith(1, 0, 2, 1, 1, 0, 3, 4, pixels);
    // The context keeps its class, and its other methods.
    expect(context).toBeInstanceOf(Context);
    expect(typed.getError).toBe(getError);
    // As the context's own, but not among its keys.
    expect(Object.hasOwn(context, 'drawImage')).toBe(true);
    expect(Object.keys(context)).toEqual([]);
  });

  it('wraps a context once', () => {
    const { context } = pageContext();
    wrapContextImageMethods(context);
    const wrapped = (context as { drawImage: unknown }).drawImage;
    wrapContextImageMethods(context);
    expect((context as { drawImage: unknown }).drawImage).toBe(wrapped);
  });

  it('leaves alone what isn’t a context', () => {
    expect(() => wrapContextImageMethods(null)).not.toThrow();
    expect(() => wrapContextImageMethods(undefined)).not.toThrow();
    const empty = {};
    wrapContextImageMethods(empty);
    expect(Object.getOwnPropertyNames(empty)).toEqual([]);
  });
});

describe('wrapRealmImageMethods', () => {
  it('wraps the realm’s canvas classes and createImageBitmap()', async () => {
    const drawImage = vi.fn();
    const createPattern = vi.fn();
    const texSubImage3D = vi.fn();
    const createImageBitmap = vi.fn(async () => 'bitmap');
    class CanvasRenderingContext2D {}
    Object.assign(CanvasRenderingContext2D.prototype, {
      drawImage,
      createPattern,
    });
    class WebGL2RenderingContext {}
    Object.assign(WebGL2RenderingContext.prototype, { texSubImage3D });
    const target: Record<string, any> = {
      CanvasRenderingContext2D,
      WebGL2RenderingContext,
      createImageBitmap,
    };
    wrapRealmImageMethods(target);

    const video = { tagName: 'VIDEO' };
    const context = new CanvasRenderingContext2D() as {
      drawImage(...args: unknown[]): unknown;
      createPattern(...args: unknown[]): unknown;
    };
    context.drawImage(templateElement(video), 1, 2);
    expect(drawImage).toHaveBeenCalledWith(video, 1, 2);
    expect(drawImage.mock.contexts[0]).toBe(context);
    context.createPattern(templateElement(video), 'repeat');
    expect(createPattern).toHaveBeenCalledWith(video, 'repeat');
    const gl = new WebGL2RenderingContext() as {
      texSubImage3D(...args: unknown[]): unknown;
    };
    gl.texSubImage3D(1, 0, 0, 0, 0, 2, 2, 1, 3, 4, templateElement(video));
    expect(texSubImage3D).toHaveBeenCalledWith(
      1,
      0,
      0,
      0,
      0,
      2,
      2,
      1,
      3,
      4,
      video,
    );
    // The prototypes' methods stay enumerable, as the browser's are.
    expect(Object.keys(CanvasRenderingContext2D.prototype)).toEqual([
      'drawImage',
      'createPattern',
    ]);

    const options = { imageOrientation: 'flipY' };
    await expect(
      target['createImageBitmap'](templateElement(video), options),
    ).resolves.toBe('bitmap');
    expect(createImageBitmap).toHaveBeenCalledWith(video, options);
  });

  it('skips what the realm doesn’t have', () => {
    const target: Record<string, any> = { WebGLRenderingContext: {} };
    expect(() => wrapRealmImageMethods(target)).not.toThrow();
    expect(target['createImageBitmap']).toBeUndefined();
  });
});

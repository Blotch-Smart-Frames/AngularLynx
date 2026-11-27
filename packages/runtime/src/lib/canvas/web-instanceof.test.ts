import { describe, expect, it } from 'vitest';
import { acceptPageInstances } from './web-instanceof';

/**
 * A realm's classes, as the browser's are related: each element class
 * extends HTMLElement, whose static methods (Symbol.hasInstance among them)
 * its subclasses inherit.
 */
const realmClasses = () => {
  class HTMLElement {}
  class HTMLDivElement extends HTMLElement {}
  class HTMLCanvasElement extends HTMLElement {}
  class HTMLVideoElement extends HTMLElement {}
  class CanvasRenderingContext2D {}
  class WebGL2RenderingContext {}
  class CanvasGradient {}
  class ImageData {}
  return {
    HTMLElement,
    HTMLDivElement,
    HTMLCanvasElement,
    HTMLVideoElement,
    CanvasRenderingContext2D,
    WebGL2RenderingContext,
    CanvasGradient,
    ImageData,
  };
};

/**
 * web-core's iframe, where Angular runs, inside the page, which holds the
 * elements a template's are made of.
 */
const realms = () => {
  const page: Record<string, any> = { ...realmClasses() };
  const document = { defaultView: page };
  page['document'] = document;
  const iframe: Record<string, any> = { ...realmClasses(), parent: page };
  iframe['document'] = { defaultView: iframe };
  /**
   * A DOM element of the page, as web-core makes them.
   */
  const pageNode = <T extends object>(Class: new () => T): T =>
    Object.assign(new Class(), { ownerDocument: document });
  acceptPageInstances(iframe);
  return { page, iframe, pageNode };
};

/**
 * A template's element, around its DOM element.
 */
const templateElement = (element: object) => ({
  element,
  observeLayout: () => () => {},
});

describe('acceptPageInstances', () => {
  it('makes a template’s <video> and <canvas> instances of the iframe’s classes', () => {
    const { page, iframe, pageNode } = realms();
    const video = templateElement(pageNode(page['HTMLVideoElement']));
    const canvas = templateElement(pageNode(page['HTMLCanvasElement']));
    const view = templateElement(pageNode(page['HTMLDivElement']));

    expect(video).toBeInstanceOf(iframe['HTMLVideoElement']);
    expect(video).not.toBeInstanceOf(iframe['HTMLCanvasElement']);
    expect(canvas).toBeInstanceOf(iframe['HTMLCanvasElement']);
    expect(canvas).not.toBeInstanceOf(iframe['HTMLVideoElement']);
    // Every template element is an HTMLElement, as on Lynx.
    expect(video).toBeInstanceOf(iframe['HTMLElement']);
    expect(view).toBeInstanceOf(iframe['HTMLElement']);
    // The DOM element itself too, as on the page.
    expect(canvas.element).toBeInstanceOf(iframe['HTMLCanvasElement']);
  });

  it('makes the contexts and objects of a page canvas instances', () => {
    const { page, iframe, pageNode } = realms();
    // A context, gradient or image data has no window of its own: they're
    // the page's, the iframe's parent.
    const context = Object.assign(new page['CanvasRenderingContext2D'](), {
      canvas: pageNode(page['HTMLCanvasElement']),
    });
    expect(context).toBeInstanceOf(iframe['CanvasRenderingContext2D']);
    expect(context.canvas).toBeInstanceOf(iframe['HTMLCanvasElement']);
    expect(new page['WebGL2RenderingContext']()).toBeInstanceOf(
      iframe['WebGL2RenderingContext'],
    );
    expect(new page['CanvasGradient']()).toBeInstanceOf(
      iframe['CanvasGradient'],
    );
    expect(new page['ImageData']()).toBeInstanceOf(iframe['ImageData']);
    expect(context).not.toBeInstanceOf(iframe['WebGL2RenderingContext']);
  });

  it('keeps the iframe’s own instances, and turns away the rest', () => {
    const { iframe } = realms();
    expect(new iframe['HTMLCanvasElement']()).toBeInstanceOf(
      iframe['HTMLCanvasElement'],
    );
    expect(new iframe['HTMLCanvasElement']()).toBeInstanceOf(
      iframe['HTMLElement'],
    );
    expect(new iframe['ImageData']()).toBeInstanceOf(iframe['ImageData']);
    for (const value of [{}, null, undefined, 3, 'canvas']) {
      expect(value).not.toBeInstanceOf(iframe['HTMLElement']);
      expect(value).not.toBeInstanceOf(iframe['CanvasRenderingContext2D']);
    }
    // An object holding an `element` that isn't a template element.
    expect({ element: new iframe['HTMLVideoElement']() }).not.toBeInstanceOf(
      iframe['HTMLVideoElement'],
    );
    // A template element around a primitive (never so, but not a crash).
    expect(templateElement(3 as never)).not.toBeInstanceOf(
      iframe['HTMLElement'],
    );
  });

  it('leaves HTMLElement’s subclasses as they are', () => {
    const { page, iframe, pageNode } = realms();
    // HTMLDivElement inherits HTMLElement's Symbol.hasInstance; only
    // HTMLElement itself takes the page's instances.
    const div = pageNode(page['HTMLDivElement']);
    expect(div).not.toBeInstanceOf(iframe['HTMLDivElement']);
    expect(templateElement(div)).not.toBeInstanceOf(iframe['HTMLDivElement']);
    expect(new iframe['HTMLDivElement']()).toBeInstanceOf(
      iframe['HTMLDivElement'],
    );
  });

  it('reads a node’s own window when it isn’t the parent', () => {
    const { iframe } = realms();
    const other: Record<string, any> = { ...realmClasses() };
    const video = Object.assign(new other['HTMLVideoElement'](), {
      ownerDocument: { defaultView: other },
    });
    expect(templateElement(video)).toBeInstanceOf(iframe['HTMLVideoElement']);
  });

  it('finds nothing in a window of another origin', () => {
    const iframe: Record<string, any> = {
      ...realmClasses(),
      // Every read of a cross-origin window's properties throws.
      parent: new Proxy(
        {},
        {
          get: () => {
            throw new Error('SecurityError');
          },
        },
      ),
    };
    acceptPageInstances(iframe);
    const page = realmClasses();
    expect(new page.ImageData()).not.toBeInstanceOf(iframe['ImageData']);
  });

  it('runs without a parent window, and skips the classes a realm lacks', () => {
    const { ImageData } = realmClasses();
    const iframe: Record<string, any> = { ImageData };
    expect(() => acceptPageInstances(iframe)).not.toThrow();
    expect(new ImageData()).toBeInstanceOf(ImageData);
    expect(new (realmClasses().ImageData)()).not.toBeInstanceOf(ImageData);
  });

  it('gives each class its Symbol.hasInstance once', () => {
    const { iframe } = realms();
    const hasInstance = iframe['HTMLVideoElement'][Symbol.hasInstance];
    acceptPageInstances(iframe);
    expect(iframe['HTMLVideoElement'][Symbol.hasInstance]).toBe(hasInstance);
  });
});

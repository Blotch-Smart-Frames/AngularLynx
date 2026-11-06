import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCanvasGlobals } from './dom-globals';
import { createImageBitmap, LynxImageBitmap, LynxImageElement } from './image';
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
    expect(target['devicePixelRatio']).toBe(3);
    expect(target['document'].createElement('IMG')).toBeInstanceOf(
      LynxImageElement,
    );
    expect(
      target['document'].createElementNS('http://www.w3.org/1999/xhtml', 'img'),
    ).toBeInstanceOf(LynxImageElement);
    expect(() => target['document'].createElement('canvas')).toThrow(
      /Put a <canvas> in a template/,
    );
  });

  it('makes a template’s elements HTMLElements, and nothing an HTMLCanvasElement', () => {
    const target: Record<string, any> = {};
    installCanvasGlobals(target);
    expect(element() instanceof target['HTMLElement']).toBe(true);
    expect({} instanceof target['HTMLElement']).toBe(false);
    expect(null instanceof target['HTMLElement']).toBe(false);
    expect(element() instanceof target['HTMLCanvasElement']).toBe(false);
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
    const target: Record<string, any> = {
      performance: own,
      crypto: own,
      devicePixelRatio: 2,
      document: { createElement },
    };
    installCanvasGlobals(target);
    expect(target['performance']).toBe(own);
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

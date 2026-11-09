import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeWebGLBridge,
  type FakeWebGLBridge,
} from '../testing/fake-webgl-bridge';
import type { ElementRef } from '../types/lynx';
import { LynxCanvasElement } from './canvas-element';
import { setWebGLBridgeForTesting } from './webgl-bridge';
import { OP } from './webgl-ops';
import { LynxWebGL2RenderingContext } from './webgl2-context';

let bridge: FakeWebGLBridge;
let uid = 1;

beforeEach(() => {
  bridge = createFakeWebGLBridge();
  setWebGLBridgeForTesting(bridge);
  globalThis.__GetElementUniqueID = vi.fn(() => uid++);
  globalThis.__SetAttribute = vi.fn();
  globalThis.__AddInlineStyle = vi.fn();
  globalThis.__SetInlineStyles = vi.fn();
  globalThis.__AddEvent = vi.fn();
  globalThis.__SetDataset = vi.fn();
  globalThis.__InvokeUIMethod = vi.fn();
});

afterEach(() => {
  setWebGLBridgeForTesting(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LynxCanvasElement', () => {
  it('pairs itself with the shell’s view, and follows its layout', () => {
    const ref = {} as ElementRef;
    const canvas = new LynxCanvasElement(ref);
    expect(canvas.tagName).toBe('canvas');
    expect(canvas.canvasId).toMatch(/^c[0-9a-z]+-\d+$/);
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      ref,
      'canvas-id',
      canvas.canvasId,
    );
    expect(new LynxCanvasElement({} as ElementRef).canvasId).not.toBe(
      canvas.canvasId,
    );
    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      ref,
      'bindEvent',
      'layoutchange',
      expect.anything(),
    );
  });

  it('sizes its drawing buffer, 300 by 150 to start', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    expect([canvas.width, canvas.height]).toEqual([300, 150]);
    canvas.width = 640.7;
    canvas.height = -1;
    expect([canvas.width, canvas.height]).toEqual([640, 0]);
    canvas.setAttribute('width', '120');
    canvas.setProperty('height', 80);
    canvas.width = Number.NaN;
    expect([canvas.width, canvas.height]).toEqual([0, 80]);
    canvas.height = Number.NaN;
    expect(canvas.height).toBe(0);
    canvas.setAttribute('width', 10);
    expect(globalThis.__SetAttribute).not.toHaveBeenCalledWith(
      expect.anything(),
      'width',
      expect.anything(),
    );
    canvas.setProperty('accessibility-label', 'Scene');
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      canvas.element,
      'accessibility-label',
      'Scene',
    );
  });

  it('gives a WebGL2 context, the same one each time', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    canvas.width = 64;
    canvas.height = 32;
    expect(canvas.getContext('2d')).toBeNull();
    expect(canvas.getContext('webgl')).toBeNull();
    const gl = canvas.getContext('webgl2', {
      antialias: false,
    }) as LynxWebGL2RenderingContext;
    expect(gl).toBeInstanceOf(LynxWebGL2RenderingContext);
    expect(gl.canvas).toBe(canvas);
    expect(canvas.getContext('webgl2')).toBe(gl);
    expect(bridge.create).toHaveBeenCalledWith(
      expect.any(Number),
      canvas.canvasId,
      expect.objectContaining({ antialias: false, width: 64, height: 32 }),
    );
    expect(gl.drawingBufferWidth).toBe(64);
  });

  it('resizes the context’s drawing buffer with the canvas', async () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    canvas.getContext('webgl2');
    canvas.width = 100;
    canvas.height = 50;
    await Promise.resolve();
    expect(bridge.sent()).toEqual([OP.resize, 100, 150, OP.resize, 100, 50]);
  });

  it('has no context without the shell’s module, or when the shell can’t make one', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = new LynxCanvasElement({} as ElementRef);
    const failed = vi.fn();
    canvas.addEventListener('webglcontextcreationerror', failed);
    setWebGLBridgeForTesting(null);
    expect(canvas.getContext('webgl2')).toBeNull();
    setWebGLBridgeForTesting(bridge);
    bridge.create.mockReturnValueOnce({ ok: false, error: 'No GLES 3' });
    expect(canvas.getContext('webgl2')).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[angular-lynx] No WebGL2 on this canvas: No GLES 3',
    );
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('makes a new context once the old one is lost', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    const lost = vi.fn(
      (event: { preventDefault(): void; stopPropagation(): void }) => {
        event.stopPropagation();
        event.preventDefault();
      },
    );
    canvas.addEventListener('webglcontextlost', lost);
    const gl = canvas.getContext('webgl2') as LynxWebGL2RenderingContext;
    (
      gl.getExtension('WEBGL_lose_context') as { loseContext(): void }
    ).loseContext();
    expect(lost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'webglcontextlost', target: canvas }),
    );
    const next = canvas.getContext('webgl2');
    expect(next).not.toBe(gl);
    expect(next).toBeInstanceOf(LynxWebGL2RenderingContext);
  });

  it('frees its context when Angular destroys it', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    canvas.releaseContext();
    canvas.getContext('webgl2');
    canvas.releaseContext();
    expect(bridge.destroy).toHaveBeenCalledOnce();
  });

  it('frees its context when it is garbage-collected', async () => {
    // A FinalizationRegistry whose callbacks the test runs, as the engine
    // would once the canvas is collected. The module makes its registry when
    // it loads, so it's loaded again under the stub.
    // LynxElement's registry has one too, which the canvas is registered
    // with when it's made, so each registration keeps its registry's
    // callback.
    const finalizers: {
      target: object;
      held: unknown;
      cleanup: (held: unknown) => void;
    }[] = [];
    vi.stubGlobal(
      'FinalizationRegistry',
      class {
        readonly #cleanup: (held: unknown) => void;
        constructor(cleanup: (held: unknown) => void) {
          this.#cleanup = cleanup;
        }
        register(target: object, held: unknown): void {
          finalizers.push({ target, held, cleanup: this.#cleanup });
        }
      },
    );
    vi.resetModules();
    const fresh = await import('./canvas-element');
    const freshBridge = await import('./webgl-bridge');
    freshBridge.setWebGLBridgeForTesting(bridge);

    const canvas = new fresh.LynxCanvasElement({} as ElementRef);
    const made = finalizers.length;
    canvas.getContext('webgl2');
    expect(finalizers).toHaveLength(made + 1);
    const context = finalizers.at(-1)!;
    expect(context.target).toBe(canvas);
    expect(bridge.destroy).not.toHaveBeenCalled();

    context.cleanup(context.held);
    expect(bridge.destroy).toHaveBeenCalledOnce();
    freshBridge.setWebGLBridgeForTesting(undefined);
  });

  it('still makes a context where the engine has no FinalizationRegistry', async () => {
    vi.stubGlobal('FinalizationRegistry', undefined);
    vi.resetModules();
    const fresh = await import('./canvas-element');
    const freshBridge = await import('./webgl-bridge');
    freshBridge.setWebGLBridgeForTesting(bridge);

    const canvas = new fresh.LynxCanvasElement({} as ElementRef);
    expect(canvas.getContext('webgl2')).not.toBeNull();
    freshBridge.setWebGLBridgeForTesting(undefined);
  });

  it('fires the context’s events to its listeners', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    expect(canvas.dispatchContextEvent('webglcontextlost')).toBe(true);
    const listener = vi.fn();
    const remove = canvas.addEventListener('webglcontextrestored', listener);
    expect(canvas.dispatchContextEvent('webglcontextrestored')).toBe(true);
    remove();
    canvas.addEventListener('webglcontextrestored', listener);
    canvas.addEventListener('webglcontextrestored', listener);
    canvas.removeEventListener('webglcontextrestored', listener);
    canvas.removeEventListener('webglcontextlost', listener);
    expect(canvas.dispatchContextEvent('webglcontextrestored')).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    // Other events are the element's own.
    const tap = vi.fn();
    canvas.addEventListener('bindtap', tap);
    canvas.removeEventListener('bindtap', tap);
  });

  it('styles the element through `style`', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    canvas.style.width = '120px';
    canvas.style['--glow'] = 'red';
    expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
      canvas.element,
      'width',
      '120px',
    );
    expect(canvas.style.width).toBe('120px');
    expect(canvas.style.touchAction).toBe('');
    const style = canvas.style as unknown as {
      setProperty(name: string, value: string | null): void;
      removeProperty(name: string): string;
      getPropertyValue(name: string): string;
      maxHeight: unknown;
    };
    style.setProperty('min-height', '10px');
    expect(style.getPropertyValue('min-height')).toBe('10px');
    expect(style.removeProperty('min-height')).toBe('10px');
    expect(style.removeProperty('min-height')).toBe('');
    expect(style.getPropertyValue('min-height')).toBe('');
    style.setProperty('opacity', null);
    style.setProperty('opacity', '');
    style.maxHeight = null;
    canvas.style.width = '';
    expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
      canvas.element,
      'width',
      null,
    );
    expect((canvas.style as any)[Symbol.iterator]).toBeUndefined();
    expect(Reflect.set(canvas.style, Symbol.iterator, 1)).toBe(false);
  });
});

describe('LynxCanvasElement as an image', () => {
  const drawn = () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    canvas.width = 4;
    canvas.height = 2;
    const gl = canvas.getContext('webgl2') as LynxWebGL2RenderingContext;
    return { canvas, gl };
  };

  it('is a PNG data: URL of what the shell encoded', () => {
    const { canvas } = drawn();
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AQI=');
    expect(bridge.encodeImage).toHaveBeenCalledWith(expect.any(Number), {
      type: 'image/png',
      quality: 0.92,
      premultipliedAlpha: true,
    });
  });

  it('is a JPEG of the quality asked for, whatever the type’s case', () => {
    const { canvas } = drawn();
    expect(canvas.toDataURL('IMAGE/JPEG', 0.5)).toBe(
      'data:image/jpeg;base64,AQI=',
    );
    expect(bridge.encodeImage).toHaveBeenLastCalledWith(expect.any(Number), {
      type: 'image/jpeg',
      quality: 0.5,
      premultipliedAlpha: true,
    });
  });

  it.each([[1.5], [-1], ['0.5'], [Number.NaN]])(
    'uses 0.92 for a quality of %o, as browsers do',
    (quality) => {
      const { canvas } = drawn();
      canvas.toDataURL('image/jpeg', quality);
      expect(bridge.encodeImage).toHaveBeenLastCalledWith(
        expect.any(Number),
        expect.objectContaining({ quality: 0.92 }),
      );
    },
  );

  it('is a PNG for a type other than JPEG and PNG, as browsers fall back to', () => {
    const { canvas } = drawn();
    expect(canvas.toDataURL('image/webp')).toBe('data:image/png;base64,AQI=');
  });

  it('tells the shell when the colors are straight', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    canvas.getContext('webgl2', { premultipliedAlpha: false });
    canvas.toDataURL();
    expect(bridge.encodeImage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ premultipliedAlpha: false }),
    );
  });

  it('sends what was drawn before reading it, without showing the frame', () => {
    const { canvas, gl } = drawn();
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const sent = bridge.batches.length;
    canvas.toDataURL();
    expect(bridge.batches).toHaveLength(sent + 1);
    expect(bridge.batches.at(-1)).toContain(OP.clear);
    expect(bridge.batches.at(-1)).not.toContain(OP.present);
  });

  it('is `data:,` with nothing to read, as a browser’s is for an empty canvas', () => {
    const plain = new LynxCanvasElement({} as ElementRef);
    expect(plain.toDataURL()).toBe('data:,');

    const { canvas } = drawn();
    canvas.width = 0;
    expect(canvas.toDataURL()).toBe('data:,');

    const lost = drawn();
    (
      lost.gl.getExtension('WEBGL_lose_context') as { loseContext(): void }
    ).loseContext();
    expect(lost.canvas.toDataURL()).toBe('data:,');
    expect(bridge.encodeImage).not.toHaveBeenCalled();
  });

  it('is `data:,` with a warning when the shell can’t encode it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.encodeImage.mockReturnValueOnce({ error: 'Out of memory' });
    const { canvas } = drawn();
    expect(canvas.toDataURL()).toBe('data:,');
    expect(warn).toHaveBeenCalledWith(
      "[angular-lynx] The canvas couldn't be encoded: Out of memory",
    );
  });

  it('takes the type the shell answers with', () => {
    bridge.encodeImage.mockReturnValueOnce({ base64: 'AQI=' });
    const { canvas } = drawn();
    expect(canvas.toDataURL('image/jpeg')).toBe('data:image/jpeg;base64,AQI=');
  });

  it('calls back on a later task with a Blob read when it was called', async () => {
    vi.useFakeTimers();
    try {
      const { canvas } = drawn();
      const callback = vi.fn();
      canvas.toBlob(callback, 'image/jpeg', 0.8);
      expect(bridge.encodeImage).toHaveBeenCalledWith(expect.any(Number), {
        type: 'image/jpeg',
        quality: 0.8,
        premultipliedAlpha: true,
      });
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
      vi.runAllTimers();
      const blob = callback.mock.calls[0]![0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/jpeg');
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls back with null when there’s nothing to encode', async () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    expect(blob).toBeNull();
  });

  it('needs a callback, as HTMLCanvasElement’s does', () => {
    const { canvas } = drawn();
    expect(() => canvas.toBlob(undefined as never)).toThrow(TypeError);
    expect(bridge.encodeImage).not.toHaveBeenCalled();
  });
});

describe('LynxCanvasElement on Lynx for Web', () => {
  it('is the browser’s canvas', () => {
    vi.stubGlobal('__WEB__', true);
    const context = {};
    const dom = {
      width: 300,
      height: 150,
      style: { width: '' },
      getContext: vi.fn(() => context),
    };
    const canvas = new LynxCanvasElement(dom as unknown as ElementRef);
    expect(canvas.style).toBe(dom.style);
    canvas.width = 10;
    canvas.height = 20;
    expect([dom.width, dom.height]).toEqual([10, 20]);
    expect([canvas.width, canvas.height]).toEqual([10, 20]);
    expect(canvas.getContext('webgl2', { alpha: false })).toBe(context);
    expect(dom.getContext).toHaveBeenCalledWith('webgl2', { alpha: false });
    expect(globalThis.__SetAttribute).not.toHaveBeenCalledWith(
      dom,
      'canvas-id',
      expect.anything(),
    );
    canvas.setAttribute('width', '30');
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(dom, 'width', '30');
    const listener = vi.fn();
    canvas.addEventListener('webglcontextlost', listener);
    canvas.removeEventListener('webglcontextlost', listener);
  });

  it('saves the image with the browser’s canvas, as a Blob of the app’s realm', async () => {
    vi.stubGlobal('__WEB__', true);
    // The page's Blob, which the app's realm (web-core's iframe) wouldn't
    // count as its own.
    const pageBlob = { type: 'image/jpeg', bytes: [9] };
    const dom = {
      style: {},
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,CQ=='),
      toBlob: vi.fn(
        (callback: (blob: unknown) => void, _type: string, _quality: number) =>
          callback(pageBlob),
      ),
    };
    const blobOf = vi.fn();
    vi.stubGlobal(
      'Blob',
      class {
        readonly type: string;
        constructor(parts: unknown[], options: { type: string }) {
          blobOf(parts);
          this.type = options.type;
        }
      },
    );
    const canvas = new LynxCanvasElement(dom as unknown as ElementRef);
    expect(canvas.toDataURL('image/jpeg', 0.5)).toBe(
      'data:image/jpeg;base64,CQ==',
    );
    expect(dom.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.5);
    const callback = vi.fn();
    canvas.toBlob(callback, 'image/jpeg', 0.7);
    expect(dom.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      0.7,
    );
    expect(blobOf).toHaveBeenCalledWith([pageBlob]);
    expect(callback.mock.calls[0]![0]).toMatchObject({ type: 'image/jpeg' });
    dom.toBlob.mockImplementationOnce((done: (blob: unknown) => void) =>
      done(null),
    );
    canvas.toBlob(callback);
    expect(callback).toHaveBeenLastCalledWith(null);
  });
});

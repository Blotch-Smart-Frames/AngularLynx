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
    const finalizers: { target: object; held: unknown }[] = [];
    let callback: (held: unknown) => void = () => {};
    vi.stubGlobal(
      'FinalizationRegistry',
      class {
        constructor(cleanup: (held: unknown) => void) {
          callback = cleanup;
        }
        register(target: object, held: unknown): void {
          finalizers.push({ target, held });
        }
      },
    );
    vi.resetModules();
    const fresh = await import('./canvas-element');
    const freshBridge = await import('./webgl-bridge');
    freshBridge.setWebGLBridgeForTesting(bridge);

    const canvas = new fresh.LynxCanvasElement({} as ElementRef);
    canvas.getContext('webgl2');
    expect(finalizers).toHaveLength(1);
    expect(finalizers[0]!.target).toBe(canvas);
    expect(bridge.destroy).not.toHaveBeenCalled();

    callback(finalizers[0]!.held);
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

  it('can’t be saved as an image', () => {
    const canvas = new LynxCanvasElement({} as ElementRef);
    expect(() => canvas.toDataURL()).toThrow(/readPixels/);
    expect(() => canvas.toBlob()).toThrow(/readPixels/);
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
});

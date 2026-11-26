import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeCanvas2DBridge,
  type FakeCanvas2DBridge,
} from '../testing/fake-canvas-2d-bridge';
import {
  createFakeWebGLBridge,
  type FakeWebGLBridge,
} from '../testing/fake-webgl-bridge';
import { LynxCanvasRenderingContext2D } from './canvas-2d-context';
import { OP } from './canvas-2d-ops';
import { canvasSourceOf } from './canvas-source';
import { LynxDetachedCanvas, LynxOffscreenCanvas } from './detached-canvas';
import {
  setCanvas2DBridgeForTesting,
  setWebGLBridgeForTesting,
} from './webgl-bridge';
import { LynxWebGL2RenderingContext } from './webgl2-context';

let bridge2D: FakeCanvas2DBridge;
let bridgeGL: FakeWebGLBridge;

beforeEach(() => {
  bridge2D = createFakeCanvas2DBridge();
  bridgeGL = createFakeWebGLBridge();
  setCanvas2DBridgeForTesting(bridge2D);
  setWebGLBridgeForTesting(bridgeGL);
});

afterEach(() => {
  setCanvas2DBridgeForTesting(undefined);
  setWebGLBridgeForTesting(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LynxDetachedCanvas', () => {
  it('is a 300 by 150 canvas with no view, sized as an HTML canvas is', () => {
    const canvas = new LynxDetachedCanvas();
    expect([canvas.tagName, canvas.nodeName]).toEqual(['CANVAS', 'CANVAS']);
    expect([canvas.width, canvas.height]).toEqual([300, 150]);
    canvas.width = 64.9;
    canvas.setAttribute('height', '32');
    canvas.setAttribute('id', 'x');
    expect([canvas.width, canvas.height]).toEqual([64, 32]);
    canvas.style.width = '10px';
    expect(canvas.getBoundingClientRect()).toMatchObject({
      width: 0,
      height: 0,
    });
  });

  it('makes a 2D context in the shell, its size, and keeps it', () => {
    const canvas = new LynxDetachedCanvas();
    canvas.width = 20;
    const context = canvas.getContext('2d', { alpha: false });
    expect(context).toBeInstanceOf(LynxCanvasRenderingContext2D);
    expect(canvas.getContext('2d')).toBe(context);
    const source = canvasSourceOf(canvas)!;
    expect(bridge2D.create2D).toHaveBeenCalledWith(
      expect.any(Number),
      source.canvasId,
      {
        alpha: false,
        width: 20,
        height: 150,
      },
    );
    expect((context as LynxCanvasRenderingContext2D).canvas).toBe(canvas);
    // One kind of context to a canvas.
    expect(canvas.getContext('webgl2')).toBeNull();
    expect(canvas.getContext('bitmaprenderer')).toBeNull();
  });

  it('resizes its 2D context’s bitmap', () => {
    const canvas = new LynxDetachedCanvas();
    const context = canvas.getContext('2d') as LynxCanvasRenderingContext2D;
    canvas.width = 10;
    canvas.height = 5;
    context.flush();
    expect(bridge2D.sent()).toEqual([OP.resize, 10, 150, OP.resize, 10, 5]);
  });

  it('has no 2D context without the shell, or when the shell can’t make one', () => {
    setCanvas2DBridgeForTesting(null);
    expect(new LynxDetachedCanvas().getContext('2d')).toBeNull();
    setCanvas2DBridgeForTesting(bridge2D);
    bridge2D.create2D.mockReturnValueOnce({ ok: false, error: 'too big' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = new LynxDetachedCanvas();
    expect(canvas.getContext('2d')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/No 2D context on this canvas: too big/),
    );
    // The canvas can try again.
    expect(canvas.getContext('2d')).not.toBeNull();
  });

  it('makes a WebGL2 context too, firing its events at the canvas', () => {
    const canvas = new LynxDetachedCanvas();
    const lost = vi.fn(
      (event: { preventDefault(): void; stopPropagation(): void }) => {
        event.stopPropagation();
        event.preventDefault();
      },
    );
    canvas.addEventListener('webglcontextlost', lost);
    expect(canvas.getContext('webgl2')).toBeInstanceOf(
      LynxWebGL2RenderingContext,
    );
    expect(canvas.dispatchContextEvent('webglcontextlost')).toBe(false);
    expect(lost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'webglcontextlost', target: canvas }),
    );
    canvas.removeEventListener('webglcontextlost', lost);
    expect(canvas.dispatchContextEvent('webglcontextlost')).toBe(true);
    expect(canvas.dispatchContextEvent('other')).toBe(true);
  });

  it('fires webglcontextcreationerror without WebGL', () => {
    setWebGLBridgeForTesting(null);
    const canvas = new LynxDetachedCanvas();
    const failed = vi.fn();
    canvas.addEventListener('webglcontextcreationerror', failed);
    canvas.addEventListener('webglcontextcreationerror', vi.fn());
    expect(canvas.getContext('webgl2')).toBeNull();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('is an image source: its calls are sent before it’s read', () => {
    const canvas = new LynxDetachedCanvas();
    const source = canvasSourceOf(canvas)!;
    expect(source.readable).toBe(false);
    expect([source.width, source.height]).toEqual([300, 150]);
    source.flush();
    const context = canvas.getContext('2d') as LynxCanvasRenderingContext2D;
    expect(source.readable).toBe(true);
    context.fillRect(0, 0, 1, 1);
    source.flush();
    expect(bridge2D.batches.length).toBe(1);
  });

  it('encodes its 2D bitmap', async () => {
    const canvas = new LynxDetachedCanvas();
    // Before there's a context, a transparent image of its size, from a
    // bitmap of the shell's own, which leaves the canvas free.
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AQI=');
    const [blankId, blankCanvas, blankSize] = bridge2D.create2D.mock.calls[0];
    expect(blankCanvas).toMatch(/-blank$/);
    expect(blankSize).toEqual({ alpha: true, width: 300, height: 150 });
    expect(bridge2D.destroy2D).toHaveBeenCalledWith(blankId);
    expect(canvasSourceOf(canvas)!.readable).toBe(false);
    // Without a shell, or one that can't make the bitmap, there's nothing.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge2D.create2D.mockReturnValueOnce({ ok: false, error: 'too big' });
    expect(canvas.toDataURL()).toBe('data:,');
    setCanvas2DBridgeForTesting(null);
    expect(canvas.toDataURL()).toBe('data:,');
    setCanvas2DBridgeForTesting(bridge2D);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/too big/));
    canvas.getContext('2d');
    expect(canvas.toDataURL('IMAGE/JPEG', 0.5)).toBe(
      'data:image/jpeg;base64,AQI=',
    );
    expect(bridge2D.encode2D).toHaveBeenLastCalledWith(expect.any(Number), {
      type: 'image/jpeg',
      quality: 0.5,
    });
    canvas.toDataURL('image/webp', 2);
    expect(bridge2D.encode2D).toHaveBeenLastCalledWith(expect.any(Number), {
      type: 'image/png',
      quality: 0.92,
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve),
    );
    expect(blob?.type).toBe('image/png');
    expect(() => canvas.toBlob(null as never)).toThrow(/is not a function/);
    // An encode the shell can't do.
    bridge2D.encode2D.mockReturnValueOnce({ error: 'no' });
    expect(canvas.toDataURL()).toBe('data:,');
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/couldn't be encoded: no/),
    );
    // A canvas with no pixels has nothing to encode.
    canvas.width = 0;
    expect(canvas.toDataURL()).toBe('data:,');
  });

  it('encodes a WebGL drawing buffer, and has none once it’s lost', () => {
    const canvas = new LynxDetachedCanvas();
    const gl = canvas.getContext('webgl2') as LynxWebGL2RenderingContext;
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AQI=');
    gl.getExtension('WEBGL_lose_context')!.loseContext();
    expect(canvas.toDataURL()).toBe('data:,');
  });

  it('frees its context when it’s released, or collected', async () => {
    const held: (() => void)[] = [];
    vi.stubGlobal(
      'FinalizationRegistry',
      class {
        constructor(readonly callback: (free: () => void) => void) {}
        register(_target: object, free: () => void) {
          held.push(() => this.callback(free));
        }
      },
    );
    vi.resetModules();
    const bridges = await import('./webgl-bridge');
    bridges.setCanvas2DBridgeForTesting(bridge2D);
    bridges.setWebGLBridgeForTesting(bridgeGL);
    const { LynxDetachedCanvas: Fresh } = await import('./detached-canvas');
    const canvas = new Fresh();
    canvas.getContext('2d');
    canvas.surface.release();
    expect(bridge2D.destroy2D).toHaveBeenCalledOnce();
    new Fresh().getContext('webgl2');
    for (const free of held) free();
    expect(bridge2D.destroy2D).toHaveBeenCalledTimes(2);
    expect(bridgeGL.destroy).toHaveBeenCalledOnce();
    bridges.setCanvas2DBridgeForTesting(undefined);
    bridges.setWebGLBridgeForTesting(undefined);
  });
});

describe('LynxOffscreenCanvas', () => {
  it('is a canvas of the size given, which must be one', () => {
    const canvas = new LynxOffscreenCanvas(32.5, 0);
    expect([canvas.width, canvas.height]).toEqual([32, 0]);
    canvas.width = 8.9;
    canvas.height = 4;
    expect([canvas.width, canvas.height]).toEqual([8, 4]);
    // [EnforceRange] unsigned long long: a TypeError, and the size kept.
    expect(() => new LynxOffscreenCanvas(32, -2)).toThrow(
      /Failed to construct 'OffscreenCanvas'/,
    );
    expect(() => new LynxOffscreenCanvas(NaN, 4)).toThrow(TypeError);
    expect(() => (canvas.width = -1)).toThrow(/'width' property/);
    expect(() => (canvas.height = Infinity)).toThrow(/'height' property/);
    expect([canvas.width, canvas.height]).toEqual([8, 4]);
  });

  it('encodes its image with convertToBlob()', async () => {
    const canvas = new LynxOffscreenCanvas(4, 4);
    // A transparent image before there's a context, as in a browser.
    expect((await canvas.convertToBlob()).type).toBe('image/png');
    canvas.getContext('2d');
    // An encode the shell can't do.
    bridge2D.encode2D.mockReturnValueOnce({ error: 'no' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(canvas.convertToBlob()).rejects.toMatchObject({
      name: 'EncodingError',
    });
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.5,
    });
    expect(blob.type).toBe('image/jpeg');
    canvas.width = 0;
    await expect(canvas.convertToBlob()).rejects.toMatchObject({
      name: 'IndexSizeError',
    });
    expect(() => canvas.transferToImageBitmap()).toThrow(
      /not available on Lynx/,
    );
  });
});

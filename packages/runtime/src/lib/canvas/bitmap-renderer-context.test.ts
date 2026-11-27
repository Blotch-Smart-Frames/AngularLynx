import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeBitmapRendererBridge,
  type FakeBitmapRendererBridge,
} from '../testing/fake-bitmap-renderer-bridge';
import {
  createFakeWebGLBridge,
  type FakeWebGLBridge,
} from '../testing/fake-webgl-bridge';
import type { ElementRef } from '../types/lynx';
import {
  bitmapRendererSettingsFrom,
  LynxImageBitmapRenderingContext,
} from './bitmap-renderer-context';
import { LynxCanvasElement } from './canvas-element';
import { canvasSourceOf } from './canvas-source';
import { LynxDetachedCanvas, LynxOffscreenCanvas } from './detached-canvas';
import { createImageBitmap, LynxImageBitmap } from './image';
import {
  setBitmapRendererBridgeForTesting,
  setWebGLBridgeForTesting,
} from './webgl-bridge';

let bridge: FakeBitmapRendererBridge;
let bridgeGL: FakeWebGLBridge;

beforeEach(() => {
  bridge = createFakeBitmapRendererBridge();
  bridgeGL = createFakeWebGLBridge();
  setBitmapRendererBridgeForTesting(bridge);
  setWebGLBridgeForTesting(bridgeGL);
});

afterEach(() => {
  setBitmapRendererBridgeForTesting(undefined);
  setWebGLBridgeForTesting(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const contextOf = (canvas: {
  getContext(type: string, settings?: unknown): unknown;
}): LynxImageBitmapRenderingContext =>
  canvas.getContext('bitmaprenderer') as LynxImageBitmapRenderingContext;

/**
 * The context id the shell was asked to make the canvas's context under.
 */
const contextIdOf = (call = 0): number =>
  bridge.createBitmapRenderer.mock.calls[call][0];

describe('getContext("bitmaprenderer")', () => {
  it('makes the context in the shell, blank at the canvas’s size, and keeps it', () => {
    const canvas = new LynxDetachedCanvas();
    canvas.width = 20;
    const context = contextOf(canvas);
    expect(context).toBeInstanceOf(LynxImageBitmapRenderingContext);
    expect(contextOf(canvas)).toBe(context);
    expect(context.canvas).toBe(canvas);
    expect(bridge.createBitmapRenderer).toHaveBeenCalledExactlyOnceWith(
      expect.any(Number),
      canvasSourceOf(canvas)!.canvasId,
      { alpha: true, width: 20, height: 150 },
    );
    // One kind of context to a canvas.
    expect(canvas.getContext('2d')).toBeNull();
    expect(canvas.getContext('webgl2')).toBeNull();
  });

  it('reads alpha as Web IDL reads the dictionary', () => {
    expect(bitmapRendererSettingsFrom(undefined)).toEqual({ alpha: true });
    expect(bitmapRendererSettingsFrom({ alpha: 0 as never })).toEqual({
      alpha: false,
    });
    // Inherited, as a dictionary member is read by name.
    expect(
      bitmapRendererSettingsFrom(Object.create({ alpha: false }) as never),
    ).toEqual({ alpha: false });
    new LynxOffscreenCanvas(4, 2).getContext('bitmaprenderer', {
      alpha: false,
    });
    expect(bridge.createBitmapRenderer.mock.calls[0][2]).toEqual({
      alpha: false,
      width: 4,
      height: 2,
    });
  });

  it('is null without the shell’s module, or when the shell can’t make one', () => {
    setBitmapRendererBridgeForTesting(null);
    expect(new LynxOffscreenCanvas(4, 2).getContext('bitmaprenderer')).toBe(
      null,
    );
    setBitmapRendererBridgeForTesting(bridge);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.createBitmapRenderer.mockReturnValueOnce({
      ok: false,
      error: 'too old',
    });
    const canvas = new LynxOffscreenCanvas(4, 2);
    expect(canvas.getContext('bitmaprenderer')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('too old'));
    // It's asked again, as the canvas still has no context.
    expect(canvas.getContext('bitmaprenderer')).toBeInstanceOf(
      LynxImageBitmapRenderingContext,
    );
  });

  it('pairs a <canvas>’s context with its view, and frees it with the element', () => {
    globalThis.__GetElementUniqueID = vi.fn(() => 1);
    globalThis.__SetAttribute = vi.fn();
    globalThis.__AddEvent = vi.fn();
    globalThis.__SetDataset = vi.fn();
    globalThis.__InvokeUIMethod = vi.fn();
    const canvas = new LynxCanvasElement({} as ElementRef);
    expect(contextOf(canvas).canvas).toBe(canvas);
    expect(bridge.createBitmapRenderer.mock.calls[0][1]).toBe(canvas.canvasId);
    canvas.releaseContext();
    expect(bridge.destroyBitmapRenderer).toHaveBeenCalledExactlyOnceWith(
      contextIdOf(),
    );
  });
});

describe('a garbage-collected canvas', () => {
  it('frees its bitmaprenderer context', async () => {
    // A FinalizationRegistry whose callbacks the test runs, as the engine
    // would once the canvas is collected. The module makes its registry when
    // it loads, so it's loaded again under the stub.
    const finalizers: { held: unknown; cleanup: (held: unknown) => void }[] =
      [];
    vi.stubGlobal(
      'FinalizationRegistry',
      class {
        readonly #cleanup: (held: unknown) => void;
        constructor(cleanup: (held: unknown) => void) {
          this.#cleanup = cleanup;
        }
        register(_target: object, held: unknown): void {
          finalizers.push({ held, cleanup: this.#cleanup });
        }
        unregister(): void {}
      },
    );
    vi.resetModules();
    const fresh = await import('./detached-canvas');
    const freshBridge = await import('./webgl-bridge');
    freshBridge.setBitmapRendererBridgeForTesting(bridge);
    const canvas = new fresh.LynxOffscreenCanvas(8, 4);
    const made = finalizers.length;
    canvas.getContext('bitmaprenderer');
    expect(finalizers).toHaveLength(made + 1);
    const context = finalizers.at(-1)!;
    context.cleanup(context.held);
    expect(bridge.destroyBitmapRenderer).toHaveBeenCalledOnce();
    freshBridge.setBitmapRendererBridgeForTesting(undefined);
  });
});

describe('transferFromImageBitmap()', () => {
  it('hands the shell the bitmap’s image, and detaches the bitmap', () => {
    const canvas = new LynxOffscreenCanvas(8, 4);
    const context = contextOf(canvas);
    const bitmap = new LynxImageBitmap(7, 3, 2);
    context.transferFromImageBitmap(bitmap);
    expect(bridge.transferToBitmapRenderer).toHaveBeenCalledExactlyOnceWith(
      contextIdOf(),
      7,
      3,
      2,
    );
    expect([bitmap.width, bitmap.height]).toEqual([0, 0]);
    // The shell owns the pixels now: closing the bitmap leaves them.
    bitmap.close();
    expect(bridgeGL.releaseImage).not.toHaveBeenCalled();
    // A detached bitmap can't be transferred again.
    expect(() => context.transferFromImageBitmap(bitmap)).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
  });

  it('shows an ImageBitmap of an OffscreenCanvas, as web code does', async () => {
    const offscreen = new LynxOffscreenCanvas(8, 4);
    offscreen.getContext('bitmaprenderer');
    const visible = new LynxOffscreenCanvas(8, 4);
    const bitmap = await createImageBitmap(offscreen);
    contextOf(visible).transferFromImageBitmap(bitmap);
    const imageId = bridgeGL.imageFromCanvas.mock.calls[0][0];
    expect(bridge.transferToBitmapRenderer).toHaveBeenLastCalledWith(
      contextIdOf(1),
      imageId,
      8,
      4,
    );
  });

  it('refuses a closed bitmap, something that isn’t one, and no argument', () => {
    const context = contextOf(new LynxOffscreenCanvas(8, 4));
    const closed = new LynxImageBitmap(7, 3, 2);
    closed.close();
    expect(() => context.transferFromImageBitmap(closed)).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
    expect(() =>
      context.transferFromImageBitmap({ width: 1, height: 1 } as never),
    ).toThrow(TypeError);
    expect(() =>
      (context.transferFromImageBitmap as () => void).call(context),
    ).toThrow(TypeError);
    expect(bridge.transferToBitmapRenderer).not.toHaveBeenCalled();
  });

  it('clears the canvas to a blank of its size for null or undefined', () => {
    const canvas = new LynxOffscreenCanvas(8, 4);
    const context = contextOf(canvas);
    context.transferFromImageBitmap(new LynxImageBitmap(7, 3, 2));
    context.transferFromImageBitmap(null);
    context.transferFromImageBitmap(undefined as never);
    expect(bridge.transferToBitmapRenderer.mock.calls.slice(1)).toEqual([
      [contextIdOf(), 0, 8, 4],
      [contextIdOf(), 0, 8, 4],
    ]);
  });

  it('shows a bitmap of no pixels as nothing', () => {
    const context = contextOf(new LynxOffscreenCanvas(8, 4));
    context.transferFromImageBitmap(new LynxImageBitmap(0, 0, 0));
    expect(bridge.transferToBitmapRenderer).toHaveBeenCalledWith(
      contextIdOf(),
      0,
      0,
      0,
    );
  });

  it('warns when the shell couldn’t show the bitmap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.transferToBitmapRenderer.mockReturnValueOnce({
      ok: false,
      error: 'gone',
    });
    contextOf(new LynxOffscreenCanvas(8, 4)).transferFromImageBitmap(
      new LynxImageBitmap(7, 3, 2),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gone'));
  });

  it('still hands the image to the shell once the canvas has gone, which frees it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = new LynxOffscreenCanvas(8, 4);
    const context = contextOf(canvas);
    canvas.surface.release();
    canvas.surface.release();
    context.destroy();
    expect(bridge.destroyBitmapRenderer).toHaveBeenCalledOnce();
    bridge.transferToBitmapRenderer.mockReturnValueOnce({
      ok: false,
      error: 'no context',
    });
    context.transferFromImageBitmap(new LynxImageBitmap(7, 3, 2));
    expect(bridge.transferToBitmapRenderer).toHaveBeenCalledWith(
      contextIdOf(),
      7,
      3,
      2,
    );
    // A blank has nothing to free.
    context.transferFromImageBitmap(null);
    expect(bridge.transferToBitmapRenderer).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(context.encode('image/png', 1)).toEqual({
      error: expect.any(String),
    });
  });
});

describe('a canvas with a bitmaprenderer context', () => {
  it('reads as the bitmap it shows, of the bitmap’s size', () => {
    const canvas = new LynxOffscreenCanvas(8, 4);
    const context = contextOf(canvas);
    const source = canvasSourceOf(canvas)!;
    expect([source.width, source.height, source.readable]).toEqual([
      8,
      4,
      true,
    ]);
    context.transferFromImageBitmap(new LynxImageBitmap(7, 3, 2));
    expect([source.width, source.height]).toEqual([3, 2]);
    expect([canvas.width, canvas.height]).toEqual([8, 4]);
    // Nothing is recorded to send first.
    expect(() => source.flush()).not.toThrow();
    expect(context.isContextLost()).toBe(false);
  });

  it('takes a new size while it’s blank, and keeps a bitmap’s', () => {
    const canvas = new LynxOffscreenCanvas(8, 4);
    const context = contextOf(canvas);
    canvas.width = 16;
    expect(bridge.transferToBitmapRenderer).toHaveBeenLastCalledWith(
      contextIdOf(),
      0,
      16,
      4,
    );
    context.transferFromImageBitmap(new LynxImageBitmap(7, 3, 2));
    canvas.height = 9;
    expect(bridge.transferToBitmapRenderer).toHaveBeenCalledTimes(2);
    expect(canvasSourceOf(canvas)!.width).toBe(3);
  });

  it('encodes what it shows', async () => {
    const canvas = new LynxDetachedCanvas();
    const context = contextOf(canvas);
    expect(canvas.toDataURL('image/jpeg', 0.5)).toBe(
      'data:image/jpeg;base64,AQI=',
    );
    expect(bridge.encodeBitmapRenderer).toHaveBeenCalledWith(contextIdOf(), {
      type: 'image/jpeg',
      quality: 0.5,
    });
    // A bitmap of no pixels has nothing to encode, whatever the canvas's
    // size.
    context.transferFromImageBitmap(new LynxImageBitmap(0, 0, 0));
    expect(canvas.toDataURL()).toBe('data:,');
    const offscreen = new LynxOffscreenCanvas(8, 4);
    contextOf(offscreen);
    await expect(offscreen.convertToBlob()).resolves.toBeInstanceOf(Blob);
  });

  it('hands its bitmap over with transferToImageBitmap(), and is blank after at the bitmap’s size', () => {
    const canvas = new LynxOffscreenCanvas(8, 4);
    const context = contextOf(canvas);
    context.transferFromImageBitmap(new LynxImageBitmap(7, 3, 2));
    const bitmap = canvas.transferToImageBitmap();
    expect([bitmap.width, bitmap.height]).toEqual([3, 2]);
    expect(bridgeGL.imageFromCanvas.mock.calls[0][2]).toMatchObject({
      width: 3,
      height: 2,
      transfer: true,
    });
    // The spec's new bitmap has the dimensions of the one taken, not the
    // canvas's, so the next transfer is of the same size.
    expect(bridge.transferToBitmapRenderer).toHaveBeenLastCalledWith(
      contextIdOf(),
      0,
      3,
      2,
    );
    expect(canvasSourceOf(canvas)!.width).toBe(3);
    const next = canvas.transferToImageBitmap();
    expect([next.width, next.height]).toEqual([3, 2]);
    // The context's bitmap mode stays as it was: a resize leaves the size.
    canvas.width = 16;
    expect(canvasSourceOf(canvas)!.width).toBe(3);
    // A bitmap of no pixels hands over none, and the canvas stays empty.
    context.transferFromImageBitmap(new LynxImageBitmap(0, 0, 0));
    const empty = canvas.transferToImageBitmap();
    expect([empty.width, empty.height]).toEqual([0, 0]);
    expect(bridgeGL.imageFromCanvas).toHaveBeenCalledTimes(2);
    expect(canvasSourceOf(canvas)!.width).toBe(0);
  });

  it('converts to a Blob by the size of what it shows, not the canvas’s', async () => {
    // A canvas of no size showing a bitmap encodes the bitmap.
    const sized = new LynxOffscreenCanvas(8, 4);
    contextOf(sized).transferFromImageBitmap(new LynxImageBitmap(7, 3, 2));
    sized.width = 0;
    await expect(sized.convertToBlob()).resolves.toBeInstanceOf(Blob);
    // A canvas showing a bitmap of no pixels has nothing to encode.
    const empty = new LynxOffscreenCanvas(8, 4);
    contextOf(empty).transferFromImageBitmap(new LynxImageBitmap(0, 0, 0));
    await expect(empty.convertToBlob()).rejects.toMatchObject({
      name: 'IndexSizeError',
    });
  });
});

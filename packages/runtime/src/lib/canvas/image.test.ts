import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxBlob } from '../network/blob';
import { createObjectURL } from '../network/blob-urls';
import {
  createFakeCanvas2DBridge,
  type FakeCanvas2DBridge,
} from '../testing/fake-canvas-2d-bridge';
import {
  createFakeWebGLBridge,
  type FakeWebGLBridge,
} from '../testing/fake-webgl-bridge';
import type { LynxCanvasRenderingContext2D } from './canvas-2d-context';
import { canvasSourceOf } from './canvas-source';
import { LynxDetachedCanvas, LynxOffscreenCanvas } from './detached-canvas';
import { createImageBitmap, LynxImageBitmap, LynxImageElement } from './image';
import { NATIVE_IMAGE, type NativeImage } from './native-image';
import {
  fromWords,
  setCanvas2DBridgeForTesting,
  setWebGLBridgeForTesting,
  toWords,
} from './webgl-bridge';

const PNG = new Uint8Array([137, 80, 78, 71]);

let bridge: FakeWebGLBridge;
let bridge2D: FakeCanvas2DBridge;

beforeEach(() => {
  bridge = createFakeWebGLBridge();
  setWebGLBridgeForTesting(bridge);
  bridge2D = createFakeCanvas2DBridge();
  setCanvas2DBridgeForTesting(bridge2D);
});

afterEach(() => {
  setWebGLBridgeForTesting(undefined);
  setCanvas2DBridgeForTesting(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const native = (source: object): NativeImage =>
  (source as Record<symbol, NativeImage>)[NATIVE_IMAGE];

/**
 * Waits for an image's load or error.
 */
const settled = (image: LynxImageElement) =>
  new Promise<string>((resolve) => {
    image.addEventListener('load', () => resolve('load'));
    image.addEventListener('error', () => resolve('error'));
  });

describe('createImageBitmap', () => {
  it('decodes a Blob in the shell, with the options baked in', async () => {
    const bitmap = await createImageBitmap(new LynxBlob([PNG]), {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      resizeWidth: 8,
    });
    expect(bitmap).toBeInstanceOf(LynxImageBitmap);
    expect(bitmap.width).toBe(4);
    expect(bitmap.height).toBe(2);
    const [id, words, options] = bridge.decodeImage.mock.calls[0];
    expect(fromWords(words)).toEqual(PNG);
    expect(options).toEqual({
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      resizeWidth: 8,
      resizeHeight: 0,
    });
    expect(native(bitmap)).toEqual({
      id,
      width: 4,
      height: 2,
      bakedOptions: true,
    });
  });

  it('defaults the options as a browser does', async () => {
    await createImageBitmap(new LynxBlob([PNG]));
    expect(bridge.decodeImage.mock.calls[0][2]).toEqual({
      imageOrientation: 'from-image',
      premultiplyAlpha: 'default',
      resizeWidth: 0,
      resizeHeight: 0,
    });
  });

  it('decodes a loaded image’s file, or a Blob-like', async () => {
    const image = new LynxImageElement();
    image.src = createObjectURL(new LynxBlob([PNG]));
    const bitmap = await createImageBitmap(image);
    expect(bitmap.width).toBe(4);
    await createImageBitmap({ arrayBuffer: async () => PNG.buffer });
    expect(fromWords(bridge.decodeImage.mock.calls.at(-1)![1])).toEqual(PNG);
  });

  it('refuses a resize to no pixels, as a browser does', async () => {
    for (const options of [
      { resizeWidth: 0 },
      { resizeHeight: 0, resizeWidth: 4 },
    ]) {
      await expect(
        createImageBitmap(new LynxBlob([PNG]), options),
      ).rejects.toMatchObject({ name: 'InvalidStateError' });
      await expect(
        createImageBitmap(new LynxOffscreenCanvas(4, 3), options),
      ).rejects.toThrow(/is equal to 0/);
    }
    expect(bridge.decodeImage).not.toHaveBeenCalled();
    expect(bridge.imageFromCanvas).not.toHaveBeenCalled();
  });

  it('converts the resize as a browser does: to a whole number, in range', async () => {
    await createImageBitmap(new LynxOffscreenCanvas(4, 3), {
      resizeWidth: '8' as unknown as number,
      resizeHeight: 6.9,
    });
    expect(bridge.imageFromCanvas.mock.calls[0][2]).toMatchObject({
      resizeWidth: 8,
      resizeHeight: 6,
    });
    for (const resizeWidth of [-1, NaN, Infinity, 2 ** 32]) {
      await expect(
        createImageBitmap(new LynxBlob([PNG]), { resizeWidth }),
      ).rejects.toThrow(TypeError);
    }
    // Options an object inherits count, as in a Web IDL dictionary.
    await createImageBitmap(
      new LynxOffscreenCanvas(4, 3),
      Object.create({ imageOrientation: 'flipY', resizeWidth: 2 }),
    );
    expect(bridge.imageFromCanvas.mock.calls[1][2]).toMatchObject({
      imageOrientation: 'flipY',
      resizeWidth: 2,
    });
    // -0.5 truncates to 0, a resize to no pixels.
    await expect(
      createImageBitmap(new LynxBlob([PNG]), { resizeWidth: -0.5 }),
    ).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  it('refuses other sources, and cropping', async () => {
    await expect(createImageBitmap('nope')).rejects.toThrow(TypeError);
    await expect(createImageBitmap(null)).rejects.toThrow(TypeError);
    await expect(
      createImageBitmap(new LynxBlob([PNG]), 0, 0, 1, 1),
    ).rejects.toThrow(/cropping/);
  });

  it('fails as a broken image does when the shell can’t decode it', async () => {
    bridge.decodeImage.mockReturnValueOnce({
      width: 0,
      height: 0,
      error: 'Not an image',
    });
    await expect(createImageBitmap(new LynxBlob([PNG]))).rejects.toThrow(
      'Not an image',
    );
    bridge.decodeImage.mockReturnValueOnce({ width: 0, height: 0 });
    await expect(createImageBitmap(new LynxBlob([PNG]))).rejects.toThrow(
      /could not be decoded/,
    );
    setWebGLBridgeForTesting(null);
    await expect(createImageBitmap(new LynxBlob([PNG]))).rejects.toThrow(
      /AngularLynxWebGL module/,
    );
  });
});

describe('createImageBitmap of a canvas', () => {
  it('copies the canvas’s pixels in the shell, after its calls, with the options baked in', async () => {
    const canvas = new LynxDetachedCanvas();
    const context = canvas.getContext('2d') as LynxCanvasRenderingContext2D;
    context.fillRect(0, 0, 1, 1);
    let sentFirst = 0;
    bridge.imageFromCanvas.mockImplementationOnce(() => {
      sentFirst = bridge2D.batches.length;
      return { width: 10, height: 5 };
    });
    const bitmap = await createImageBitmap(canvas, {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'premultiply',
      resizeWidth: 10,
      resizeHeight: 5,
    });
    // The fillRect was sent before the shell read the canvas.
    expect(sentFirst).toBe(1);
    const [id, canvasId, options] = bridge.imageFromCanvas.mock.calls[0];
    expect(canvasId).toBe(canvasSourceOf(canvas)!.canvasId);
    expect(options).toEqual({
      imageOrientation: 'flipY',
      premultiplyAlpha: 'premultiply',
      resizeWidth: 10,
      resizeHeight: 5,
      width: 300,
      height: 150,
      transfer: false,
    });
    expect(native(bitmap)).toEqual({
      id,
      width: 10,
      height: 5,
      bakedOptions: true,
    });
    // Nothing is decoded: no file's bytes cross the bridge.
    expect(bridge.decodeImage).not.toHaveBeenCalled();
    bitmap.close();
    expect(bridge.releaseImage).toHaveBeenCalledWith(id);
  });

  it('reads the canvas at the call, before anything is awaited', () => {
    const canvas = new LynxOffscreenCanvas(4, 3);
    canvas.getContext('2d');
    void createImageBitmap(canvas);
    expect(bridge.imageFromCanvas).toHaveBeenCalledOnce();
    expect(bridge.imageFromCanvas.mock.calls[0][2]).toEqual({
      imageOrientation: 'from-image',
      premultiplyAlpha: 'default',
      resizeWidth: 0,
      resizeHeight: 0,
      width: 4,
      height: 3,
      transfer: false,
    });
  });

  it('makes a transparent image of a canvas with no context, its size', async () => {
    const bitmap = await createImageBitmap(new LynxOffscreenCanvas(6, 2));
    expect([bitmap.width, bitmap.height]).toEqual([6, 2]);
    expect(bridge.imageFromCanvas.mock.calls[0][2]).toMatchObject({
      width: 6,
      height: 2,
    });
  });

  it('refuses a canvas with no pixels, as a browser does', async () => {
    await expect(
      createImageBitmap(new LynxOffscreenCanvas(0, 2)),
    ).rejects.toMatchObject({
      name: 'InvalidStateError',
      message: expect.stringMatching(/width is 0/),
    });
    await expect(
      createImageBitmap(new LynxOffscreenCanvas(2, 0)),
    ).rejects.toThrow(/height is 0/);
    expect(bridge.imageFromCanvas).not.toHaveBeenCalled();
  });

  it('fails when the shell can’t read it, or there’s no shell', async () => {
    const canvas = new LynxOffscreenCanvas(2, 2);
    bridge.imageFromCanvas.mockReturnValueOnce({
      width: 0,
      height: 0,
      error: 'Too old',
    });
    await expect(createImageBitmap(canvas)).rejects.toThrow('Too old');
    bridge.imageFromCanvas.mockReturnValueOnce({ width: 0, height: 0 });
    await expect(createImageBitmap(canvas)).rejects.toThrow(
      /could not be read/,
    );
    setWebGLBridgeForTesting(null);
    await expect(createImageBitmap(canvas)).rejects.toThrow(
      /AngularLynxWebGL module/,
    );
  });
});

describe('LynxImageBitmap', () => {
  it('frees its pixels when closed, once', async () => {
    const bitmap = await createImageBitmap(new LynxBlob([PNG]));
    const { id } = native(bitmap);
    bitmap.close();
    bitmap.close();
    expect(bridge.releaseImage).toHaveBeenCalledOnce();
    expect(bridge.releaseImage).toHaveBeenCalledWith(id);
    expect(bitmap.width).toBe(0);
  });

  it('frees nothing without a bridge', async () => {
    const bitmap = await createImageBitmap(new LynxBlob([PNG]));
    setWebGLBridgeForTesting(null);
    bitmap.close();
  });
});

describe('LynxImageElement', () => {
  it('loads from an object URL, a data: URL or the network', async () => {
    const image = new LynxImageElement();
    expect(image.complete).toBe(true);
    image.src = createObjectURL(new LynxBlob([PNG]));
    expect(image.complete).toBe(false);
    expect(await settled(image)).toBe('load');
    expect(image.complete).toBe(true);
    expect([image.naturalWidth, image.naturalHeight]).toEqual([4, 2]);
    expect([image.width, image.height]).toEqual([4, 2]);
    expect(native(image).bakedOptions).toBe(false);
    expect(bridge.decodeImage.mock.calls[0][2]).toMatchObject({
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
    });

    const data = new LynxImageElement(10, 20);
    data.src = 'data:image/png;base64,iVBORw==';
    expect(await settled(data)).toBe('load');
    expect([data.width, data.height]).toEqual([10, 20]);
    expect(fromWords(bridge.decodeImage.mock.calls[1][1])).toEqual(PNG);

    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG.buffer,
    }));
    vi.stubGlobal('fetch', fetch);
    const remote = new LynxImageElement();
    const onload = vi.fn();
    remote.onload = onload;
    remote.src = 'https://example.com/a.png';
    expect(remote.src).toBe('https://example.com/a.png');
    expect(await settled(remote)).toBe('load');
    expect(onload).toHaveBeenCalledWith({ type: 'load', target: remote });
    expect(fetch).toHaveBeenCalledWith('https://example.com/a.png');
  });

  it('loads from a URL without fetch, where the main thread has none', async () => {
    // Most apps' main threads have no fetch (network/enable.ts).
    vi.stubGlobal('fetch', undefined);
    vi.stubGlobal('lynx', {
      module: () => ({ invoke: () => toWords(PNG) }),
    });
    const image = new LynxImageElement();
    image.src = '/static/a.png';
    expect(await settled(image)).toBe('load');
    expect([image.naturalWidth, image.naturalHeight]).toEqual([4, 2]);
  });

  it('fires error when the file doesn’t load or decode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    const image = new LynxImageElement();
    const onerror = vi.fn();
    image.onerror = onerror;
    image.src = 'https://example.com/missing.png';
    expect(await settled(image)).toBe('error');
    expect(onerror).toHaveBeenCalled();
    expect(image.complete).toBe(true);
    await expect(image.decode()).rejects.toThrow(/could not be decoded/);
    await expect(image.fileBytes()).rejects.toThrow(/could not be decoded/);
  });

  it('keeps only the latest src’s load', async () => {
    const image = new LynxImageElement();
    const loads = vi.fn();
    image.addEventListener('load', loads);
    image.src = createObjectURL(new LynxBlob([PNG]));
    image.src = createObjectURL(new LynxBlob([PNG, PNG]));
    await settled(image);
    await Promise.resolve();
    expect(loads).toHaveBeenCalledOnce();
    expect(fromWords(bridge.decodeImage.mock.calls[0][1])).toHaveLength(8);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = new LynxImageElement();
    const errors = vi.fn();
    failing.addEventListener('error', errors);
    failing.src = 'blob:lynx/revoked';
    failing.src = createObjectURL(new LynxBlob([PNG]));
    await settled(failing);
    expect(errors).not.toHaveBeenCalled();
  });

  it('frees the pixels of the image it loaded before', async () => {
    const image = new LynxImageElement();
    image.src = createObjectURL(new LynxBlob([PNG]));
    await settled(image);
    const { id } = native(image);
    image.src = createObjectURL(new LynxBlob([PNG]));
    await settled(image);
    expect(bridge.releaseImage).toHaveBeenCalledWith(id);
  });

  it('decodes, waiting for the load', async () => {
    const image = new LynxImageElement();
    image.src = createObjectURL(new LynxBlob([PNG]));
    await image.decode();
    await image.decode();
    expect(await image.fileBytes()).toEqual(PNG);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = new LynxImageElement();
    broken.src = 'blob:lynx/revoked';
    await expect(broken.decode()).rejects.toThrow(/could not be decoded/);
  });

  it('loads with no one listening', async () => {
    const image = new LynxImageElement();
    image.src = createObjectURL(new LynxBlob([PNG]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(image.naturalWidth).toBe(4);
  });

  it('reads and writes its attributes, and stops listening', () => {
    const image = new LynxImageElement();
    image.setAttribute('crossOrigin', 'anonymous');
    expect(image.getAttribute('crossOrigin')).toBe('anonymous');
    expect(image.getAttribute('nothing')).toBeNull();
    expect(image.getAttribute('onload')).toBeNull();
    expect(image.tagName).toBe('IMG');
    const listener = vi.fn();
    image.addEventListener('load', listener);
    image.removeEventListener('load', listener);
    image.removeEventListener('error', listener);
  });
});

describe('without FinalizationRegistry', () => {
  it('still decodes and frees images', async () => {
    vi.stubGlobal('FinalizationRegistry', undefined);
    vi.resetModules();
    const fresh = await import('./image');
    const bridgeModule = await import('./webgl-bridge');
    bridgeModule.setWebGLBridgeForTesting(bridge);
    const blobModule = await import('../network/blob');
    const urlsModule = await import('../network/blob-urls');
    const bitmap = await fresh.createImageBitmap(
      new blobModule.LynxBlob([PNG]),
    );
    bitmap.close();
    const image = new fresh.LynxImageElement();
    image.src = urlsModule.createObjectURL(new blobModule.LynxBlob([PNG]));
    await settled(image as unknown as LynxImageElement);
    expect(bridge.releaseImage).toHaveBeenCalledOnce();
    bridgeModule.setWebGLBridgeForTesting(undefined);
  });
});

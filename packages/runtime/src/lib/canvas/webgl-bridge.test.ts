import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasImageOptions, ImageCopyOptions } from './webgl-bridge';

const COPY: ImageCopyOptions = {
  imageOrientation: 'from-image',
  premultiplyAlpha: 'default',
  resizeWidth: 0,
  resizeHeight: 0,
  cropX: 0,
  cropY: 0,
  cropWidth: 0,
  cropHeight: 0,
};

const CANVAS_IMAGE: CanvasImageOptions = {
  ...COPY,
  width: 4,
  height: 5,
  transfer: false,
};

const PIXELS_IMAGE = { ...COPY, width: 1, height: 1 };

/**
 * The bridge is looked up once per page, so each test loads a fresh copy.
 */
const load = async () => {
  vi.resetModules();
  return import('./webgl-bridge');
};

describe('getWebGLBridge', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is null without main-thread modules (the web preview, tests)', async () => {
    const { getWebGLBridge } = await load();
    vi.stubGlobal('lynx', undefined);
    expect(getWebGLBridge()).toBeNull();
  });

  it('is null when the host has no such module', async () => {
    vi.stubGlobal('lynx', { module: () => undefined });
    expect((await load()).getWebGLBridge()).toBeNull();
    vi.stubGlobal('lynx', { module: () => ({}) });
    expect((await load()).getWebGLBridge()).toBeNull();
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('no module');
      },
    });
    expect((await load()).getWebGLBridge()).toBeNull();
  });

  it('calls the shell’s module, and is the same bridge each time', async () => {
    const invoke = vi.fn((method: string) =>
      method === 'create'
        ? { ok: true }
        : method === 'run'
          ? [1]
          : method === 'decodeImage'
            ? { width: 2, height: 3 }
            : method === 'encodeImage'
              ? { base64: 'AQI=', type: 'image/png' }
              : method.startsWith('imageFrom')
                ? { width: 4, height: 5 }
                : undefined,
    );
    const module = vi.fn(() => ({ invoke }));
    vi.stubGlobal('lynx', { module });
    const { getWebGLBridge, WEBGL_MODULE_NAME } = await load();
    const bridge = getWebGLBridge()!;
    expect(getWebGLBridge()).toBe(bridge);
    expect(module).toHaveBeenCalledOnce();
    expect(module).toHaveBeenCalledWith(WEBGL_MODULE_NAME);
    expect(bridge.create(1, 'c-1', { alpha: true })).toEqual({ ok: true });
    expect(bridge.run(1, [OP_CLEAR])).toEqual([1]);
    bridge.destroy(1);
    expect(bridge.decodeImage(2, [0, 0], COPY)).toEqual({
      width: 2,
      height: 3,
    });
    bridge.releaseImage(2);
    const encodeOptions = {
      type: 'image/png',
      quality: 0.92,
      premultipliedAlpha: true,
    };
    expect(bridge.encodeImage(1, encodeOptions)).toEqual({
      base64: 'AQI=',
      type: 'image/png',
    });
    expect(bridge.imageFromCanvas(3, 'c-1', CANVAS_IMAGE)).toEqual({
      width: 4,
      height: 5,
    });
    expect(bridge.imageFromImage(4, 3, COPY)).toEqual({ width: 4, height: 5 });
    expect(bridge.imageFromPixels(5, [1, 4], PIXELS_IMAGE)).toEqual({
      width: 4,
      height: 5,
    });
    expect(invoke.mock.calls).toEqual([
      ['create', 1, 'c-1', { alpha: true }],
      ['run', 1, [OP_CLEAR]],
      ['destroy', 1],
      ['decodeImage', 2, [0, 0], COPY],
      ['releaseImage', 2],
      ['encodeImage', 1, encodeOptions],
      ['imageFromCanvas', 3, 'c-1', CANVAS_IMAGE],
      ['imageFromImage', 4, 3, COPY],
      ['imageFromPixels', 5, [1, 4], PIXELS_IMAGE],
    ]);
  });

  it('answers for a module that answers nothing', async () => {
    vi.stubGlobal('lynx', { module: () => ({ invoke: () => undefined }) });
    const bridge = (await load()).getWebGLBridge()!;
    expect(bridge.create(1, 'c', {})).toMatchObject({
      ok: false,
      error: expect.stringMatching(/isn't registered/),
    });
    expect(bridge.run(1, [])).toEqual([]);
    expect(bridge.decodeImage(1, [], COPY)).toMatchObject({
      width: 0,
      error: expect.stringMatching(/isn't registered/),
    });
    expect(
      bridge.encodeImage(1, {
        type: 'image/png',
        quality: 1,
        premultipliedAlpha: true,
      }),
    ).toEqual({ error: expect.stringMatching(/ng build --platform/) });
    expect(bridge.imageFromCanvas(1, 'c', CANVAS_IMAGE)).toEqual({
      width: 0,
      height: 0,
      error: expect.stringMatching(/ng build --platform/),
    });
  });

  it('answers for a shell from before encodeImage, which throws for it', async () => {
    vi.stubGlobal('lynx', {
      module: () => ({
        invoke: (method: string) => {
          if (method === 'encodeImage' || method.startsWith('imageFrom')) {
            throw new Error('no such method');
          }
          return undefined;
        },
      }),
    });
    const bridge = (await load()).getWebGLBridge()!;
    expect(
      bridge.encodeImage(1, {
        type: 'image/jpeg',
        quality: 1,
        premultipliedAlpha: true,
      }),
    ).toEqual({ error: expect.stringMatching(/can't encode a canvas/) });
    expect(bridge.imageFromCanvas(1, 'c', CANVAS_IMAGE)).toMatchObject({
      error: expect.stringMatching(/can't make an ImageBitmap of a canvas/),
    });
    expect(bridge.imageFromImage(1, 2, COPY)).toMatchObject({
      error: expect.stringMatching(/ImageBitmap of an ImageBitmap or an Image/),
    });
    expect(bridge.imageFromPixels(1, [0], PIXELS_IMAGE)).toMatchObject({
      error: expect.stringMatching(/ImageBitmap of an ImageData/),
    });
  });

  it('can be replaced, and restored, for tests', async () => {
    const { getWebGLBridge, setWebGLBridgeForTesting } = await load();
    vi.stubGlobal('lynx', undefined);
    const fake = {} as never;
    setWebGLBridgeForTesting(fake);
    expect(getWebGLBridge()).toBe(fake);
    setWebGLBridgeForTesting(null);
    expect(getWebGLBridge()).toBeNull();
    setWebGLBridgeForTesting(undefined);
    expect(getWebGLBridge()).toBeNull();
  });
});

describe('getCanvas2DBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is null without the module', async () => {
    vi.stubGlobal('lynx', undefined);
    expect((await load()).getCanvas2DBridge()).toBeNull();
    vi.stubGlobal('lynx', { module: () => undefined });
    expect((await load()).getCanvas2DBridge()).toBeNull();
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('no module');
      },
    });
    expect((await load()).getCanvas2DBridge()).toBeNull();
  });

  it('calls the shell’s 2D methods, and is the same bridge each time', async () => {
    const invoke = vi.fn((method: string) =>
      method === 'create2D'
        ? { ok: true }
        : method === 'run2D'
          ? [true]
          : method === 'encode2D'
            ? { base64: 'AQI=', type: 'image/png' }
            : undefined,
    );
    vi.stubGlobal('lynx', { module: () => ({ invoke }) });
    const { getCanvas2DBridge } = await load();
    const bridge = getCanvas2DBridge()!;
    expect(getCanvas2DBridge()).toBe(bridge);
    expect(bridge.create2D(1, 'c-1', { alpha: true })).toEqual({ ok: true });
    expect(bridge.run2D(1, [5])).toEqual([true]);
    bridge.destroy2D(1);
    bridge.release2D(4);
    expect(bridge.encode2D(1, { type: 'image/png', quality: 1 })).toEqual({
      base64: 'AQI=',
      type: 'image/png',
    });
    expect(invoke.mock.calls).toEqual([
      ['create2D', 1, 'c-1', { alpha: true }],
      ['run2D', 1, [5]],
      ['destroy2D', 1],
      ['release2D', 4],
      ['encode2D', 1, { type: 'image/png', quality: 1 }],
    ]);
  });

  it('answers for a shell from before the 2D context, which answers nothing or throws', async () => {
    for (const invoke of [
      () => undefined,
      () => {
        throw new Error('no such method');
      },
    ]) {
      vi.stubGlobal('lynx', { module: () => ({ invoke }) });
      const bridge = (await load()).getCanvas2DBridge()!;
      expect(bridge.create2D(1, 'c', {})).toEqual({
        ok: false,
        error: expect.stringMatching(/no 2D canvas/),
      });
      expect(bridge.run2D(1, [])).toEqual([]);
      bridge.destroy2D(1);
      expect(bridge.encode2D(1, { type: 'image/png', quality: 1 })).toEqual({
        error: expect.stringMatching(/can't encode a canvas/),
      });
    }
  });

  it('can be replaced, and restored, for tests', async () => {
    const { getCanvas2DBridge, setCanvas2DBridgeForTesting } = await load();
    vi.stubGlobal('lynx', undefined);
    const fake = {} as never;
    setCanvas2DBridgeForTesting(fake);
    expect(getCanvas2DBridge()).toBe(fake);
    setCanvas2DBridgeForTesting(undefined);
    expect(getCanvas2DBridge()).toBeNull();
  });
});

describe('bytesOf', () => {
  it('views the bytes of a buffer or a typed array, by element', async () => {
    const { bytesOf } = await load();
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(bytesOf(buffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(bytesOf(buffer, 2, 3)).toEqual(new Uint8Array([3, 4, 5]));
    expect(bytesOf(buffer, 6)).toEqual(new Uint8Array([7, 8]));
    const shorts = new Uint16Array(buffer, 2, 3);
    expect(bytesOf(shorts, 1, 1)).toEqual(new Uint8Array([5, 6]));
    expect(bytesOf(shorts, 1)).toEqual(new Uint8Array([5, 6, 7, 8]));
    expect(bytesOf(new DataView(buffer, 1, 2))).toEqual(new Uint8Array([2, 3]));
  });
});

const OP_CLEAR = 23;

describe('getVideoFrameSize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the shell for the frame a video shows, once it has one', async () => {
    const invoke = vi.fn((_method: string, id: string) =>
      id === 'v-1' ? { width: 640, height: 360 } : { width: 0, height: 0 },
    );
    const module = vi.fn(() => ({ invoke }));
    vi.stubGlobal('lynx', { module });
    const { getVideoFrameSize, WEBGL_MODULE_NAME } = await load();
    expect(getVideoFrameSize('v-1')).toEqual({ width: 640, height: 360 });
    expect(getVideoFrameSize('v-2')).toEqual({ width: 0, height: 0 });
    expect(invoke).toHaveBeenCalledWith('videoSize', 'v-1');
    // The module is looked up once.
    expect(module).toHaveBeenCalledOnce();
    expect(module).toHaveBeenCalledWith(WEBGL_MODULE_NAME);
  });

  it('is no frame where the shell can’t say', async () => {
    vi.stubGlobal('lynx', undefined);
    expect((await load()).getVideoFrameSize('v-1')).toEqual({
      width: 0,
      height: 0,
    });
    vi.stubGlobal('lynx', { module: () => undefined });
    expect((await load()).getVideoFrameSize('v-1').width).toBe(0);
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('no module');
      },
    });
    expect((await load()).getVideoFrameSize('v-1').width).toBe(0);
    // A shell from before videoSize: Lynx throws, or answers nothing, or
    // half a size.
    vi.stubGlobal('lynx', {
      module: () => ({
        invoke: () => {
          throw new Error('no method');
        },
      }),
    });
    expect((await load()).getVideoFrameSize('v-1').width).toBe(0);
    vi.stubGlobal('lynx', { module: () => ({ invoke: () => undefined }) });
    expect((await load()).getVideoFrameSize('v-1').width).toBe(0);
    vi.stubGlobal('lynx', {
      module: () => ({ invoke: () => ({ width: 4 }) }),
    });
    expect((await load()).getVideoFrameSize('v-1')).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('answers as a test says', async () => {
    const { getVideoFrameSize, setVideoFrameSizeForTesting } = await load();
    setVideoFrameSizeForTesting(() => ({ width: 2, height: 1 }));
    expect(getVideoFrameSize('v-1')).toEqual({ width: 2, height: 1 });
    setVideoFrameSizeForTesting(null);
    expect(getVideoFrameSize('v-1')).toEqual({ width: 0, height: 0 });
    setVideoFrameSizeForTesting(undefined);
  });
});

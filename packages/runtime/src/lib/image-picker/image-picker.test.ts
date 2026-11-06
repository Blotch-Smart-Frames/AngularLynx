import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../network/base64';
import {
  ImagePickerError,
  type ImagePickerErrorCode,
  LynxImagePicker,
  type PickedImage,
} from './image-picker';

type NativeResult = Record<string, unknown>;
type Done = (result: NativeResult) => void;

const createPicker = () =>
  Injector.create({ providers: [LynxImagePicker] }).get(LynxImagePicker);

/**
 * Stands in for the shells' AngularLynxImagePicker module, as the background
 * thread sees it. Unit tests run as the background thread, so the service
 * calls it directly. `finish` closes the open picker the way the platform
 * would.
 */
const stubModule = () => {
  let done: Done | undefined;
  const pick = vi.fn((_options: unknown, callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', { AngularLynxImagePicker: { pick } });
  return { pick, finish: (result: NativeResult) => done?.(result) };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: ImagePickerErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ImagePickerError);
  const { code, message } = error as ImagePickerError;
  return { code, message };
};

const bytesOf = async (picked: PickedImage | null) => [
  ...new Uint8Array(await picked!.blob.arrayBuffer()),
];

describe('LynxImagePicker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('in the apps ng build --platform makes', () => {
    it('resolves with the picked image as a Blob of its type', async () => {
      const { pick, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled());
      finish({
        base64: bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
        name: 'IMG_0042.jpg',
        type: 'image/jpeg',
      });

      const image = await picked;
      expect(image).toMatchObject({ name: 'IMG_0042.jpg', type: 'image/jpeg' });
      expect(image!.blob).toBeInstanceOf(Blob);
      expect(image!.blob.type).toBe('image/jpeg');
      expect(await bytesOf(image)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
      expect(pick).toHaveBeenCalledWith({}, expect.any(Function));
    });

    it('asks for whole pixels and the quality it was given', async () => {
      const { pick } = stubModule();

      void createPicker().pick({ maxDimension: 1024.6, quality: 0.85 });
      await vi.waitFor(() => expect(pick).toHaveBeenCalled());

      expect(pick).toHaveBeenCalledWith(
        { maxDimension: 1024, quality: 0.85 },
        expect.any(Function),
      );
    });

    it('resolves with null when the person closes the picker', async () => {
      const { pick, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled());
      finish({ canceled: true });

      await expect(picked).resolves.toBeNull();
    });

    it('rejects with failed and the module’s message', async () => {
      const { pick, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled());
      finish({ error: 'failed', message: 'A picker is already open.' });

      expect(await rejection(picked)).toEqual({
        code: 'failed',
        message: 'A picker is already open.',
      });
    });

    it('rejects with failed when the answer has no image', async () => {
      const { pick, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled());
      finish({ base64: '', type: 'image/png' });

      expect(await rejection(picked)).toEqual({
        code: 'failed',
        message: "The picked image couldn't be read.",
      });
    });

    it('rejects with failed when the module answers nothing', async () => {
      const { pick, finish } = stubModule();

      const picked = createPicker().pick();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled());
      finish(undefined as unknown as NativeResult);

      expect((await rejection(picked)).code).toBe('failed');
    });
  });

  it('rejects with unavailable where the host has no picker, as in Lynx Explorer', async () => {
    vi.stubGlobal('NativeModules', {});

    const { code, message } = await rejection(createPicker().pick());

    expect(code).toBe('unavailable');
    expect(message).toMatch(/ng build --platform/);
  });

  it.each([
    [{ maxDimension: 0 }, /maxDimension/],
    [{ maxDimension: Number.NaN }, /maxDimension/],
    [{ maxDimension: Infinity }, /maxDimension/],
    [{ quality: 1.5 }, /quality/],
    [{ quality: -0.1 }, /quality/],
    [{ quality: Number.NaN }, /quality/],
  ])('refuses %o', async (options, message) => {
    const { pick } = stubModule();

    await expect(createPicker().pick(options)).rejects.toThrow(
      expect.objectContaining({
        name: 'RangeError',
        message: expect.stringMatching(message),
      }),
    );
    expect(pick).not.toHaveBeenCalled();
  });
});

// ─── The web preview ─────────────────────────────────────────────────────────

type Listener = () => void;

/**
 * A file the person picks, as the browser's `<input>` hands it over.
 */
const fileOf = (bytes: number[], type: string, name: string) =>
  Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name });

/**
 * A page document with just what the web picker uses: `<input>` and
 * `<canvas>`. `choose()` and `cancel()` stand in for the person.
 */
const stubPage = () => {
  const inputs: {
    type: string;
    accept: string;
    style: { display: string };
    files: ReturnType<typeof fileOf>[] | null;
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    listeners: Map<string, Listener>;
    addEventListener(type: string, listener: Listener): void;
  }[] = [];
  const canvas = {
    width: 0,
    height: 0,
    context: {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as Record<string, unknown> | null,
    getContext() {
      return this.context;
    },
    toBlob: vi.fn(
      (callback: (blob: Blob | null) => void, type: string, quality: number) =>
        callback(new Blob([`jpeg@${quality}`], { type })),
    ),
  };
  const document = {
    body: { appendChild: vi.fn() },
    createElement: (tag: string) => {
      if (tag === 'canvas') return canvas;
      const input = {
        type: '',
        accept: '',
        style: { display: '' },
        files: null,
        click: vi.fn(),
        remove: vi.fn(),
        listeners: new Map<string, Listener>(),
        addEventListener(type: string, listener: Listener) {
          this.listeners.set(type, listener);
        },
      };
      inputs.push(input);
      return input;
    },
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  // Angular's realm is web-core's hidden iframe; the page holds the input.
  vi.stubGlobal('frameElement', { ownerDocument: document });
  const last = () => inputs[inputs.length - 1]!;
  return {
    document,
    canvas,
    inputs,
    choose: (file: ReturnType<typeof fileOf> | undefined) => {
      last().files = file ? [file] : [];
      last().listeners.get('change')!();
    },
    cancel: () => last().listeners.get('cancel')!(),
  };
};

/**
 * `createImageBitmap()` for a `width`×`height` image.
 */
const stubBitmap = (width: number, height: number) => {
  const close = vi.fn();
  const createImageBitmap = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  return { createImageBitmap, close };
};

describe('LynxImagePicker in the web preview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a file input for images in the page and resolves with the file', async () => {
    const page = stubPage();

    const picked = createPicker().pick();
    const input = page.inputs[0]!;
    expect(input).toMatchObject({
      type: 'file',
      accept: 'image/*',
      style: { display: 'none' },
    });
    expect(page.document.body.appendChild).toHaveBeenCalledWith(input);
    expect(input.click).toHaveBeenCalled();
    page.choose(fileOf([1, 2, 3], 'image/png', 'cat.png'));

    const image = await picked;
    expect(image).toMatchObject({ name: 'cat.png', type: 'image/png' });
    expect(image!.blob.type).toBe('image/png');
    expect(await bytesOf(image)).toEqual([1, 2, 3]);
    expect(input.remove).toHaveBeenCalled();
  });

  it('uses the frame’s own document where it has no frame element', async () => {
    const page = stubPage();
    vi.stubGlobal('frameElement', null);
    vi.stubGlobal('document', page.document);

    void createPicker().pick();

    expect(page.inputs).toHaveLength(1);
  });

  it('uses the frame’s own document where the page is out of reach', async () => {
    const page = stubPage();
    Object.defineProperty(globalThis, 'frameElement', {
      configurable: true,
      get: () => {
        throw new Error('cross-origin');
      },
    });
    vi.stubGlobal('document', page.document);

    try {
      void createPicker().pick();
      expect(page.inputs).toHaveLength(1);
    } finally {
      delete (globalThis as { frameElement?: unknown }).frameElement;
    }
  });

  it('resolves with null when the person closes the dialog', async () => {
    const page = stubPage();

    const picked = createPicker().pick();
    page.cancel();
    // A late change event changes nothing.
    page.choose(fileOf([1], 'image/png', 'late.png'));

    await expect(picked).resolves.toBeNull();
    expect(page.inputs[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it('resolves with null when a change brings no file', async () => {
    const page = stubPage();

    const picked = createPicker().pick();
    page.choose(undefined);

    await expect(picked).resolves.toBeNull();
  });

  it('ends an open pick with null when another starts', async () => {
    const page = stubPage();
    const picker = createPicker();

    const first = picker.pick();
    const second = picker.pick();
    page.choose(fileOf([9], 'image/gif', 'b.gif'));

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toMatchObject({ name: 'b.gif' });
    expect(page.inputs).toHaveLength(2);
  });

  it('rejects with failed when the input can’t open', async () => {
    const page = stubPage();
    vi.spyOn(page.document, 'createElement').mockImplementationOnce(() => {
      const input = stubPage().document.createElement('input');
      (input as { click(): void }).click = () => {
        throw new Error('blocked');
      };
      return input;
    });

    const { code, message } = await rejection(createPicker().pick());

    expect(code).toBe('failed');
    expect(message).toMatch(/blocked/);
  });

  it('scales an image down and re-encodes it as a JPEG over white', async () => {
    const page = stubPage();
    const { close } = stubBitmap(4032, 3024);

    const picked = createPicker().pick({ maxDimension: 1024, quality: 0.8 });
    page.choose(fileOf([1], 'image/png', 'shot.final.png'));

    const image = await picked;
    expect(image).toMatchObject({ name: 'shot.final.jpg', type: 'image/jpeg' });
    expect(await image!.blob.text()).toBe('jpeg@0.8');
    expect(page.canvas).toMatchObject({ width: 1024, height: 768 });
    expect(page.canvas.context).toMatchObject({ fillStyle: '#fff' });
    expect(page.canvas.context!['drawImage']).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1024,
      768,
    );
    expect(close).toHaveBeenCalled();
  });

  it('never scales an image up, and re-encodes it at 0.9 by default', async () => {
    const page = stubPage();
    stubBitmap(300, 200);

    const picked = createPicker().pick({ maxDimension: 1024 });
    page.choose(fileOf([1], 'image/jpeg', 'small'));

    const image = await picked;
    expect(image!.name).toBe('small.jpg');
    expect(await image!.blob.text()).toBe('jpeg@0.9');
    expect(page.canvas).toMatchObject({ width: 300, height: 200 });
  });

  it('re-encodes a format other platforms can’t show, at full size', async () => {
    const page = stubPage();
    stubBitmap(4032, 3024);

    const picked = createPicker().pick();
    page.choose(fileOf([1], 'image/heic', 'IMG_1.HEIC'));

    expect(await picked).toMatchObject({
      name: 'IMG_1.jpg',
      type: 'image/jpeg',
    });
    expect(page.canvas).toMatchObject({ width: 4032, height: 3024 });
  });

  it('keeps the original where the browser can’t decode it', async () => {
    const page = stubPage();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('undecodable');
      }),
    );

    const picked = createPicker().pick();
    page.choose(fileOf([7], 'image/heic', 'IMG_2.HEIC'));

    const image = await picked;
    expect(image).toMatchObject({ name: 'IMG_2.HEIC', type: 'image/heic' });
    expect(await bytesOf(image)).toEqual([7]);
  });

  it('keeps the original where the browser has no createImageBitmap', async () => {
    const page = stubPage();

    const picked = createPicker().pick({ quality: 0.5 });
    page.choose(fileOf([7], 'image/png', 'a.png'));

    expect(await picked).toMatchObject({ name: 'a.png', type: 'image/png' });
  });

  it('keeps the original where the canvas has no 2D context', async () => {
    const page = stubPage();
    const { close } = stubBitmap(10, 10);
    page.canvas.context = null;

    const picked = createPicker().pick({ quality: 0.5 });
    page.choose(fileOf([7], 'image/png', 'a.png'));

    expect(await picked).toMatchObject({ name: 'a.png', type: 'image/png' });
    expect(close).toHaveBeenCalled();
  });

  it('rejects with failed when the picked file can’t be read', async () => {
    const page = stubPage();
    stubBitmap(10, 10);
    page.canvas.toBlob.mockImplementationOnce(() => {
      throw new Error('tainted');
    });

    const picked = createPicker().pick({ quality: 0.5 });
    page.choose(fileOf([7], 'image/png', 'a.png'));

    const { code, message } = await rejection(picked);
    expect(code).toBe('failed');
    expect(message).toMatch(/tainted/);
  });
});

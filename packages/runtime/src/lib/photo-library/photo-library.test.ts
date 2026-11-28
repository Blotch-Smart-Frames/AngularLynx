import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes } from '../network/base64';
import {
  LynxPhotoLibrary,
  PhotoLibraryError,
  type PhotoLibraryErrorCode,
} from './photo-library';

type NativeResult = Record<string, unknown>;
type Done = (result: NativeResult) => void;
type NativeRequest = { base64: string; name: string; type: string };

const createLibrary = () =>
  Injector.create({ providers: [LynxPhotoLibrary] }).get(LynxPhotoLibrary);

/**
 * Stands in for the shells' AngularLynxPhotoLibrary module, as the
 * background thread sees it. Unit tests run as the background thread, so the
 * service calls it directly. `permission` answers at once with `status`;
 * `save` waits for `finish`, as the phone waits for the person and the disk.
 */
const stubModule = (status = 'undetermined') => {
  let done: Done | undefined;
  const save = vi.fn((_request: unknown, callback: Done) => {
    done = callback;
  });
  const permission = vi.fn((callback: Done) =>
    callback({ permission: status }),
  );
  vi.stubGlobal('NativeModules', {
    AngularLynxPhotoLibrary: { save, permission },
  });
  const request = () => save.mock.calls[0]![0] as NativeRequest;
  return {
    save,
    permission,
    request,
    finish: (result: NativeResult) => done?.(result),
  };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: PhotoLibraryErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PhotoLibraryError);
  const { code, message } = error as PhotoLibraryError;
  return { code, message };
};

const bytes = [0xff, 0xd8, 0xff, 0xe0];
const jpeg = (type = 'image/jpeg') =>
  new Blob([new Uint8Array(bytes)], { type });

describe('LynxPhotoLibrary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('in the apps ng build --platform makes', () => {
    it('reads the permission when it is first injected', async () => {
      const { permission } = stubModule('denied');
      const library = createLibrary();
      expect(library.addPermission()).toBe('undetermined');
      await vi.waitFor(() => expect(library.addPermission()).toBe('denied'));
      expect(permission).toHaveBeenCalledTimes(1);
    });

    it('sends the file as base64 with its name and type, and resolves its ID', async () => {
      const { save, request, finish } = stubModule();
      const library = createLibrary();

      const saved = library.save({ blob: jpeg(), name: 'edit.jpg' });
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
      expect(request()).toEqual({
        base64: expect.any(String),
        name: 'edit.jpg',
        type: 'image/jpeg',
      });
      expect([...base64ToBytes(request().base64)]).toEqual(bytes);
      finish({ id: 'ABC/L0/001', permission: 'limited' });
      await expect(saved).resolves.toBe('ABC/L0/001');
      expect(library.addPermission()).toBe('limited');
    });

    it('takes the type from the name when the Blob has none', async () => {
      const { save, request } = stubModule();
      void createLibrary().save({ blob: jpeg(''), name: 'Clip.MOV' });
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
      expect(request()).toMatchObject({
        name: 'Clip.MOV',
        type: 'video/quicktime',
      });
    });

    it('names a file the app gave no name', async () => {
      const { save, request } = stubModule();
      void createLibrary().save({ blob: jpeg() });
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
      expect(request().name).toMatch(/^Photo-\d+\.jpg$/);

      vi.unstubAllGlobals();
      const video = stubModule();
      void createLibrary().save({ blob: jpeg('video/mp4') });
      await vi.waitFor(() => expect(video.save).toHaveBeenCalled());
      expect(video.request().name).toMatch(/^Video-\d+\.mp4$/);
    });

    it('rejects a file that is not an image or a video without calling the module', async () => {
      const { save } = stubModule();
      const library = createLibrary();
      expect(
        await rejection(
          library.save({ blob: new Blob(['hi'], { type: 'text/plain' }) }),
        ),
      ).toEqual({
        code: 'unsupported-type',
        message:
          "The file isn't an image or a video (text/plain). Only images and videos can be saved to the photo library.",
      });
      expect(
        (await rejection(library.save({ blob: jpeg(''), name: 'notes' }))).code,
      ).toBe('unsupported-type');
      expect(
        (await rejection(library.save({ blob: jpeg(''), name: 'a.pdf' }))).code,
      ).toBe('unsupported-type');
      expect(save).not.toHaveBeenCalled();
    });

    it('rejects with a TypeError without a Blob', async () => {
      stubModule();
      const library = createLibrary();
      await expect(library.save({} as never)).rejects.toBeInstanceOf(TypeError);
      await expect(library.save(null as never)).rejects.toBeInstanceOf(
        TypeError,
      );
    });

    it('rejects with the code and message the module answers, and keeps its permission', async () => {
      const { save, finish } = stubModule();
      const library = createLibrary();
      const saved = library.save({ blob: jpeg() });
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
      finish({
        error: 'permission-denied',
        message: 'Not allowed',
        permission: 'denied',
      });
      expect(await rejection(saved)).toEqual({
        code: 'permission-denied',
        message: 'Not allowed',
      });
      expect(library.addPermission()).toBe('denied');
    });

    it.each([
      [
        'permission-denied',
        "The app isn't allowed to add to the photo library.",
      ],
      ['unavailable', expect.stringContaining('permissions.savePhotos')],
      ['failed', "The file couldn't be saved to the photo library."],
    ])(
      'gives %s a message when the module gives none',
      async (code, message) => {
        const { save, finish } = stubModule();
        const saved = createLibrary().save({ blob: jpeg() });
        await vi.waitFor(() => expect(save).toHaveBeenCalled());
        finish({ error: code });
        expect(await rejection(saved)).toEqual({ code, message });
      },
    );

    it('rejects with failed for an answer it does not know', async () => {
      const { save, finish } = stubModule();
      const library = createLibrary();
      const saved = library.save({ blob: jpeg() });
      await vi.waitFor(() => expect(save).toHaveBeenCalled());
      finish({ error: 'odd', permission: 'sideways' });
      expect((await rejection(saved)).code).toBe('failed');
      // An unknown permission leaves the signal as it was.
      expect(library.addPermission()).toBe('undetermined');
    });
  });

  describe('without the native module', () => {
    it('is unsupported, and rejects with unavailable', async () => {
      vi.stubGlobal('NativeModules', {});
      const library = createLibrary();
      await vi.waitFor(() =>
        expect(library.addPermission()).toBe('unsupported'),
      );
      const { code, message } = await rejection(
        library.save({ blob: jpeg(), name: 'a.jpg' }),
      );
      expect(code).toBe('unavailable');
      expect(message).toContain('permissions.savePhotos');
    });
  });
});

// ─── The web preview ─────────────────────────────────────────────────────────

/**
 * The page's `File`: a Blob with a name, as the browser's is.
 */
class PageFile extends Blob {
  constructor(
    parts: BlobPart[],
    readonly name: string,
    options: { type: string },
  ) {
    super(parts, options);
  }
}

/**
 * A page with the `<a>` and object URLs a download uses.
 */
const stubPage = () => {
  const anchors: { href: string; download: string; click: () => void }[] = [];
  const page = {
    navigator: {},
    document: {
      body: { appendChild: vi.fn() },
      createElement: () => {
        const anchor = {
          href: '',
          download: '',
          style: { display: '' },
          click: vi.fn(),
          remove: vi.fn(),
        };
        anchors.push(anchor);
        return anchor;
      },
    },
    File: PageFile,
    URL: {
      createObjectURL: vi.fn((file: PageFile) => `blob:page/${file.name}`),
      revokeObjectURL: vi.fn(),
    },
    setTimeout: vi.fn(),
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('parent', page);
  return { page, anchors };
};

describe('LynxPhotoLibrary in the web preview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the file as the page’s File, before anything waits, and is granted', async () => {
    const { page, anchors } = stubPage();
    const library = createLibrary();
    expect(library.addPermission()).toBe('granted');

    const saved = library.save({ blob: jpeg(''), name: 'edit.png' });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({
      href: 'blob:page/edit.png',
      download: 'edit.png',
    });
    expect(anchors[0]!.click).toHaveBeenCalled();
    const file = page.URL.createObjectURL.mock.calls[0]![0];
    expect(file).toBeInstanceOf(PageFile);
    expect(file.type).toBe('image/png');
    await expect(saved).resolves.toBe('edit.png');
  });

  it('still refuses what is not an image or a video', async () => {
    const { anchors } = stubPage();
    const { code } = await rejection(
      createLibrary().save({ blob: new Blob(['x']), name: 'a.txt' }),
    );
    expect(code).toBe('unsupported-type');
    expect(anchors).toHaveLength(0);
  });
});

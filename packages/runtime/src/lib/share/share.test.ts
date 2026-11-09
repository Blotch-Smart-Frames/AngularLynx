import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes } from '../network/base64';
import {
  LynxShare,
  type ShareData,
  ShareError,
  type ShareErrorCode,
} from './share';

type NativeResult = Record<string, unknown>;
type Done = (result: NativeResult) => void;
type NativeFile = { base64: string; name: string; type: string };

const createShare = () =>
  Injector.create({ providers: [LynxShare] }).get(LynxShare);

/**
 * Stands in for the shells' AngularLynxShare module, as the background
 * thread sees it. Unit tests run as the background thread, so the service
 * calls it directly. `finish` closes the share sheet the way the platform
 * would.
 */
const stubModule = () => {
  let done: Done | undefined;
  const share = vi.fn((_request: unknown, callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', { AngularLynxShare: { share } });
  const request = () =>
    share.mock.calls[0]![0] as {
      files: NativeFile[];
      title?: string;
      text?: string;
      url?: string;
    };
  return { share, request, finish: (result: NativeResult) => done?.(result) };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: ShareErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ShareError);
  const { code, message } = error as ShareError;
  return { code, message };
};

const jpeg = () =>
  new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

describe('LynxShare', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('in the apps ng build --platform makes', () => {
    it('sends each file as base64 with its name and type, and resolves true once shared', async () => {
      const { share, request, finish } = stubModule();

      const shared = createShare().share({
        files: [{ blob: jpeg(), name: 'photo.jpg' }],
        title: 'My photo',
      });
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      expect(request()).toEqual({
        files: [
          { base64: expect.any(String), name: 'photo.jpg', type: 'image/jpeg' },
        ],
        title: 'My photo',
      });
      expect([...base64ToBytes(request().files[0]!.base64)]).toEqual([
        0xff, 0xd8, 0xff, 0xe0,
      ]);
      finish({ shared: true });

      await expect(shared).resolves.toBe(true);
    });

    it('takes a Blob with a name, as a File is', async () => {
      const { share, request } = stubModule();

      void createShare().share({
        files: [Object.assign(jpeg(), { name: 'photo.jpg' })],
      });
      await vi.waitFor(() => expect(share).toHaveBeenCalled());

      expect(request().files).toEqual([
        { base64: expect.any(String), name: 'photo.jpg', type: 'image/jpeg' },
      ]);
    });

    it('sends text and a link without files', async () => {
      const { share, request } = stubModule();

      void createShare().share({
        text: 'Look',
        url: 'https://example.com/post/42',
      });
      await vi.waitFor(() => expect(share).toHaveBeenCalled());

      expect(request()).toEqual({
        files: [],
        text: 'Look',
        url: 'https://example.com/post/42',
      });
    });

    it('resolves false when the person closes the sheet', async () => {
      const { share, finish } = stubModule();

      const shared = createShare().share({ text: 'Hi' });
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      finish({ shared: false });

      await expect(shared).resolves.toBe(false);
    });

    it('rejects with failed and the module’s message', async () => {
      const { share, finish } = stubModule();

      const shared = createShare().share({ text: 'Hi' });
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      finish({ error: 'failed', message: 'A share sheet is already open.' });

      expect(await rejection(shared)).toEqual({
        code: 'failed',
        message: 'A share sheet is already open.',
      });
    });

    it('rejects with failed when the module answers nothing', async () => {
      const { share, finish } = stubModule();

      const shared = createShare().share({ text: 'Hi' });
      await vi.waitFor(() => expect(share).toHaveBeenCalled());
      finish(undefined as unknown as NativeResult);

      expect(await rejection(shared)).toEqual({
        code: 'failed',
        message: "The share sheet couldn't open.",
      });
    });
  });

  it('rejects with unavailable where the host has no share sheet, as in Lynx Explorer', async () => {
    vi.stubGlobal('NativeModules', {});

    const { code, message } = await rejection(
      createShare().share({ text: 'Hi' }),
    );

    expect(code).toBe('unavailable');
    expect(message).toMatch(/ng build --platform/);
  });

  it.each([
    [{}, /needs files, a title, text or a URL/],
    [{ files: [] }, /needs files, a title, text or a URL/],
    [null, /needs files, a title, text or a URL/],
    [{ files: [{ blob: jpeg(), name: '' }] }, /files\[0\] isn't a file/],
    [{ files: [jpeg()] }, /files\[0\] isn't a file/],
    [{ files: [{ name: 'a.jpg' }] }, /files\[0\] isn't a file/],
    [{ files: [null] }, /files\[0\] isn't a file/],
    [{ url: '/post/42' }, /not an absolute URL/],
  ])('refuses %o', async (data, message) => {
    const { share } = stubModule();

    await expect(
      createShare().share(data as unknown as ShareData),
    ).rejects.toThrow(
      expect.objectContaining({
        name: 'TypeError',
        message: expect.stringMatching(message),
      }),
    );
    expect(share).not.toHaveBeenCalled();
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
 * A page with just what the web share uses: `navigator.share()`, `<a>` and
 * object URLs. web-core's iframe reaches it as its `parent`.
 */
const stubPage = (
  navigator: {
    share?: (data: Record<string, unknown>) => Promise<void>;
    canShare?: (data: Record<string, unknown>) => boolean;
  } = {},
) => {
  const anchors: {
    href: string;
    download: string;
    style: { display: string };
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }[] = [];
  const timers: (() => void)[] = [];
  const page = {
    navigator,
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
    setTimeout: vi.fn((handler: () => void) => timers.push(handler)),
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('parent', page);
  return { page, anchors, timers };
};

describe('LynxShare in the web preview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares through the page’s navigator.share(), with the page’s Files', async () => {
    const share = vi.fn(async () => {});
    const canShare = vi.fn(() => true);
    stubPage({ share, canShare });

    const shared = createShare().share({
      files: [{ blob: jpeg(), name: 'photo.jpg' }],
      title: 'My photo',
      text: 'Look',
      url: 'https://example.com',
    });

    // Before anything waits: Safari shares only during the tap.
    expect(share).toHaveBeenCalledTimes(1);
    await expect(shared).resolves.toBe(true);
    const data = (share.mock.calls[0] as unknown[])[0] as {
      files: PageFile[];
    };
    expect(data).toEqual({
      files: [expect.any(PageFile)],
      title: 'My photo',
      text: 'Look',
      url: 'https://example.com',
    });
    expect(data.files[0]).toMatchObject({
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
    expect([...new Uint8Array(await data.files[0]!.arrayBuffer())]).toEqual([
      0xff, 0xd8, 0xff, 0xe0,
    ]);
    expect(canShare).toHaveBeenCalledWith(data);
  });

  it('shares text where the browser has no canShare()', async () => {
    const share = vi.fn(async () => {});
    stubPage({ share });

    await expect(createShare().share({ text: 'Hi' })).resolves.toBe(true);
    expect(share).toHaveBeenCalledWith({ text: 'Hi' });
  });

  it('resolves false when the person closes the sheet', async () => {
    const abort = Object.assign(new Error('Share canceled'), {
      name: 'AbortError',
    });
    stubPage({ share: vi.fn(async () => Promise.reject(abort)) });

    await expect(createShare().share({ text: 'Hi' })).resolves.toBe(false);
  });

  it('rejects with failed when the browser refuses', async () => {
    const refusal = Object.assign(
      new Error('Must be handling a user gesture'),
      {
        name: 'NotAllowedError',
      },
    );
    stubPage({ share: vi.fn(async () => Promise.reject(refusal)) });

    expect(await rejection(createShare().share({ text: 'Hi' }))).toEqual({
      code: 'failed',
      message: "The browser didn't share: Must be handling a user gesture",
    });
  });

  it('rejects with failed when the browser refuses without a message', async () => {
    stubPage({ share: vi.fn(async () => Promise.reject(undefined)) });

    expect(await rejection(createShare().share({ text: 'Hi' }))).toEqual({
      code: 'failed',
      message: "The browser didn't share.",
    });
  });

  it('downloads the files where the browser can’t share them', async () => {
    const share = vi.fn(async () => {});
    const { page, anchors, timers } = stubPage({
      share,
      canShare: () => false,
    });

    await expect(
      createShare().share({
        files: [
          { blob: jpeg(), name: 'one.jpg' },
          { blob: jpeg(), name: 'two.jpg' },
        ],
      }),
    ).resolves.toBe(true);

    expect(share).not.toHaveBeenCalled();
    expect(anchors.map(({ href, download }) => [href, download])).toEqual([
      ['blob:page/one.jpg', 'one.jpg'],
      ['blob:page/two.jpg', 'two.jpg'],
    ]);
    for (const anchor of anchors) {
      expect(anchor.style.display).toBe('none');
      expect(anchor.click).toHaveBeenCalled();
      expect(anchor.remove).toHaveBeenCalled();
    }
    expect(page.document.body.appendChild).toHaveBeenCalledTimes(2);
    // The URLs stay until the browser has started saving.
    expect(page.URL.revokeObjectURL).not.toHaveBeenCalled();
    for (const timer of timers) timer();
    expect(page.URL.revokeObjectURL).toHaveBeenCalledWith('blob:page/one.jpg');
    expect(page.URL.revokeObjectURL).toHaveBeenCalledWith('blob:page/two.jpg');
  });

  it('downloads the files where the browser has no navigator.share()', async () => {
    const { anchors } = stubPage();

    await expect(
      createShare().share({ files: [{ blob: jpeg(), name: 'one.jpg' }] }),
    ).resolves.toBe(true);
    expect(anchors).toHaveLength(1);
  });

  it('rejects with unavailable for text where the browser can’t share', async () => {
    stubPage();

    expect(
      (await rejection(createShare().share({ url: 'https://example.com' })))
        .code,
    ).toBe('unavailable');
  });

  it('shares from its own window where the page is out of reach', async () => {
    const { page } = stubPage({ share: vi.fn(async () => {}) });
    Object.defineProperty(globalThis, 'parent', {
      configurable: true,
      get: () => ({
        get document() {
          throw new Error('cross-origin');
        },
      }),
    });
    vi.stubGlobal('navigator', page.navigator);
    vi.stubGlobal('File', PageFile);

    try {
      await expect(createShare().share({ text: 'Hi' })).resolves.toBe(true);
      expect(page.navigator.share).toHaveBeenCalled();
    } finally {
      delete (globalThis as { parent?: unknown }).parent;
    }
  });

  it('shares from its own window where it has no parent', async () => {
    const { page } = stubPage({ share: vi.fn(async () => {}) });
    vi.stubGlobal('parent', undefined);
    vi.stubGlobal('navigator', page.navigator);

    await expect(createShare().share({ text: 'Hi' })).resolves.toBe(true);
    expect(page.navigator.share).toHaveBeenCalled();
  });
});

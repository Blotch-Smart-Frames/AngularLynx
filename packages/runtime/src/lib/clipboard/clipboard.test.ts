import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxSystemInfo } from '../system-info/system-info';
import {
  ClipboardError,
  type ClipboardErrorCode,
  LynxClipboard,
} from './clipboard';

type Result = { value?: string; error?: string };
type Done = (result: Result) => void;

const createClipboard = () =>
  Injector.create({ providers: [LynxClipboard, LynxSystemInfo] }).get(
    LynxClipboard,
  );

/**
 * Stands in for the shells' AngularLynxClipboard module, as the background
 * thread sees it: one string, answered through a callback. Unit tests run as
 * the background thread, so the service calls it directly.
 */
const stubModule = (text = '') => {
  const clipboard = { text };
  const module = {
    setString: vi.fn((value: string, done: Done) => {
      clipboard.text = value;
      done({});
    }),
    getString: vi.fn((done: Done) => done({ value: clipboard.text })),
  };
  vi.stubGlobal('NativeModules', { AngularLynxClipboard: module });
  return { module, clipboard };
};

/**
 * The page around web-core's main-thread iframe, with a Clipboard API (or
 * none) and a document that copies a selection.
 */
const stubPage = (clipboard?: {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
}) => {
  const copied: string[] = [];
  const focused = { focus: vi.fn() };
  const fields: { value: string; removed: boolean }[] = [];
  const document = {
    activeElement: focused as { focus?(): void } | null,
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => {
      const field = {
        value: '',
        removed: false,
        style: {} as Record<string, string>,
        setAttribute: vi.fn(),
        select: vi.fn(),
        remove: () => {
          field.removed = true;
        },
      };
      fields.push(field);
      return field;
    }),
    execCommand: vi.fn((_command: string): boolean => {
      copied.push(fields[fields.length - 1].value);
      return true;
    }),
  };
  const page = {
    navigator: {
      clipboard: clipboard && {
        writeText: vi.fn(clipboard.writeText ?? (async () => undefined)),
        readText: vi.fn(clipboard.readText ?? (async () => '')),
      },
    },
    document,
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('parent', page);
  return { page, document, copied, fields, focused };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: ClipboardErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ClipboardError);
  const { code, message, name } = error as ClipboardError;
  expect(name).toBe('ClipboardError');
  return { code, message };
};

describe('LynxClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with the native module', () => {
    it('copies text and reads it back', async () => {
      const { module, clipboard } = stubModule('before');
      const service = createClipboard();

      await expect(service.getString()).resolves.toBe('before');
      await service.setString('ABC-123');

      expect(module.setString).toHaveBeenCalledWith(
        'ABC-123',
        expect.any(Function),
      );
      expect(clipboard.text).toBe('ABC-123');
      await expect(service.getString()).resolves.toBe('ABC-123');
    });

    it('copies what it is given as text', async () => {
      const { clipboard } = stubModule();

      await createClipboard().setString(42 as unknown as string);

      expect(clipboard.text).toBe('42');
    });

    it("reads an empty clipboard, or one the module can't read, as ''", async () => {
      const { module } = stubModule();
      module.getString.mockImplementation((done: Done) => done({}));

      await expect(createClipboard().getString()).resolves.toBe('');
    });

    it('rejects with the error the module reports', async () => {
      const { module } = stubModule();
      module.setString.mockImplementation((_value: string, done: Done) =>
        done({ error: 'The text is too long to copy.' }),
      );

      await expect(
        rejection(createClipboard().setString('long')),
      ).resolves.toEqual({
        code: 'failed',
        message: 'The text is too long to copy.',
      });
    });
  });

  describe('without the native module', () => {
    it('rejects with unavailable, as in Lynx Explorer', async () => {
      vi.stubGlobal('NativeModules', {});
      const service = createClipboard();

      const copy = await rejection(service.setString('a'));
      expect(copy.code).toBe('unavailable');
      expect(copy.message).toContain('ng build --platform');
      await expect(rejection(service.getString())).resolves.toMatchObject({
        code: 'unavailable',
      });
    });
  });

  describe('under the testing library', () => {
    it('keeps the text in memory, one clipboard per app', async () => {
      vi.stubGlobal('lynxTestingEnv', {});
      const { module } = stubModule('native');
      const service = createClipboard();

      await expect(service.getString()).resolves.toBe('');
      await service.setString('copied');
      await expect(service.getString()).resolves.toBe('copied');
      await expect(createClipboard().getString()).resolves.toBe('');
      expect(module.setString).not.toHaveBeenCalled();
    });
  });

  describe('in the web preview', () => {
    it("copies with the page's Clipboard API and reads it back", async () => {
      let text = '';
      const { page, document } = stubPage({
        writeText: async (value) => {
          text = value;
        },
        readText: async () => text,
      });
      const { module } = stubModule();
      const service = createClipboard();

      await service.setString('ABC-123');

      expect(page.navigator.clipboard?.writeText).toHaveBeenCalledWith(
        'ABC-123',
      );
      expect(document.execCommand).not.toHaveBeenCalled();
      await expect(service.getString()).resolves.toBe('ABC-123');
      expect(module.setString).not.toHaveBeenCalled();
    });

    it('calls the browser before the tap handler returns', () => {
      const { page } = stubPage({});

      void createClipboard().setString('now');

      expect(page.navigator.clipboard?.writeText).toHaveBeenCalledWith('now');
    });

    it('copies a selection where the page has no Clipboard API', async () => {
      const { copied, fields, focused } = stubPage();

      await createClipboard().setString('over http');

      expect(copied).toEqual(['over http']);
      expect(fields[0].removed).toBe(true);
      expect(focused.focus).toHaveBeenCalled();
    });

    it('copies a selection when the Clipboard API refuses', async () => {
      const { copied } = stubPage({
        writeText: () => Promise.reject(new Error('Document is not focused.')),
      });

      await createClipboard().setString('fallback');

      expect(copied).toEqual(['fallback']);
    });

    it('rejects when neither way copies, with the reason the browser gave', async () => {
      const { document } = stubPage({
        writeText: () =>
          Promise.reject({ message: 'Write permission denied.' }),
      });
      document.execCommand.mockReturnValue(false);

      await expect(
        rejection(createClipboard().setString('a')),
      ).resolves.toEqual({
        code: 'failed',
        message:
          "The browser didn't let the page copy: Write permission denied.",
      });
    });

    it('rejects when the browser refuses a selection copy', async () => {
      const { document } = stubPage();
      document.activeElement = null;
      document.execCommand.mockImplementation(() => {
        throw new Error('Not allowed');
      });

      await expect(
        rejection(createClipboard().setString('a')),
      ).resolves.toEqual({
        code: 'failed',
        message: "The browser didn't let the page copy.",
      });
    });

    it("reads a refused or missing clipboard as ''", async () => {
      stubPage({
        readText: () => Promise.reject(new Error('Read permission denied.')),
      });
      await expect(createClipboard().getString()).resolves.toBe('');

      stubPage();
      await expect(createClipboard().getString()).resolves.toBe('');
    });

    it('uses its own window when it is not in a frame', async () => {
      stubPage({});
      const { page } = stubPage({});
      vi.stubGlobal('parent', undefined);
      vi.stubGlobal('navigator', page.navigator);
      vi.stubGlobal('document', page.document);

      await createClipboard().setString('top');

      expect(page.navigator.clipboard?.writeText).toHaveBeenCalledWith('top');
    });
  });

  describe('confirmsCopies', () => {
    it.each([
      ['Android', '13', true],
      ['Android', '16', true],
      ['Android', '12', false],
      ['Android', '8.1.0', false],
      ['Android', '', false],
      ['iOS', '26.1', false],
      ['web', '', false],
    ])('on %s %s is %s', (platform, osVersion, expected) => {
      vi.stubGlobal('SystemInfo', { platform, osVersion });

      expect(createClipboard().confirmsCopies).toBe(expected);
    });

    it('is false where there is no SystemInfo', () => {
      expect(createClipboard().confirmsCopies).toBe(false);
    });
  });
});

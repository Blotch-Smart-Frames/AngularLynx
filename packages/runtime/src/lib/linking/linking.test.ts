import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkingError, type LinkingErrorCode, LynxLinking } from './linking';

type Result = { value?: boolean; error?: string; message?: string };
type Done = (result: Result) => void;

const createLinking = () =>
  Injector.create({ providers: [LynxLinking] }).get(LynxLinking);

/**
 * Stands in for the shells' AngularLynxLinking module, as the background
 * thread sees it. Unit tests run as the background thread, so the service
 * calls it directly. Each method answers with `result`.
 */
const stubModule = (result: Result = {}) => {
  const module = {
    openURL: vi.fn((_url: string, done: Done) => done(result)),
    openInApp: vi.fn((_url: string, _request: unknown, done: Done) =>
      done(result),
    ),
    canOpenURL: vi.fn((_url: string, done: Done) => done(result)),
  };
  vi.stubGlobal('NativeModules', { AngularLynxLinking: module });
  return module;
};

/**
 * Lynx for Web: the page's `window.open`, which returns `tab`, and the
 * document's visibility.
 */
const stubBrowser = (tab: { opener: unknown; closed: boolean } | null) => {
  const document = { visibilityState: 'visible' };
  const open = vi.fn(() => tab);
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('open', open);
  vi.stubGlobal('document', document);
  return { open, document };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: LinkingErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(LinkingError);
  const { code, message } = error as LinkingError;
  return { code, message };
};

describe('LynxLinking', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('with the native module', () => {
    it('hands a URL to the system', async () => {
      const module = stubModule();

      await expect(
        createLinking().openURL('mailto:support@example.com'),
      ).resolves.toBeUndefined();
      expect(module.openURL).toHaveBeenCalledWith(
        'mailto:support@example.com',
        expect.any(Function),
      );
    });

    it("rejects with failed when nothing can open the URL, with the module's message", async () => {
      stubModule({ error: 'failed', message: 'Nothing can open myapp:' });

      await expect(
        rejection(createLinking().openURL('myapp://x')),
      ).resolves.toEqual({
        code: 'failed',
        message: 'Nothing can open myapp:',
      });
    });

    it('says why when the module gives no message', async () => {
      stubModule({ error: 'failed' });

      await expect(
        rejection(createLinking().openInApp('https://example.com')),
      ).resolves.toEqual({ code: 'failed', message: "The link didn't open." });
    });

    it('opens the browser sheet with its colors as eight hex digits', async () => {
      const module = stubModule();

      await expect(
        createLinking().openInApp('HTTPS://example.com/help', {
          toolbarColor: 'rgba(30, 58, 138, 0.5)',
          controlsColor: '#fff',
        }),
      ).resolves.toBeUndefined();
      expect(module.openInApp).toHaveBeenCalledWith(
        'HTTPS://example.com/help',
        { toolbarColor: '#1E3A8A80', controlsColor: '#FFFFFFFF' },
        expect.any(Function),
      );
    });

    it('sends no colors when none are given', async () => {
      const module = stubModule();

      await createLinking().openInApp('http://example.com');
      expect(module.openInApp).toHaveBeenCalledWith(
        'http://example.com',
        {},
        expect.any(Function),
      );
    });

    it('answers whether something can open a URL', async () => {
      const module = stubModule({ value: true });
      const linking = createLinking();

      await expect(linking.canOpenURL('tel:123')).resolves.toBe(true);
      expect(module.canOpenURL).toHaveBeenCalledWith(
        'tel:123',
        expect.any(Function),
      );

      stubModule({});
      await expect(linking.canOpenURL('whatsapp://send')).resolves.toBe(false);
    });

    it("passes on the module's failure from canOpenURL", async () => {
      stubModule({ error: 'failed', message: 'Not a URL' });

      await expect(
        rejection(createLinking().canOpenURL('x:%')),
      ).resolves.toEqual({ code: 'failed', message: 'Not a URL' });
    });

    it('treats a module that answers nothing as done', async () => {
      vi.stubGlobal('NativeModules', {
        AngularLynxLinking: {
          openURL: (_url: string, done: (result?: Result) => void) => done(),
        },
      });

      await expect(
        createLinking().openURL('https://example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('without the native module, as in Lynx Explorer', () => {
    it('rejects openURL and openInApp with unavailable', async () => {
      const linking = createLinking();

      for (const opening of [
        linking.openURL('https://example.com'),
        linking.openInApp('https://example.com'),
      ]) {
        const { code, message } = await rejection(opening);
        expect(code).toBe('unavailable');
        expect(message).toContain('ng build --platform');
      }
    });

    it('resolves canOpenURL false', async () => {
      await expect(
        createLinking().canOpenURL('https://example.com'),
      ).resolves.toBe(false);
    });
  });

  describe('checking what it is given', () => {
    it('rejects a URL without a scheme with a TypeError', async () => {
      const linking = createLinking();

      await expect(linking.openURL('/help')).rejects.toThrow(TypeError);
      await expect(linking.openInApp('example.com')).rejects.toThrow(
        /not an absolute URL/,
      );
      await expect(linking.canOpenURL('')).rejects.toThrow(TypeError);
    });

    it('rejects a URL openInApp can’t show before calling the module', async () => {
      const module = stubModule();

      await expect(
        createLinking().openInApp('mailto:support@example.com'),
      ).rejects.toThrow(/http and https URLs only/);
      expect(module.openInApp).not.toHaveBeenCalled();
    });

    it.each([
      ['#1e3a8a', '#1E3A8AFF'],
      ['#1e3a8a80', '#1E3A8A80'],
      ['#abc', '#AABBCCFF'],
      ['#abcd', '#AABBCCDD'],
      ['rgb(255, 0, 16)', '#FF0010FF'],
      [' rgba(0,0,0,.25) ', '#00000040'],
    ])('reads %s as %s', async (color, hex) => {
      const module = stubModule();

      await createLinking().openInApp('https://example.com', {
        toolbarColor: color,
      });
      expect(module.openInApp.mock.calls[0][1]).toEqual({ toolbarColor: hex });
    });

    it.each([
      'red',
      '#12345',
      'rgb(256, 0, 0)',
      'rgba(0, 0, 0, 2)',
      'rgb(0 0 0)',
    ])('rejects the color %s with a TypeError', async (color) => {
      const module = stubModule();

      await expect(
        createLinking().openInApp('https://example.com', {
          controlsColor: color,
        }),
      ).rejects.toThrow(/controlsColor .* is not a color/);
      expect(module.openInApp).not.toHaveBeenCalled();
    });
  });

  describe('on the web', () => {
    it('opens a URL in a new tab, without access to the app', async () => {
      const tab = { opener: {} as unknown, closed: false };
      const { open } = stubBrowser(tab);
      const module = stubModule();

      await expect(
        createLinking().openURL('https://example.com'),
      ).resolves.toBeUndefined();
      expect(open).toHaveBeenCalledWith('https://example.com', '_blank');
      expect(tab.opener).toBeNull();
      expect(module.openURL).not.toHaveBeenCalled();
    });

    it('opens the tab before anything is awaited, so the tap still counts', () => {
      const { open } = stubBrowser({ opener: null, closed: false });

      void createLinking().openURL('https://example.com');
      void createLinking().openInApp('https://example.com');
      expect(open).toHaveBeenCalledTimes(2);
    });

    it('still opens the page when the opener cannot be cleared', async () => {
      const tab = {
        get opener() {
          return {};
        },
        set opener(_value: unknown) {
          throw new Error('read-only');
        },
        closed: false,
      };
      stubBrowser(tab);

      await expect(
        createLinking().openURL('https://example.com'),
      ).resolves.toBeUndefined();
    });

    it('rejects with failed when the browser blocks the tab', async () => {
      stubBrowser(null);

      await expect(
        rejection(createLinking().openInApp('https://example.com')),
      ).resolves.toEqual({
        code: 'failed',
        message: 'The browser blocked the new tab. Open links from a tap.',
      });
    });

    it('resolves openInApp when the tab closes', async () => {
      vi.useFakeTimers();
      const tab = { opener: null, closed: false };
      stubBrowser(tab);
      const resolved = vi.fn();

      void createLinking().openInApp('https://example.com').then(resolved);
      await vi.advanceTimersByTimeAsync(1000);
      expect(resolved).not.toHaveBeenCalled();

      tab.closed = true;
      await vi.advanceTimersByTimeAsync(250);
      expect(resolved).toHaveBeenCalled();
    });

    it("resolves openInApp when the person comes back to the app's tab", async () => {
      vi.useFakeTimers();
      const { document } = stubBrowser({ opener: null, closed: false });
      const resolved = vi.fn();

      void createLinking().openInApp('https://example.com').then(resolved);
      document.visibilityState = 'hidden';
      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).not.toHaveBeenCalled();

      document.visibilityState = 'visible';
      await vi.advanceTimersByTimeAsync(250);
      expect(resolved).toHaveBeenCalled();
    });

    it('resolves canOpenURL true, since a browser cannot tell', async () => {
      stubBrowser(null);

      await expect(createLinking().canOpenURL('whatsapp://send')).resolves.toBe(
        true,
      );
    });

    it("opens the tab from the page around web-core's sandboxed iframe", async () => {
      const own = stubBrowser({ opener: null, closed: false });
      const parentOpen = vi.fn(() => ({ opener: null, closed: false }));
      vi.stubGlobal('parent', { open: parentOpen });

      await createLinking().openURL('https://example.com');
      expect(parentOpen).toHaveBeenCalledWith('https://example.com', '_blank');
      expect(own.open).not.toHaveBeenCalled();
    });

    it('opens the tab itself when the page around it is of another origin', async () => {
      const { open } = stubBrowser({ opener: null, closed: false });
      vi.stubGlobal('parent', {
        get open() {
          throw new Error('SecurityError');
        },
      });

      await createLinking().openURL('https://example.com');
      expect(open).toHaveBeenCalled();
    });

    it('uses the native module where the page has no window.open', async () => {
      vi.stubGlobal('SystemInfo', { platform: 'web' });
      vi.stubGlobal('open', undefined);
      const module = stubModule();

      await createLinking().openURL('https://example.com');
      expect(module.openURL).toHaveBeenCalled();
    });
  });
});

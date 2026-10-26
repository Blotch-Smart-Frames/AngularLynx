import { describe, expect, it, vi } from 'vitest';
import {
  HMR_CHECK,
  HMR_CHECK_RESULT,
  HMR_FETCH,
  HMR_FETCH_RESULT,
} from './hmr-protocol';
import {
  type MainThreadHotUpdatesOptions,
  startMainThreadHotUpdates,
} from './main-thread-hot-updates';
import { createTestContext } from './testing/test-context';

/**
 * Lets the client's promise chains settle.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (overrides: Partial<MainThreadHotUpdatesOptions> = {}) => {
  const channel = createTestContext();
  const hot = {
    check: vi.fn(async (): Promise<(string | number)[] | null> => ['a', 'b']),
    status: vi.fn(() => 'idle'),
  };
  const lynx: MainThreadHotUpdatesOptions['lynx'] = {};
  let bootstrap: unknown;
  let running = true;
  startMainThreadHotUpdates({
    hot,
    lynx,
    context: channel.context,
    currentBootstrap: () => bootstrap,
    appRunning: () => running,
    ...overrides,
  });
  return {
    ...channel,
    hot,
    lynx,
    setBootstrap: (value: unknown) => {
      bootstrap = value;
    },
    setRunning: (value: boolean) => {
      running = value;
    },
    /** Loads a file through the main thread's `requireModuleAsync`. */
    load: (url: string) => {
      const callback = vi.fn();
      lynx.requireModuleAsync!(url, callback);
      const [{ id }] = channel.sentOf(HMR_FETCH).slice(-1);
      return {
        callback,
        respond: (result: object) =>
          channel.receive(HMR_FETCH_RESULT, { id, ...result }),
      };
    },
    /** The background thread asking for an update, and the answer. */
    check: async () => {
      channel.receive(HMR_CHECK, { id: 7, hash: 'new' });
      await settle();
      return channel.sentOf(HMR_CHECK_RESULT).slice(-1)[0];
    },
  };
};

describe('startMainThreadHotUpdates', () => {
  describe("the main thread's requireModuleAsync", () => {
    it('has the background thread fetch the file', () => {
      const { load, sentOf } = setup();

      load('http://dev/main__main-thread.abc.hot-update.json');

      expect(sentOf(HMR_FETCH)).toEqual([
        { id: 0, url: 'http://dev/main__main-thread.abc.hot-update.json' },
      ]);
    });

    it('parses a JSON manifest', () => {
      const { load } = setup();
      const { callback, respond } = load('http://dev/x.hot-update.json');

      respond({ status: 200, text: '{"c":["main__main-thread"]}' });

      expect(callback).toHaveBeenCalledWith(null, { c: ['main__main-thread'] });
    });

    it('runs a hot update chunk and returns its exports', () => {
      const { load } = setup();
      const { callback, respond } = load('http://dev/x.hot-update.js');

      respond({
        status: 200,
        text: 'exports.ids = ["main"]; module.exports.modules = { a: 1 };',
      });

      expect(callback).toHaveBeenCalledWith(null, {
        ids: ['main'],
        modules: { a: 1 },
      });
    });

    it('reports a missing file the way the hot update runtime expects', () => {
      const { load } = setup();
      const { callback, respond } = load('http://dev/x.hot-update.json');

      respond({ status: 404, text: 'Not Found' });

      const [error] = callback.mock.calls[0];
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('MODULE_NOT_FOUND');
    });

    it('reports a server error, a failed fetch and a chunk that throws', () => {
      const { load } = setup();
      const serverError = load('http://dev/a.js');
      serverError.respond({ status: 500, text: '' });
      const failed = load('http://dev/b.js');
      failed.respond({ error: 'offline' });
      const throwing = load('http://dev/c.js');
      throwing.respond({ status: 200, text: 'throw new Error("boom")' });

      expect(serverError.callback.mock.calls[0][0].message).toBe(
        'Loading http://dev/a.js failed with HTTP 500',
      );
      expect(failed.callback.mock.calls[0][0].message).toBe(
        'Loading http://dev/b.js failed: offline',
      );
      expect(throwing.callback.mock.calls[0][0].message).toBe('boom');
    });

    it('ignores a fetch result nothing waits for', () => {
      const { receive } = setup();

      expect(() =>
        receive(HMR_FETCH_RESULT, { id: 42, status: 200, text: '' }),
      ).not.toThrow();
    });

    it('keeps a requireModuleAsync the thread already has', () => {
      const existing = vi.fn();
      const lynx = { requireModuleAsync: existing };

      setup({ lynx });

      expect(lynx.requireModuleAsync).toBe(existing);
    });
  });

  describe('applying an update', () => {
    it('applies it and reports how many modules it updated', async () => {
      const { check, hot } = setup();

      expect(await check()).toEqual({ id: 7, ok: true, updatedModules: 2 });
      expect(hot.check).toHaveBeenCalledWith(true);
    });

    it('waits for the app to bootstrap again when the update re-ran the entry', async () => {
      const { receive, sentOf, hot, setBootstrap } = setup();
      let finish!: () => void;
      hot.check.mockImplementationOnce(async () => {
        setBootstrap(new Promise<void>((resolve) => (finish = resolve)));
        return ['main'];
      });

      receive(HMR_CHECK, { id: 7, hash: 'new' });
      await settle();
      expect(sentOf(HMR_CHECK_RESULT)).toEqual([]);
      finish();
      await settle();

      expect(sentOf(HMR_CHECK_RESULT)).toEqual([
        { id: 7, ok: true, updatedModules: 1 },
      ]);
    });

    it('fails when the app fails to bootstrap again', async () => {
      const { check, hot, setBootstrap } = setup();
      hot.check.mockImplementationOnce(async () => {
        setBootstrap(Promise.reject(new Error('constructor threw')));
        return ['main'];
      });

      expect(await check()).toEqual({
        id: 7,
        ok: false,
        reason: expect.stringContaining('Error: constructor threw'),
      });
    });

    it('fails when no app is running after it', async () => {
      const { check, setRunning } = setup();
      setRunning(false);

      expect(await check()).toEqual({
        id: 7,
        ok: false,
        reason: 'The app is not running.',
      });
    });

    it('fails when the server has no update for this build', async () => {
      const { check, hot } = setup();
      hot.check.mockResolvedValueOnce(null);

      expect(await check()).toEqual({
        id: 7,
        ok: false,
        reason: 'Cannot find update.',
      });
    });

    it('fails when the update throws', async () => {
      const { check, hot } = setup();
      hot.check.mockRejectedValueOnce(new Error('module threw'));

      expect(await check()).toEqual({
        id: 7,
        ok: false,
        reason: expect.stringContaining('module threw'),
      });
    });

    it("fails when the thread's hot update runtime isn't idle", async () => {
      const { check, hot } = setup();
      hot.status.mockReturnValue('fail');

      expect(await check()).toEqual({
        id: 7,
        ok: false,
        reason: 'The hot update status is "fail".',
      });
      expect(hot.check).not.toHaveBeenCalled();
    });
  });
});

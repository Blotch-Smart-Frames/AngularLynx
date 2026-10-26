import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAIN_THREAD_TIMEOUT_MS,
  startBackgroundHotUpdates,
} from './background-hot-updates';
import {
  HMR_CHECK,
  HMR_CHECK_RESULT,
  HMR_FETCH,
  HMR_FETCH_RESULT,
  HMR_RELOAD,
} from './hmr-protocol';
import { createTestContext } from './testing/test-context';

/**
 * Lets the client's promise chains settle.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
  const channel = createTestContext();
  const listeners: Array<(hash: string) => void> = [];
  let hash = 'old';
  const hot = {
    check: vi.fn(async (): Promise<(string | number)[] | null> => {
      hash = 'new';
      return ['./src/app.ts'];
    }),
    status: vi.fn(() => 'idle'),
  };
  const options = {
    hot,
    emitter: { on: vi.fn((_event, listener) => listeners.push(listener)) },
    currentHash: () => hash,
    context: channel.context,
    fetch: vi.fn(async (url: string) => ({
      status: 200,
      text: async () => `contents of ${url}`,
    })),
    reloadPage: vi.fn(),
    log: vi.fn(),
    logApplyResult: vi.fn(),
  };
  startBackgroundHotUpdates(options);
  return {
    ...channel,
    ...options,
    setHash: (value: string) => {
      hash = value;
    },
    /** The dev transport announcing a new build. */
    announce: (value: string) =>
      listeners.forEach((listener) => listener(value)),
    /** The main thread answering the last check it was sent. */
    answer: (result: object) => {
      const [{ id }] = channel.sentOf(HMR_CHECK).slice(-1);
      channel.receive(HMR_CHECK_RESULT, { id, ...result });
    },
  };
};

describe('startBackgroundHotUpdates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetching for the main thread', () => {
    it('fetches a file and sends back its status and text', async () => {
      const { receive, sentOf, fetch } = setup();

      receive(HMR_FETCH, { id: 3, url: 'http://dev/a.json' });
      await settle();

      expect(fetch).toHaveBeenCalledWith('http://dev/a.json');
      expect(sentOf(HMR_FETCH_RESULT)).toEqual([
        { id: 3, status: 200, text: 'contents of http://dev/a.json' },
      ]);
    });

    it('sends back why a fetch failed', async () => {
      const { receive, sentOf, fetch } = setup();
      fetch.mockRejectedValueOnce(new TypeError('offline'));

      receive(HMR_FETCH, { id: 4, url: 'http://dev/a.json' });
      await settle();

      expect(sentOf(HMR_FETCH_RESULT)).toEqual([
        { id: 4, error: expect.stringContaining('offline') },
      ]);
    });
  });

  describe('applying an update', () => {
    it('applies it here, then on the main thread', async () => {
      const { announce, answer, hot, sentOf, logApplyResult, log, reloadPage } =
        setup();

      announce('new');
      await settle();
      expect(hot.check).toHaveBeenCalledWith(true);
      expect(sentOf(HMR_CHECK)).toEqual([{ id: 0, hash: 'new' }]);
      // Nothing is logged as applied until the main thread has it too.
      expect(logApplyResult).not.toHaveBeenCalled();

      answer({ ok: true, updatedModules: 1 });
      await settle();
      expect(logApplyResult).toHaveBeenCalledWith(
        ['./src/app.ts'],
        ['./src/app.ts'],
      );
      expect(log).toHaveBeenCalledWith('info', '[HMR] App is up to date.');
      expect(reloadPage).not.toHaveBeenCalled();
    });

    it('ignores the hash this thread already runs', () => {
      const { announce, hot } = setup();

      announce('old');

      expect(hot.check).not.toHaveBeenCalled();
    });

    it('waits for the update in progress, then applies the newer one', async () => {
      const { announce, answer, hot, sentOf, setHash } = setup();

      announce('new');
      await settle();
      // A newer build arrives while the main thread is still applying.
      announce('third');
      expect(hot.check).toHaveBeenCalledTimes(1);

      hot.check.mockImplementationOnce(async () => ['./src/b.ts']);
      answer({ ok: true, updatedModules: 1 });
      await settle();
      expect(hot.check).toHaveBeenCalledTimes(2);
      expect(sentOf(HMR_CHECK).slice(-1)[0]).toEqual({ id: 1, hash: 'third' });

      // Both threads now run the newer build, so a repeat of its hash is
      // ignored.
      setHash('third');
      answer({ ok: true, updatedModules: 1 });
      await settle();
      announce('third');
      expect(hot.check).toHaveBeenCalledTimes(2);
    });

    it("doesn't start while this thread's hot update runtime is busy", () => {
      const { announce, hot } = setup();
      hot.status.mockReturnValue('apply');

      announce('new');

      expect(hot.check).not.toHaveBeenCalled();
    });
  });

  describe('reloading the page', () => {
    it('reloads when the main thread fails to apply the update', async () => {
      const { announce, answer, reloadPage, log } = setup();

      announce('new');
      await settle();
      answer({ ok: false, reason: 'The app is not running.' });
      await settle();

      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'warning',
        '[HMR] Main thread: The app is not running.',
      );
    });

    it('reloads when the main thread never answers', async () => {
      vi.useFakeTimers();
      const { announce, reloadPage, log } = setup();

      announce('new');
      await vi.advanceTimersByTimeAsync(0);
      expect(reloadPage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(MAIN_THREAD_TIMEOUT_MS);

      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining("didn't apply the update within 60s"),
      );
    });

    it('ignores an answer to a check it no longer waits for', async () => {
      const { announce, answer, receive, reloadPage } = setup();

      announce('new');
      await settle();
      receive(HMR_CHECK_RESULT, { id: 99, ok: false, reason: 'stale' });
      answer({ ok: true, updatedModules: 1 });
      await settle();

      expect(reloadPage).not.toHaveBeenCalled();
    });

    it('reloads when the server has no update from this build', async () => {
      const { announce, hot, reloadPage, sentOf } = setup();
      hot.check.mockResolvedValueOnce(null);

      announce('new');
      await settle();

      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(sentOf(HMR_CHECK)).toEqual([]);
    });

    it('reloads when this thread can no longer apply updates', async () => {
      const { announce, hot, reloadPage } = setup();
      hot.check.mockRejectedValueOnce(new Error('Aborted'));
      hot.status.mockReturnValueOnce('idle').mockReturnValue('abort');

      announce('new');
      await settle();

      expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it("doesn't reload for an error that leaves the old build running", async () => {
      const { announce, hot, reloadPage, log, sentOf } = setup();
      hot.check.mockRejectedValueOnce(new Error('network'));

      announce('new');
      await settle();

      expect(reloadPage).not.toHaveBeenCalled();
      expect(sentOf(HMR_CHECK)).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('[HMR] Update failed: Error: network'),
      );
    });

    it('reloads when the main thread asks, for a stylesheet it cannot apply', () => {
      const { receive, reloadPage } = setup();

      receive(HMR_RELOAD, { reason: 'no stylesheet API' });

      expect(reloadPage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('formatError', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('includes the message, which PrimJS leaves out of the stack', async () => {
    const { formatError } = await import('./hmr-protocol');
    const error = new Error('boom');
    error.stack = '    at f (file.js:1:1)';

    expect(formatError(error)).toBe('Error: boom\n    at f (file.js:1:1)');
    expect(formatError('text')).toBe('text');
  });

  it("doesn't repeat a message the stack already has", async () => {
    const { formatError } = await import('./hmr-protocol');
    const error = new TypeError('bad');
    error.stack = 'TypeError: bad\n    at f (file.js:1:1)';

    expect(formatError(error)).toBe('TypeError: bad\n    at f (file.js:1:1)');
    error.stack = undefined;
    expect(formatError(error)).toBe('TypeError: bad');
  });
});

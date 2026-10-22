import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxLogger } from './lynx-logger';

const DEV_LOG_URL = 'http://localhost:3001/__dev_logs';

describe('LynxLogger', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('production mode (__DEV__ = false)', () => {
    beforeEach(() => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
    });

    it('log() is a no-op', () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      const service = new LynxLogger();
      service.log('hello');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['warn', 'error', 'info', 'debug'] as const)(
      '%s() is a no-op',
      (method) => {
        const fetchMock = vi.fn().mockResolvedValue({});
        vi.stubGlobal('fetch', fetchMock);

        const service = new LynxLogger();
        service[method]('msg');

        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('dev mode — no URL configured', () => {
    beforeEach(() => {
      vi.stubGlobal('__DEV__', true);
      // __DEV_LOG_URL__ intentionally not stubbed — simulates un-configured build
    });

    it('does not call fetch when URL is missing', () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);

      const service = new LynxLogger();
      service.log('hello');

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('dev mode — background thread (fetch available)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
      fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);
    });

    it('log() sends a POST request to the dev log URL', () => {
      const service = new LynxLogger();
      service.log('hello', 'world');

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        DEV_LOG_URL,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it.each(['log', 'warn', 'error', 'info', 'debug'] as const)(
      '%s() includes the correct level in the request body',
      (method) => {
        const service = new LynxLogger();
        service[method]('msg');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.logs[0].level).toBe(method);
      },
    );

    it('serializes all args as strings', () => {
      const service = new LynxLogger();
      service.log(42, true, { key: 'val' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.logs[0].args).toEqual(['42', 'true', '[object Object]']);
    });

    it('includes a numeric timestamp in the request body', () => {
      const before = Date.now();
      const service = new LynxLogger();
      service.log('ts test');
      const after = Date.now();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.logs[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(body.logs[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('dev mode — main thread (no fetch)', () => {
    let dispatchEventMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
      // Simulate main thread: no fetch available
      vi.stubGlobal('fetch', undefined);
      dispatchEventMock = vi.fn();
      vi.stubGlobal('lynx', {
        getJSContext: () => ({ dispatchEvent: dispatchEventMock }),
      });
    });

    it('log() dispatches an IPC event to the background thread', () => {
      const service = new LynxLogger();
      service.log('main thread msg');

      expect(dispatchEventMock).toHaveBeenCalledOnce();
      expect(dispatchEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: '__lynx_log__' }),
      );
    });

    it('IPC event data is a JSON-serialized log entry with the correct level', () => {
      const service = new LynxLogger();
      service.warn('a', 'b');

      const event = dispatchEventMock.mock.calls[0][0];
      const data = JSON.parse(event.data);
      expect(data.level).toBe('warn');
      expect(data.args).toEqual(['a', 'b']);
    });

    it('does not throw when lynx is not available on main thread', () => {
      vi.stubGlobal('lynx', undefined);

      const service = new LynxLogger();
      expect(() => service.log('msg')).not.toThrow();
    });
  });

  describe('fetch failure handling', () => {
    it('swallows a rejected fetch promise (background thread)', async () => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('server unreachable'));
      vi.stubGlobal('fetch', fetchMock);

      const service = new LynxLogger();
      // The `.catch(() => {})` on the fetch promise must eat the rejection so
      // an offline dev server never crashes the app.
      expect(() => service.log('will fail')).not.toThrow();
      // Give the microtask queue a tick to run the catch handler.
      await Promise.resolve();
    });

    it('swallows a synchronously-thrown fetch (defensive try/catch)', () => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
      const fetchMock = vi.fn(() => {
        throw new Error('boom');
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new LynxLogger();
      // The outer try/catch protects against the fetchFn itself throwing
      // synchronously (e.g. a badly-shimmed native fetch).
      expect(() => service.log('will throw')).not.toThrow();
    });

    it('swallows an IPC dispatchEvent that throws (main-thread relay)', () => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
      vi.stubGlobal('fetch', undefined);
      vi.stubGlobal('lynx', {
        getJSContext: () => ({
          dispatchEvent: () => {
            throw new Error('ipc closed');
          },
        }),
      });

      const service = new LynxLogger();
      expect(() => service.log('main thread')).not.toThrow();
    });
  });

  // Angular runs on the main thread only, so no LynxLogger exists on the
  // background thread: the relay that posts main-thread logs is installed when
  // the module loads there.
  describe('background-thread relay', () => {
    /**
     * Imports the module again, with the globals the relay reads at load time
     * already stubbed.
     */
    const loadModule = async (): Promise<void> => {
      vi.resetModules();
      await import('./lynx-logger');
    };

    /**
     * A core context that records its listener, which the tests then call.
     */
    const stubCoreContext = (): {
      handler: () => ((e: unknown) => void) | undefined;
    } => {
      let handler: ((e: unknown) => void) | undefined;
      vi.stubGlobal('lynx', {
        getCoreContext: () => ({
          addEventListener: (type: string, fn: (e: unknown) => void) => {
            if (type === '__lynx_log__') handler = fn;
          },
        }),
      });
      return { handler: () => handler };
    };

    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__DEV_LOG_URL__', DEV_LOG_URL);
      fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal('fetch', fetchMock);
    });

    it('posts each entry the main thread relays', async () => {
      const core = stubCoreContext();
      await loadModule();

      const relayedEntry = {
        level: 'warn',
        timestamp: 1000,
        args: ['relayed'],
      };
      core.handler()!({ data: JSON.stringify(relayedEntry) });

      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.logs[0]).toEqual(relayedEntry);
    });

    it('swallows a malformed relayed payload', async () => {
      const core = stubCoreContext();
      await loadModule();

      expect(() => core.handler()!({ data: 'not-json' })).not.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is not installed on the main thread', async () => {
      vi.stubGlobal('__MAIN_THREAD__', true);
      const core = stubCoreContext();
      await loadModule();

      expect(core.handler()).toBeUndefined();
    });

    it('is not installed without a dev server URL', async () => {
      vi.stubGlobal('__DEV_LOG_URL__', undefined);
      const core = stubCoreContext();
      await loadModule();

      expect(core.handler()).toBeUndefined();
    });

    it('is not installed without fetch', async () => {
      vi.stubGlobal('fetch', undefined);
      const core = stubCoreContext();
      await loadModule();

      expect(core.handler()).toBeUndefined();
    });

    it('is not installed outside Lynx', async () => {
      vi.stubGlobal('lynx', undefined);
      await expect(loadModule()).resolves.toBeUndefined();
    });

    it('swallows a core context that throws', async () => {
      vi.stubGlobal('lynx', {
        getCoreContext: () => ({
          addEventListener: () => {
            throw new Error('core context torn down');
          },
        }),
      });
      await expect(loadModule()).resolves.toBeUndefined();
    });
  });
});

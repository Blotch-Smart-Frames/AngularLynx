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

    it('registers an IPC listener on lynx.getCoreContext() for main-thread relay', () => {
      const addEventListenerMock = vi.fn();
      vi.stubGlobal('lynx', {
        getCoreContext: () => ({ addEventListener: addEventListenerMock }),
      });

      new LynxLogger();

      expect(addEventListenerMock).toHaveBeenCalledWith(
        '__lynx_log__',
        expect.any(Function),
      );
    });

    it('IPC listener parses the event and posts the entry to the server', () => {
      let capturedHandler: ((e: any) => void) | undefined;
      vi.stubGlobal('lynx', {
        getCoreContext: () => ({
          addEventListener: (_: string, fn: (e: any) => void) => {
            capturedHandler = fn;
          },
        }),
      });

      new LynxLogger();

      const relayedEntry = {
        level: 'warn',
        timestamp: 1000,
        args: ['relayed'],
      };
      capturedHandler!({ data: JSON.stringify(relayedEntry) });

      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.logs[0]).toEqual(relayedEntry);
    });

    it('does not register IPC listener when lynx is not available', () => {
      // lynx global intentionally not stubbed
      expect(() => new LynxLogger()).not.toThrow();
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
});

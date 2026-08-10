import http from 'node:http';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { applyDevLogger } from './dev-logger';
import { createDevLoggerMiddleware } from './dev-logger-middleware.js';

vi.mock('./dev-logger-middleware.js', () => ({
  createDevLoggerMiddleware: vi.fn(() => vi.fn()),
  getLogFilePath: vi.fn(() => '/mock/.dev-logs'),
}));

type ConfigCallback = (
  config: Record<string, unknown>,
) => Record<string, unknown>;
type ServerCallback = (params: { port: number }) => void;

const createMockApi = () => {
  let configCb: ConfigCallback | undefined;
  let serverCb: ServerCallback | undefined;

  return {
    modifyRspackConfig: vi.fn((cb: ConfigCallback) => {
      configCb = cb;
    }),
    onAfterStartDevServer: vi.fn((cb: ServerCallback) => {
      serverCb = cb;
    }),
    getConfigCallback: () => configCb!,
    getServerCallback: () => serverCb!,
  };
};

describe('applyDevLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers both modifyRspackConfig and onAfterStartDevServer hooks', () => {
    const api = createMockApi();

    applyDevLogger(api as never);

    expect(api.modifyRspackConfig).toHaveBeenCalledOnce();
    expect(api.onAfterStartDevServer).toHaveBeenCalledOnce();
  });

  describe('modifyRspackConfig', () => {
    it('skips non-development mode', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const config = { mode: 'production', plugins: [] };
      const result = api.getConfigCallback()(config);

      expect(result).toBe(config);
      expect(config.plugins).toHaveLength(0);
    });

    it('derives log URL from publicPath with port offset', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const applyFn = vi.fn();
      const defineMock = vi.fn();
      const config = {
        mode: 'development',
        output: { publicPath: 'http://192.168.1.91:3000/' },
        plugins: [] as unknown[],
      };

      api.getConfigCallback()(config);

      expect(config.plugins).toHaveLength(1);

      // Simulate the plugin's apply() to verify the DefinePlugin value
      const plugin = config.plugins[0] as {
        name: string;
        apply: (compiler: unknown) => void;
      };
      expect(plugin.name).toBe('lynx:angular:dev-logger-define');

      plugin.apply({
        webpack: {
          DefinePlugin: class {
            definitions: Record<string, string>;
            constructor(definitions: Record<string, string>) {
              this.definitions = definitions;
              defineMock(definitions);
            }
            apply = applyFn;
          },
        },
      });

      expect(defineMock).toHaveBeenCalledWith({
        __DEV_LOG_URL__: JSON.stringify('http://192.168.1.91:3001/__dev_logs'),
      });
      expect(applyFn).toHaveBeenCalledOnce();
    });

    it('defaults to port 80 when publicPath has no explicit port', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const defineMock = vi.fn();
      const config = {
        mode: 'development',
        output: { publicPath: 'http://example.com/' },
        plugins: [] as unknown[],
      };

      api.getConfigCallback()(config);

      const plugin = config.plugins[0] as {
        apply: (compiler: unknown) => void;
      };
      plugin.apply({
        webpack: {
          DefinePlugin: class {
            constructor(definitions: Record<string, string>) {
              defineMock(definitions);
            }
            apply = vi.fn();
          },
        },
      });

      // port 80 + 1 = 81
      expect(defineMock).toHaveBeenCalledWith({
        __DEV_LOG_URL__: JSON.stringify('http://example.com:81/__dev_logs'),
      });
    });

    it('falls back to localhost when publicPath is not an http URL', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const defineMock = vi.fn();
      const config = {
        mode: 'development',
        output: { publicPath: '/static/' },
        plugins: [] as unknown[],
      };

      api.getConfigCallback()(config);

      const plugin = config.plugins[0] as {
        apply: (compiler: unknown) => void;
      };
      plugin.apply({
        webpack: {
          DefinePlugin: class {
            constructor(definitions: Record<string, string>) {
              defineMock(definitions);
            }
            apply = vi.fn();
          },
        },
      });

      expect(defineMock).toHaveBeenCalledWith({
        __DEV_LOG_URL__: JSON.stringify('http://localhost:3001/__dev_logs'),
      });
    });

    it('falls back to localhost when publicPath is undefined', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const defineMock = vi.fn();
      const config = {
        mode: 'development',
        plugins: [] as unknown[],
      };

      api.getConfigCallback()(config);

      const plugin = config.plugins[0] as {
        apply: (compiler: unknown) => void;
      };
      plugin.apply({
        webpack: {
          DefinePlugin: class {
            constructor(definitions: Record<string, string>) {
              defineMock(definitions);
            }
            apply = vi.fn();
          },
        },
      });

      expect(defineMock).toHaveBeenCalledWith({
        __DEV_LOG_URL__: JSON.stringify('http://localhost:3001/__dev_logs'),
      });
    });

    it('initializes plugins array when undefined', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const config = { mode: 'development' } as Record<string, unknown>;
      api.getConfigCallback()(config);

      expect(Array.isArray(config.plugins)).toBe(true);
      expect((config.plugins as unknown[]).length).toBe(1);
    });
  });

  describe('onAfterStartDevServer', () => {
    it('starts HTTP server on port + 1', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const listenMock = vi.fn();
      const onMock = vi.fn();
      vi.spyOn(http, 'createServer').mockReturnValue({
        listen: listenMock,
        on: onMock,
      } as never);

      api.getServerCallback()({ port: 4000 });

      expect(http.createServer).toHaveBeenCalledOnce();
      expect(listenMock).toHaveBeenCalledWith(
        4001,
        '0.0.0.0',
        expect.any(Function),
      );
    });

    it('logs startup message on successful listen', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const listenMock = vi.fn((_port: number, _host: string, cb: () => void) =>
        cb(),
      );
      const onMock = vi.fn();
      vi.spyOn(http, 'createServer').mockReturnValue({
        listen: listenMock,
        on: onMock,
      } as never);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      api.getServerCallback()({ port: 3000 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[dev-logger] Log server on :3001'),
      );
    });

    it('retries on next port when EADDRINUSE', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const listenMock = vi.fn();
      let errorHandler: ((err: NodeJS.ErrnoException) => void) | undefined;
      const onMock = vi.fn(
        (event: string, handler: (err: NodeJS.ErrnoException) => void) => {
          if (event === 'error') errorHandler = handler;
        },
      );

      vi.spyOn(http, 'createServer').mockReturnValue({
        listen: listenMock,
        on: onMock,
      } as never);

      api.getServerCallback()({ port: 3000 });

      // Simulate EADDRINUSE error
      const err = new Error('Address in use') as NodeJS.ErrnoException;
      err.code = 'EADDRINUSE';
      errorHandler!(err);

      // Should retry on port 3002 (3001 + 1)
      expect(listenMock).toHaveBeenCalledTimes(2);
      expect(listenMock).toHaveBeenLastCalledWith(3002, '0.0.0.0');
    });

    it('warns on non-EADDRINUSE errors', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      let errorHandler: ((err: NodeJS.ErrnoException) => void) | undefined;
      vi.spyOn(http, 'createServer').mockReturnValue({
        listen: vi.fn(),
        on: vi.fn(
          (event: string, handler: (err: NodeJS.ErrnoException) => void) => {
            if (event === 'error') errorHandler = handler;
          },
        ),
      } as never);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      api.getServerCallback()({ port: 3000 });

      const err = new Error('Permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      errorHandler!(err);

      expect(warnSpy).toHaveBeenCalledWith(
        '[dev-logger] Failed to start log server:',
        'Permission denied',
      );
    });

    it('passes unhandled requests through to 404', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      let requestHandler: (req: unknown, res: unknown) => void;
      vi.spyOn(http, 'createServer').mockImplementation((handler: unknown) => {
        requestHandler = handler as (req: unknown, res: unknown) => void;
        return { listen: vi.fn(), on: vi.fn() } as never;
      });

      // Make the middleware call next() (pass through)
      (createDevLoggerMiddleware as Mock).mockReturnValue(
        (_req: unknown, _res: unknown, next: () => void) => next(),
      );

      api.getServerCallback()({ port: 3000 });

      const mockRes = { writeHead: vi.fn(), end: vi.fn() };
      requestHandler!({}, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
    });
  });
});

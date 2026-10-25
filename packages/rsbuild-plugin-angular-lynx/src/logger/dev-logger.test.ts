import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDevLogger } from './dev-logger';
import { createDevLoggerMiddleware } from './dev-logger-middleware.js';

vi.mock('./dev-logger-middleware.js', () => ({
  createDevLoggerMiddleware: vi.fn(() => vi.fn()),
  DEV_LOGS_PATH: '/__dev_logs',
}));

type ConfigCallback = (
  config: Record<string, unknown>,
) => Record<string, unknown>;
type BeforeStartCallback = (params: {
  server: { middlewares: { use: (handler: unknown) => void } };
}) => void;
type AfterStartCallback = () => void;

const createMockApi = () => {
  let configCb: ConfigCallback | undefined;
  let beforeStartCb: BeforeStartCallback | undefined;
  let afterStartCb: AfterStartCallback | undefined;

  return {
    modifyRspackConfig: vi.fn((cb: ConfigCallback) => {
      configCb = cb;
    }),
    onBeforeStartDevServer: vi.fn((cb: BeforeStartCallback) => {
      beforeStartCb = cb;
    }),
    onAfterStartDevServer: vi.fn((cb: AfterStartCallback) => {
      afterStartCb = cb;
    }),
    getConfigCallback: () => configCb!,
    getBeforeStartCallback: () => beforeStartCb!,
    getAfterStartCallback: () => afterStartCb!,
  };
};

describe('applyDevLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('registers its config and dev server hooks', () => {
    const api = createMockApi();

    applyDevLogger(api as never);

    expect(api.modifyRspackConfig).toHaveBeenCalledOnce();
    expect(api.onBeforeStartDevServer).toHaveBeenCalledOnce();
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

    it("posts to the dev server's own origin, from publicPath", () => {
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
        __DEV_LOG_URL__: JSON.stringify('http://192.168.1.91:3000/__dev_logs'),
      });
      expect(applyFn).toHaveBeenCalledOnce();
    });

    it('keeps the origin of a publicPath without a port, or with a path', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const defineMock = vi.fn();
      const config = {
        mode: 'development',
        output: { publicPath: 'http://example.com/app/' },
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
        __DEV_LOG_URL__: JSON.stringify('http://example.com/__dev_logs'),
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
        __DEV_LOG_URL__: JSON.stringify('http://localhost:3000/__dev_logs'),
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
        __DEV_LOG_URL__: JSON.stringify('http://localhost:3000/__dev_logs'),
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

  describe('the dev server', () => {
    it('takes log entries on its own port, before its built-in middlewares', () => {
      const api = createMockApi();
      applyDevLogger(api as never);

      const use = vi.fn();
      api.getBeforeStartCallback()({ server: { middlewares: { use } } });

      expect(createDevLoggerMiddleware).toHaveBeenCalledWith(
        path.resolve(process.cwd(), '.dev-logs'),
      );
      expect(use).toHaveBeenCalledWith(
        vi.mocked(createDevLoggerMiddleware).mock.results[0]!.value,
      );
    });

    it('prints the path of the log file once it has started', () => {
      const api = createMockApi();
      applyDevLogger(api as never);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      api.getAfterStartCallback()();

      expect(consoleSpy).toHaveBeenCalledWith(
        `[dev-logger] LynxLogger output: tail -f ${path.resolve(process.cwd(), '.dev-logs')}`,
      );
    });
  });
});

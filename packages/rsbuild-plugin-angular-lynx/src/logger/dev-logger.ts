import http from 'node:http';
import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import {
  createDevLoggerMiddleware,
  getLogFilePath,
} from './dev-logger-middleware.js';

/**
 * Starts a standalone HTTP server to receive logs from on-device.
 * Also injects __DEV_LOG_URL__ at compile time so the runtime knows
 * where to POST logs (rspack's __webpack_public_path__ isn't accessible
 * as a globalThis property in Lynx's JS environment).
 *
 * Offset from the rspeedy dev server port (e.g. 3000 → 3001)
 */
const LOG_PORT_OFFSET = 1;

export const applyDevLogger = (api: RsbuildPluginAPI): void => {
  // Inject __DEV_LOG_URL__ so the on-device runtime knows where to POST.
  // At modifyRspackConfig time, output.publicPath is already resolved by
  // rspeedy to the full LAN URL (e.g. http://192.168.1.91:3000/).
  api.modifyRspackConfig((rspackConfig) => {
    if (rspackConfig.mode !== 'development') return rspackConfig;

    const publicPath = rspackConfig.output?.publicPath;

    let logUrl = '';
    if (typeof publicPath === 'string' && publicPath.startsWith('http')) {
      try {
        const parsed = new URL(publicPath);
        const logPort = Number(parsed.port || 80) + LOG_PORT_OFFSET;
        logUrl = `${parsed.protocol}//${parsed.hostname}:${logPort}/__dev_logs`;
      } catch {
        // fall through
      }
    }

    if (!logUrl) {
      // Fallback: assume localhost (won't work from device but useful for debugging)
      logUrl = `http://localhost:${3000 + LOG_PORT_OFFSET}/__dev_logs`;
    }

    rspackConfig.plugins = rspackConfig.plugins || [];
    rspackConfig.plugins.push({
      name: 'lynx:angular:dev-logger-define',
      apply(compiler: Rspack.Compiler) {
        const { DefinePlugin } = compiler.webpack;
        new DefinePlugin({
          __DEV_LOG_URL__: JSON.stringify(logUrl),
        }).apply(compiler);
      },
    });

    return rspackConfig;
  });

  // Start the log receiver server after the dev server is up.
  api.onAfterStartDevServer(({ port }) => {
    const logPort = port + LOG_PORT_OFFSET;
    const middleware = createDevLoggerMiddleware();

    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.writeHead(404);
        res.end();
      });
    });

    server.listen(logPort, '0.0.0.0', () => {
      console.log(
        `[dev-logger] Log server on :${logPort} → tail -f ${getLogFilePath()}`,
      );
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(logPort + 1, '0.0.0.0');
      } else {
        console.warn('[dev-logger] Failed to start log server:', err.message);
      }
    });
  });
};

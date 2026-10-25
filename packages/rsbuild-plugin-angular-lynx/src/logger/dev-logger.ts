import path from 'node:path';
import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import {
  createDevLoggerMiddleware,
  DEV_LOGS_PATH,
} from './dev-logger-middleware.js';

/**
 * The dev server's origin when rspeedy hasn't resolved `output.publicPath` to
 * a URL: rspeedy's default port on this computer. Only the web preview on
 * this computer reaches it, not a phone.
 */
const FALLBACK_ORIGIN = 'http://localhost:3000';

/**
 * Receives `LynxLogger` entries from the app on the dev server itself, and
 * writes them to `.dev-logs`. Also injects __DEV_LOG_URL__ at compile time so
 * the runtime knows where to POST logs (rspack's __webpack_public_path__ isn't
 * accessible as a globalThis property in Lynx's JS environment).
 *
 * The endpoint is a middleware on the dev server, at the origin the app loads
 * its bundle from, rather than a server of its own on a port next to it. The
 * phone can already reach that origin, and its port is the one rspeedy
 * resolved: a second server had to guess its port when the bundle was
 * compiled, and when that port was taken it moved to another one while the
 * app kept posting to the first, so the logs were lost.
 */
export const applyDevLogger = (api: RsbuildPluginAPI): void => {
  // At modifyRspackConfig time, output.publicPath is already resolved by
  // rspeedy to the dev server's full LAN URL (e.g. http://192.168.1.91:3000/),
  // with the port the server listens on.
  api.modifyRspackConfig((rspackConfig) => {
    if (rspackConfig.mode !== 'development') return rspackConfig;

    const publicPath = rspackConfig.output?.publicPath;
    let origin = FALLBACK_ORIGIN;
    if (typeof publicPath === 'string' && publicPath.startsWith('http')) {
      try {
        origin = new URL(publicPath).origin;
      } catch {
        // fall through
      }
    }
    const logUrl = `${origin}${DEV_LOGS_PATH}`;

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

  // Middlewares added before the dev server starts run ahead of Rsbuild's
  // own. The log file is created then, empty, rather than at the first entry:
  // `tail -f` can follow it from the start, and the path printed below exists.
  const logFilePath = path.resolve(process.cwd(), '.dev-logs');
  api.onBeforeStartDevServer(({ server }) => {
    server.middlewares.use(createDevLoggerMiddleware(logFilePath));
  });
  api.onAfterStartDevServer(() => {
    console.log(`[dev-logger] LynxLogger output: tail -f ${logFilePath}`);
  });
};

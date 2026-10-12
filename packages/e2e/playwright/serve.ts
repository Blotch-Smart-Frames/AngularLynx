import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStatic } from '../src/static-server.ts';

/**
 * Static server for the Layer 3 render tests. It serves the host page, the
 * Lynx for Web client, and the generated app's dist/ folder, all from one
 * origin so the web bundle and its lazy chunks load like they would from any
 * web server.
 */
const appDist = process.env['E2E_APP_DIST'];
const port = Number(process.env['E2E_RENDER_PORT'] ?? 3100);
if (!appDist || !existsSync(appDist)) {
  throw new Error(
    `E2E_APP_DIST must point at the app's dist folder (got ${appDist})`,
  );
}

const here = path.dirname(fileURLToPath(import.meta.url));
// web-core only exports its client entry points, so locate its prebuilt
// static folder from the exported client script.
const webCoreStatic = path.resolve(
  path.dirname(
    createRequire(import.meta.url).resolve('@lynx-js/web-core/client.prod.js'),
  ),
  '..',
);

await serveStatic(
  [
    { path: '/', file: path.join(here, 'host.html') },
    // The prebuilt client loads its worker, chunks and WebAssembly from
    // /static/ at the origin root, so it has to be served there.
    { prefix: '/static/', dir: webCoreStatic },
    { prefix: '/', dir: path.resolve(appDist) },
  ],
  { port, host: '127.0.0.1' },
);
console.log(`Serving ${appDist} on http://127.0.0.1:${port}/`);

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // WebAssembly.instantiateStreaming refuses any other content type.
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

/**
 * A minimal static file server for the render tests (Layer 3) and the native
 * tests (Layer 6). Routes are checked in order: `{ path, file }` serves one
 * file at exactly that URL path, `{ prefix, dir }` serves a directory.
 */
export const serveStatic = (
  routes: readonly (
    | { path: string; file: string }
    | { prefix: string; dir: string }
  )[],
  {
    port,
    host,
    onRequest,
  }: {
    port: number;
    host: string;
    /** Called with every request and its status, for the failure logs. */
    onRequest?: (line: string) => void;
  },
): Promise<Server> => {
  const resolveFile = (urlPath: string) => {
    for (const route of routes) {
      if ('file' in route) {
        if (urlPath === route.path) {
          return route.file;
        }
      } else if (urlPath.startsWith(route.prefix)) {
        const file = path.resolve(
          route.dir,
          decodeURIComponent(urlPath.slice(route.prefix.length)),
        );
        // Never serve anything outside the route's directory.
        return file.startsWith(route.dir + path.sep) ? file : undefined;
      }
    }
    return undefined;
  };

  const server = createServer((request, response) => {
    const file = resolveFile(
      new URL(request.url ?? '/', 'http://localhost').pathname,
    );
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      onRequest?.(`404 ${request.method} ${request.url}`);
      response.writeHead(404).end();
      return;
    }
    onRequest?.(`200 ${request.method} ${request.url}`);
    response.writeHead(200, {
      'Content-Type':
        MIME_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      // The web render tests load fixtures/http-data.json from another port
      // than the page's (see HTTP_DATA in this file).
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
};

/**
 * The JSON the counter fixture loads through HttpClient and httpResource
 * (fixtures/counter.ts), and where. The fixture's URL is fixed (in
 * fixtures/environment.e2e.ts), since Lynx has no page URL to resolve a
 * relative one against, so every layer that renders the app serves it there.
 */
export const HTTP_DATA = {
  port: 3210,
  route: {
    path: '/e2e-http.json',
    file: path.join(import.meta.dirname, '../fixtures/http-data.json'),
  },
} as const;

import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
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
 * Answers a request with every `Content-Type` header it arrived with, joined
 * with " + ", as `{ reply }`. It reads the raw headers, since Node's
 * `headers` keeps only the first of two, and Lynx's own fetch used to send
 * a second, `text/plain` one (issue #176).
 */
const echoContentTypes = (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (request.method === 'OPTIONS') {
    // The web's preflight for the counter fixture's cross-origin JSON POST.
    response
      .writeHead(204, {
        ...cors,
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
        'Access-Control-Allow-Methods': 'POST',
      })
      .end();
    return;
  }
  const types: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i]!.toLowerCase() === 'content-type') {
      types.push(request.rawHeaders[i + 1]!);
    }
  }
  // Answered once the body is in, so the client sees a complete exchange.
  request.resume().on('end', () => {
    response
      .writeHead(200, {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      })
      .end(JSON.stringify({ reply: types.join(' + ') || '(no type)' }));
  });
};

/**
 * A minimal static file server for the render tests (Layer 3) and the native
 * tests (Layer 6). Routes are checked in order: `{ path, file }` serves one
 * file at exactly that URL path, `{ prefix, dir }` serves a directory, and
 * `{ echo }` answers requests to that path with their `Content-Type`
 * headers.
 */
export const serveStatic = (
  routes: readonly (
    | { path: string; file: string }
    | { prefix: string; dir: string }
    | { echo: string }
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
      } else if ('prefix' in route && urlPath.startsWith(route.prefix)) {
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
    const urlPath = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (routes.some((route) => 'echo' in route && route.echo === urlPath)) {
      onRequest?.(`echo ${request.method} ${request.url}`);
      echoContentTypes(request, response);
      return;
    }
    const file = resolveFile(urlPath);
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
 * The JSON the counter fixture loads through HttpClient and httpResource, and
 * the echo it posts JSON to (fixtures/counter.ts), and where. The fixture's
 * URLs are fixed, since Lynx has no page URL to resolve a relative one
 * against, so every layer that renders the app serves them there.
 */
export const HTTP_DATA = {
  port: 3210,
  routes: [
    {
      path: '/e2e-http.json',
      file: path.join(import.meta.dirname, '../fixtures/http-data.json'),
    },
    { echo: '/e2e-echo' },
  ],
} as const;

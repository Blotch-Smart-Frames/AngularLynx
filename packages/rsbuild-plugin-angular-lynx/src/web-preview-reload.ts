import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * The web preview's page, as rspeedy's dev plugin serves it from
 * `@lynx-js/web-rsbuild-server-middleware`: `/__web_preview` with or without
 * a trailing slash or `index.html`, and with any query (the one that names
 * the bundle). The middleware also takes a URL that starts with `//`,
 * so this does too. web-core's scripts under the same path don't match.
 */
const WEB_PREVIEW_PAGE = /^\/{1,2}__web_preview\/?(?:index\.html)?(?:[?#]|$)/;

/** Where the reload client finds the dev server, and which builds it follows. */
export type WebPreviewReloadOptions = {
  /** The path of the dev server's WebSocket (`dev.client.path`). */
  path: string;
  /**
   * The `web` environment's WebSocket token. Rsbuild reports each
   * environment's builds only to the sockets that connect with its token.
   */
  token: string;
  /**
   * How many times to reconnect after the socket closes
   * (`dev.client.reconnect`), as Rsbuild's own client does.
   */
  reconnect: number;
};

/** A WebSocket, as far as the reload client uses one. */
type ReloadSocket = {
  addEventListener(type: 'open' | 'close', listener: () => void): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: string }) => void,
  ): void;
};

/**
 * The page's globals the reload client uses. The page passes `window`;
 * tests pass fakes.
 */
export type WebPreviewPage = {
  location: { href: string; reload(): void };
  WebSocket: new (url: string) => ReloadSocket;
  setTimeout(callback: () => void, delay: number): unknown;
  console: { error(...data: unknown[]): void };
};

/**
 * The web preview's reload client: reloads the page when a rebuild of the
 * `web` environment finishes, as Angular's own dev server reloads the browser
 * when it can't update the page in place. The preview page has no client of
 * its own, and the web bundle can't take hot updates (web-core has neither
 * the DevTool connection nor `replaceStyleSheetByIdWithBase64()` the main
 * thread's updates use), so without it every save needed a manual refresh.
 *
 * It listens on Rsbuild's dev server socket. For each build, the server sends
 * the build's hash, then `ok` or `warnings` when the build can be used, or
 * `errors` when it can't, and the page then keeps the build it has. A socket
 * that connects in the middle of a build hears nothing until the build ends
 * (Rsbuild drops its stats when a build starts), so the first hash is the
 * build the page loaded.
 *
 * The middleware writes this function's source into the page, so it uses
 * nothing from outside its body but its parameters and the page's built-ins.
 *
 * @param options - Where the dev server's socket is, and the `web`
 *   environment's token.
 * @param page - The page's globals (`window`).
 */
export const reloadOnRebuild = (
  { path, token, reconnect }: WebPreviewReloadOptions,
  page: WebPreviewPage,
): void => {
  // The hash of the build the page shows, and of the newest build reported.
  let shown: string | undefined;
  let latest: string | undefined;
  let attempts = 0;
  const reloadIfRebuilt = (): void => {
    if (latest !== shown) {
      page.location.reload();
    }
  };
  const connect = (): void => {
    // The server that serves the page, whatever host it's opened by, rather
    // than `dev.client.host`, which rspeedy sets to the computer's address on
    // the network for phones.
    const url = new URL(path, page.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token);
    const socket = new page.WebSocket(url.href);
    socket.addEventListener('open', () => {
      attempts = 0;
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data) as { type: string; data?: unknown };
      switch (message.type) {
        case 'hash':
        case 'early-update':
          latest = message.data as string;
          shown ??= latest;
          // Rsbuild 2.3 sends `early-update`, and no `ok`, when the web
          // build ends before the other environments' builds do.
          if (message.type === 'early-update') {
            reloadIfRebuilt();
          }
          break;
        case 'ok':
        case 'warnings':
          reloadIfRebuilt();
          break;
        case 'errors':
          // The terminal shows them too, but this is where someone looking
          // at the preview sees why it didn't change.
          for (const text of (message.data as { text: string[] }).text) {
            page.console.error(text);
          }
          break;
        // A change the build can't report as a hash: the entry's chunks
        // changed, an HTML file changed (Angular's external templates; the
        // bundle request then waits for the build), or a file
        // `dev.watchFiles` watches.
        case 'full-reload':
        case 'static-changed':
          page.location.reload();
          break;
      }
    });
    // The dev server restarted or stopped. Reconnecting to a restarted one
    // reports its first build, which reloads the page if it differs.
    socket.addEventListener('close', () => {
      if (attempts < reconnect) {
        attempts += 1;
        page.setTimeout(connect, 1000 * 1.5 ** attempts);
      }
    });
  };
  connect();
};

/**
 * The `<script>` the middleware adds to the preview page. The options are
 * JSON with each `<` escaped, so no value can close the script element.
 *
 * @param options - The reload client's options.
 * @returns The script element's markup.
 */
export const webPreviewReloadScript = (
  options: WebPreviewReloadOptions,
): string =>
  `<script>(${reloadOnRebuild.toString()})(${JSON.stringify(options).replaceAll('<', '\\u003c')}, window);</script>`;

/**
 * Adds the reload client to the web preview's page as rspeedy's middleware
 * sends it. That middleware answers the request itself and sets the page's
 * `Content-Length`, so this one wraps the response's `end()` to add the
 * script and set the new length, and leaves every other request alone.
 *
 * @param script - The script element to add, from
 *   {@link webPreviewReloadScript}.
 * @returns The middleware.
 */
export const createWebPreviewReloadMiddleware =
  (script: string) =>
  (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (WEB_PREVIEW_PAGE.test(req.url ?? '')) {
      const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
      res.end = ((chunk?: unknown, ...rest: unknown[]) => {
        if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
          return end(chunk, ...rest);
        }
        const html = chunk.toString();
        // In the head, so it connects before web-core's deferred scripts
        // fetch the bundle. A page without a head runs it at the end.
        const page = html.includes('</head>')
          ? html.replace('</head>', `${script}</head>`)
          : `${html}${script}`;
        if (!res.headersSent) {
          res.setHeader('Content-Length', Buffer.byteLength(page));
        }
        return end(page, ...rest);
      }) as ServerResponse['end'];
    }
    next();
  };

/**
 * Makes the web preview reload when the `web` environment rebuilds, unless
 * the environment sets `dev.liveReload: false`. Lynx Explorer and the
 * generated apps take hot updates instead (see hot-updates.ts).
 */
export const applyWebPreviewReload = (api: RsbuildPluginAPI): void => {
  api.onBeforeStartDevServer({
    // Ahead of rspeedy's own hook, whatever order the plugins are listed in:
    // middlewares run in the order they're added, and rspeedy's answers the
    // preview's requests without calling the next one.
    order: 'pre',
    handler: ({ environments, server }) => {
      const web = environments['web'];
      if (!web || web.config.dev.liveReload === false) {
        return;
      }
      server.middlewares.use(
        createWebPreviewReloadMiddleware(
          webPreviewReloadScript({
            path: web.config.dev.client.path,
            token: web.webSocketToken,
            reconnect: web.config.dev.client.reconnect,
          }),
        ),
      );
    },
  });
};

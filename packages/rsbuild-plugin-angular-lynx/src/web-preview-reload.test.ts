// cspell:words casename
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWebPreviewReload,
  createWebPreviewReloadMiddleware,
  reloadOnRebuild,
  type WebPreviewPage,
  webPreviewReloadScript,
} from './web-preview-reload.js';

/** A WebSocket the test drives: it records its URL and fires its events. */
type Listener = (event: { data: string }) => void;

class FakeSocket {
  static sockets: FakeSocket[] = [];
  readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /**
   * Fires an event: `open` and `close` carry nothing the client reads.
   */
  fire(type: string, event = { data: '' }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  /**
   * Delivers a message as the dev server sends it: JSON text.
   */
  send(message: { type: string; data?: unknown }): void {
    this.fire('message', { data: JSON.stringify(message) });
  }
}

const createPage = (href = 'http://localhost:3000/__web_preview') => {
  FakeSocket.sockets = [];
  const page = {
    location: { href, reload: vi.fn() },
    WebSocket: FakeSocket,
    setTimeout: vi.fn(),
    console: { error: vi.fn() },
  };
  return page satisfies WebPreviewPage;
};

const OPTIONS = { path: '/rsbuild-hmr', token: 'web-token', reconnect: 2 };

const lastSocket = (): FakeSocket =>
  FakeSocket.sockets[FakeSocket.sockets.length - 1]!;

describe('reloadOnRebuild', () => {
  it("connects to the socket on the page's own server, with the web environment's token", () => {
    reloadOnRebuild(
      OPTIONS,
      createPage('http://192.168.1.20:3000/__web_preview?casename=a'),
    );

    expect(lastSocket().url).toBe(
      'ws://192.168.1.20:3000/rsbuild-hmr?token=web-token',
    );
  });

  it('connects over wss from a page served over https', () => {
    reloadOnRebuild(OPTIONS, createPage('https://example.test/__web_preview'));

    expect(lastSocket().url).toBe(
      'wss://example.test/rsbuild-hmr?token=web-token',
    );
  });

  it("doesn't reload for the build the page loaded", () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);

    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    expect(page.location.reload).not.toHaveBeenCalled();
  });

  it('reloads when a new build is ready', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().send({ type: 'hash', data: 'b' });
    expect(page.location.reload).not.toHaveBeenCalled();
    lastSocket().send({ type: 'ok' });

    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it('reloads when a new build is ready with warnings', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().send({ type: 'hash', data: 'b' });
    lastSocket().send({ type: 'warnings', data: { text: ['careful'] } });

    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload for an `ok` that reports no new build", () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().send({ type: 'ok' });

    expect(page.location.reload).not.toHaveBeenCalled();
  });

  it('keeps the page when the build fails, logs why, and reloads once it is fixed', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().send({ type: 'hash', data: 'b' });
    lastSocket().send({
      type: 'errors',
      data: { text: ['first error', 'second error'], html: '' },
    });

    expect(page.location.reload).not.toHaveBeenCalled();
    expect(page.console.error).toHaveBeenNthCalledWith(1, 'first error');
    expect(page.console.error).toHaveBeenNthCalledWith(2, 'second error');

    lastSocket().send({ type: 'hash', data: 'c' });
    lastSocket().send({ type: 'ok' });

    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it('reloads on an `early-update` with a new build', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().send({ type: 'early-update', data: 'b' });

    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload on an `early-update` for the build the page loaded", () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);

    lastSocket().send({ type: 'early-update', data: 'a' });

    expect(page.location.reload).not.toHaveBeenCalled();
  });

  it.each(['full-reload', 'static-changed'])('reloads on `%s`', (type) => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);

    lastSocket().send({ type });

    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it('ignores the messages it has no use for', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });

    lastSocket().send({ type: 'resolved-client-error', data: {} });
    lastSocket().send({ type: 'custom', data: {} });

    expect(page.location.reload).not.toHaveBeenCalled();
    expect(page.console.error).not.toHaveBeenCalled();
  });

  it('reconnects after the socket closes, waiting longer each time, up to `reconnect` times', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);

    lastSocket().fire('close');
    expect(page.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      1500,
    );
    page.setTimeout.mock.lastCall![0]();
    expect(FakeSocket.sockets).toHaveLength(2);

    lastSocket().fire('close');
    expect(page.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      2250,
    );
    page.setTimeout.mock.lastCall![0]();
    expect(FakeSocket.sockets).toHaveLength(3);

    lastSocket().fire('close');
    expect(page.setTimeout).toHaveBeenCalledTimes(2);
  });

  it('starts counting again once a connection opens', () => {
    const page = createPage();
    reloadOnRebuild({ ...OPTIONS, reconnect: 1 }, page);

    lastSocket().fire('close');
    page.setTimeout.mock.lastCall![0]();
    lastSocket().fire('open');
    lastSocket().fire('close');

    expect(page.setTimeout).toHaveBeenCalledTimes(2);
    expect(page.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      1500,
    );
  });

  it('reloads when a restarted dev server reports a different build', () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().fire('close');
    page.setTimeout.mock.lastCall![0]();
    lastSocket().send({ type: 'hash', data: 'b' });
    lastSocket().send({ type: 'ok' });

    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload when a restarted dev server reports the same build", () => {
    const page = createPage();
    reloadOnRebuild(OPTIONS, page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    lastSocket().fire('close');
    page.setTimeout.mock.lastCall![0]();
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'ok' });

    expect(page.location.reload).not.toHaveBeenCalled();
  });
});

describe('webPreviewReloadScript', () => {
  it('runs the client from its own source, with the options and the page', () => {
    const script = webPreviewReloadScript(OPTIONS);
    const body = /^<script>([\s\S]*)<\/script>$/.exec(script)?.[1];
    const page = createPage();

    // A function of its own, so the client sees nothing of this module:
    // only what the page has.
    new Function('window', body!)(page);
    lastSocket().send({ type: 'hash', data: 'a' });
    lastSocket().send({ type: 'hash', data: 'b' });
    lastSocket().send({ type: 'ok' });

    expect(lastSocket().url).toBe(
      'ws://localhost:3000/rsbuild-hmr?token=web-token',
    );
    expect(page.location.reload).toHaveBeenCalledOnce();
  });

  it('escapes each `<` in the options, so none can close the script', () => {
    const script = webPreviewReloadScript({
      ...OPTIONS,
      path: '/</script><script>alert(1)//',
    });

    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(script).toContain('"/\\u003c/script>\\u003cscript>alert(1)//"');
  });
});

describe('createWebPreviewReloadMiddleware', () => {
  const PAGE =
    '<!DOCTYPE html><html><head><title>Preview</title></head><body></body></html>';
  const SCRIPT = '<script>reload()</script>';
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server!.close(resolve));
      server = undefined;
    }
  });

  /**
   * Serves requests through the middleware and then `answer`, which stands
   * in for rspeedy's preview middleware.
   */
  const serve = async (
    answer: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<string> => {
    const middleware = createWebPreviewReloadMiddleware(SCRIPT);
    server = createServer((req, res) =>
      middleware(req, res, () => answer(req, res)),
    );
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  };

  /**
   * Answers as rspeedy's middleware does: the length, then the page.
   */
  const answerWith =
    (body: string | Buffer) => (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(body);
    };

  it.each([
    '/__web_preview?casename=main.web.bundle',
    '/__web_preview',
    '/__web_preview/',
    '/__web_preview/index.html',
    '//__web_preview?casename=main.web.bundle',
  ])('adds the script to the page at %s, with its new length', async (url) => {
    const origin = await serve(answerWith(PAGE));

    const response = await fetch(`${origin}${url}`);
    const body = await response.text();

    expect(body).toBe(
      '<!DOCTYPE html><html><head><title>Preview</title><script>reload()</script></head><body></body></html>',
    );
    expect(response.headers.get('content-length')).toBe(
      String(Buffer.byteLength(body)),
    );
  });

  it('adds the script to a page sent as a buffer', async () => {
    const origin = await serve(answerWith(Buffer.from(PAGE)));

    const body = await (await fetch(`${origin}/__web_preview`)).text();

    expect(body).toContain('<script>reload()</script></head>');
  });

  it('adds the script at the end of a page without a head', async () => {
    const origin = await serve(answerWith('<p>Preview</p>'));

    const body = await (await fetch(`${origin}/__web_preview`)).text();

    expect(body).toBe('<p>Preview</p><script>reload()</script>');
  });

  it.each([
    '/__web_preview/static/js/index.js',
    '/__web_preview_other',
    '/main.web.bundle',
  ])('leaves %s as it is', async (url) => {
    const origin = await serve(answerWith(PAGE));

    const body = await (await fetch(`${origin}${url}`)).text();

    expect(body).toBe(PAGE);
  });

  it('passes on an end() without a body', async () => {
    const origin = await serve((_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.write(PAGE);
      res.end();
    });

    const body = await (await fetch(`${origin}/__web_preview`)).text();

    expect(body).toBe(PAGE);
  });

  it("doesn't set the length of a response whose headers are already sent", async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });

    const response = await fetch(`${origin}/__web_preview`);

    expect(await response.text()).toContain('<script>reload()</script></head>');
  });

  it('calls the next middleware for a request without a URL', () => {
    const next = vi.fn();
    const end = vi.fn();
    const res = { end };

    createWebPreviewReloadMiddleware(SCRIPT)({} as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.end).toBe(end);
  });
});

describe('applyWebPreviewReload', () => {
  type Handler = (params: {
    environments: Record<string, unknown>;
    server: { middlewares: { use: (middleware: unknown) => void } };
  }) => void;

  const webEnvironment = (dev: Record<string, unknown> = {}) => ({
    webSocketToken: 'web-token',
    config: {
      dev: {
        liveReload: true,
        client: { path: '/rsbuild-hmr', reconnect: 100 },
        ...dev,
      },
    },
  });

  const setUp = (environments: Record<string, unknown>) => {
    const onBeforeStartDevServer = vi.fn();
    applyWebPreviewReload({
      onBeforeStartDevServer,
      modifyEnvironmentConfig: vi.fn(),
    } as never);
    const { handler, order } = onBeforeStartDevServer.mock.calls[0][0] as {
      handler: Handler;
      order: string;
    };
    const use = vi.fn();
    handler({ environments, server: { middlewares: { use } } });
    return { order, use };
  };

  it("adds its middleware ahead of rspeedy's", () => {
    expect(setUp({ web: webEnvironment() }).order).toBe('pre');
  });

  it("gives the page a client that follows the web environment's builds", async () => {
    const { use } = setUp({ web: webEnvironment() });

    expect(use).toHaveBeenCalledOnce();
    const middleware = use.mock.calls[0][0] as ReturnType<
      typeof createWebPreviewReloadMiddleware
    >;
    const end = vi.fn();
    const res = { headersSent: true, end };
    middleware(
      { url: '/__web_preview' } as never,
      res as never,
      () => undefined,
    );
    res.end('<head></head>');

    expect(end).toHaveBeenCalledWith(
      `<head>${webPreviewReloadScript({ path: '/rsbuild-hmr', token: 'web-token', reconnect: 100 })}</head>`,
    );
  });

  it('does nothing without a web environment', () => {
    expect(setUp({ lynx: {} }).use).not.toHaveBeenCalled();
  });

  it('does nothing when the web environment turns live reload off', () => {
    expect(
      setUp({ web: webEnvironment({ liveReload: false }) }).use,
    ).not.toHaveBeenCalled();
  });

  it('adds the client when live reload is set as an object', () => {
    expect(
      setUp({ web: webEnvironment({ liveReload: { html: false } }) }).use,
    ).toHaveBeenCalledOnce();
  });

  describe("the web environment's live reload", () => {
    type Modify = (
      config: { dev?: Record<string, unknown> },
      utils: { name: string },
    ) => unknown;

    const modify = (): Modify => {
      const modifyEnvironmentConfig = vi.fn();
      applyWebPreviewReload({
        onBeforeStartDevServer: vi.fn(),
        modifyEnvironmentConfig,
      } as never);
      return modifyEnvironmentConfig.mock.calls[0][0] as Modify;
    };

    it("stops Rsbuild's reload when an .html file starts a rebuild, and keeps the rest", () => {
      const config = { dev: { liveReload: true, hmr: true } };

      expect(modify()(config, { name: 'web' })).toEqual({
        dev: { liveReload: { html: false }, hmr: true },
      });
    });

    it('does the same when the config leaves live reload unset', () => {
      expect(modify()({}, { name: 'web' })).toEqual({
        dev: { liveReload: { html: false } },
      });
    });

    it('does the same when the app sets `{ html: true }`, which means the same as the default', () => {
      const config = { dev: { liveReload: { html: true } } };

      expect(modify()(config, { name: 'web' })).toEqual({
        dev: { liveReload: { html: false } },
      });
    });

    it('keeps `false`, which turns the client off', () => {
      const config = { dev: { liveReload: false } };

      expect(modify()(config, { name: 'web' })).toBe(config);
    });

    it('leaves the Lynx environment alone', () => {
      const config = { dev: { liveReload: true } };

      expect(modify()(config, { name: 'lynx' })).toBe(config);
    });
  });
});

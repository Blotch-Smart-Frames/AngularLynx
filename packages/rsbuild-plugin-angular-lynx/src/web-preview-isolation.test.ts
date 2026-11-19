import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  applyWebPreviewIsolation,
  createWebPreviewIsolationMiddleware,
  supportsCredentialless,
} from './web-preview-isolation';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

describe('supportsCredentialless', () => {
  it.each([
    ['Chrome', CHROME],
    [
      'Chrome 96, the first with it',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36',
    ],
    [
      'headless Chrome, which Playwright drives',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
    ],
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    ],
    [
      'Chromium',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/120.0.0.0 Safari/537.36',
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Firefox',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
    ],
    [
      'Firefox 119, the first with it',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
    ],
  ])('is true for %s', (_browser, userAgent) => {
    expect(supportsCredentialless(userAgent)).toBe(true);
  });

  it.each([
    ['Safari', SAFARI],
    [
      'Safari on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ],
    [
      'Chrome on an iPhone, which is WebKit',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    ],
    [
      'Firefox on an iPhone, which is WebKit',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
    ],
    [
      'Chrome 95',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
    ],
    [
      'Firefox 118',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0',
    ],
    [
      'Firefox on Android',
      'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
    ],
    [
      'Opera on Android',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 OPR/86.0.0',
    ],
    ['a client that is no browser', 'curl/8.7.1'],
    ['an empty user agent', ''],
    ['no user agent', undefined],
  ])('is false for %s', (_browser, userAgent) => {
    expect(supportsCredentialless(userAgent)).toBe(false);
  });
});

/**
 * A response that records its headers, as the dev server's does.
 */
const makeResponse = () => {
  const headers = new Map<string, unknown>();
  const res = {
    setHeader: (name: string, value: unknown) => {
      headers.set(name, value);
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, headers };
};

const makeRequest = (url: string | undefined, userAgent?: string) =>
  ({
    url,
    headers: userAgent === undefined ? {} : { 'user-agent': userAgent },
  }) as IncomingMessage;

/**
 * Runs the middleware, then sets the headers rspeedy's preview middleware
 * sets, as it does further down the chain.
 */
const servePreview = (url: string | undefined, userAgent?: string) => {
  const { res, headers } = makeResponse();
  const next = vi.fn(() => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  });
  createWebPreviewIsolationMiddleware()(makeRequest(url, userAgent), res, next);
  return { headers, next };
};

describe('createWebPreviewIsolationMiddleware', () => {
  it.each([
    ['the page', '/__web_preview?casename=main.web.bundle'],
    ['the page without a query', '/__web_preview'],
    ["web-core's scripts", '/__web_preview/static/js/index.js'],
    ['a doubled slash, which rspeedy serves too', '//__web_preview/'],
  ])(
    'isolates %s with credentialless for a browser that supports it',
    (_what, url) => {
      const { headers, next } = servePreview(url, CHROME);

      expect(next).toHaveBeenCalledOnce();
      expect(headers.get('Cross-Origin-Embedder-Policy')).toBe(
        'credentialless',
      );
      // The rest of what rspeedy sends is untouched.
      expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
      expect(headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    },
  );

  it("keeps require-corp for a browser that doesn't know credentialless", () => {
    const { headers, next } = servePreview(
      '/__web_preview?casename=main.web.bundle',
      SAFARI,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('keeps require-corp for a request without a user agent', () => {
    const { headers } = servePreview('/__web_preview');

    expect(headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it.each([
    ['the bundle', '/main.web.bundle'],
    ['a path that only starts like it', '/__web_preview_other'],
    ['a request without a URL', undefined],
  ])("leaves %s, which isn't the preview's, alone", (_what, url) => {
    const { headers, next } = servePreview(url, CHROME);

    expect(next).toHaveBeenCalledOnce();
    expect(headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it("doesn't isolate a response rspeedy didn't", () => {
    const { res, headers } = makeResponse();
    createWebPreviewIsolationMiddleware()(
      makeRequest('/__web_preview', CHROME),
      res,
      () => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      },
    );

    expect([...headers.keys()]).toEqual(['Content-Type']);
  });

  it('leaves another embedder policy as it is', () => {
    const { res, headers } = makeResponse();
    createWebPreviewIsolationMiddleware()(
      makeRequest('/__web_preview', CHROME),
      res,
      () => {
        res.setHeader('cross-origin-embedder-policy', 'unsafe-none');
      },
    );

    expect(headers.get('cross-origin-embedder-policy')).toBe('unsafe-none');
  });
});

type BeforeStartHook = {
  order: string;
  handler: (params: {
    environments: Record<string, unknown>;
    server: { middlewares: { use: (handler: unknown) => void } };
  }) => void;
};

describe('applyWebPreviewIsolation', () => {
  const setUp = () => {
    let hook: BeforeStartHook | undefined;
    const api = {
      onBeforeStartDevServer: vi.fn((descriptor: BeforeStartHook) => {
        hook = descriptor;
      }),
    };
    applyWebPreviewIsolation(api as never);
    return { hook: hook!, use: vi.fn() };
  };

  it("adds its middleware ahead of rspeedy's, which ends the response", () => {
    const { hook, use } = setUp();

    expect(hook.order).toBe('pre');
    hook.handler({
      environments: { lynx: {}, web: {} },
      server: { middlewares: { use } },
    });

    expect(use).toHaveBeenCalledOnce();
    expect(typeof use.mock.calls[0]?.[0]).toBe('function');
  });

  it('adds nothing without a web environment, which has no preview', () => {
    const { hook, use } = setUp();

    hook.handler({
      environments: { lynx: {} },
      server: { middlewares: { use } },
    });

    expect(use).not.toHaveBeenCalled();
  });
});

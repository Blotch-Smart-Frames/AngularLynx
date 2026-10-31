import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortFetchForMainThread,
  fetchForMainThread,
  type RelayedRequest,
} from './background-fetch';

const request = (overrides: Partial<RelayedRequest> = {}): RelayedRequest => ({
  url: 'https://example.com/data',
  method: 'GET',
  headers: [],
  body: null,
  options: {},
  ...overrides,
});

/**
 * A stand-in for Lynx's background `fetch`, answering with `response`.
 */
const stubFetch = (response: Partial<Response> & { headers?: Headers }) => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit): Promise<Response> =>
      ({
        status: 200,
        statusText: 'OK',
        url: '',
        headers: new Headers(),
        text: async () => 'text body',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        ...response,
      }) as Response,
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('fetchForMainThread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects when the thread has no fetch', async () => {
    vi.stubGlobal('fetch', undefined);
    await expect(fetchForMainThread(1, request())).rejects.toThrow(TypeError);
  });

  it('sends the method, headers, options and a signal', async () => {
    const fetch = stubFetch({});
    await fetchForMainThread(
      1,
      request({
        method: 'PUT',
        headers: [['x-a', '1']],
        body: { text: '{"a":1}' },
        options: { credentials: 'include' },
      }),
    );

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://example.com/data');
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'X-A': '1' },
      body: '{"a":1}',
      credentials: 'include',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends header names in canonical case, since Lynx's Request looks for `Content-Type` by its exact spelling", async () => {
    const fetch = stubFetch({});
    await fetchForMainThread(
      1,
      request({
        method: 'POST',
        // As the main thread's Headers lists them: lowercase.
        headers: [
          ['authorization', 'Bearer t'],
          ['content-type', 'application/json'],
          ['x-api-key', 'k'],
          ['x-ms-client-request-id', 'id'],
        ],
        body: { text: '{}' },
      }),
    );

    // Each name once, so Lynx adds no text/plain type of its own beside it.
    expect(fetch.mock.calls[0]![1].headers).toEqual({
      Authorization: 'Bearer t',
      'Content-Type': 'application/json',
      'X-Api-Key': 'k',
      'X-Ms-Client-Request-Id': 'id',
    });
  });

  it('sends a base64 body as an ArrayBuffer holding only the body', async () => {
    const fetch = stubFetch({});
    await fetchForMainThread(
      1,
      request({ method: 'POST', body: { base64: 'AQL6' } }),
    );

    const body = fetch.mock.calls[0]![1].body as ArrayBuffer;
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(body)]).toEqual([1, 2, 250]);
  });

  it('sends a UTF-8 textual body back as text', async () => {
    for (const type of [
      'application/json',
      'application/problem+json; charset=utf-8',
      'text/html;charset="UTF-8"',
      'application/xml',
    ]) {
      stubFetch({ headers: new Headers({ 'content-type': type }) });
      const response = await fetchForMainThread(1, request());
      expect(response.body).toEqual({ text: 'text body' });
    }
  });

  it("reads the response's type whatever case its name is in, since Lynx's get() matches names by exact spelling", async () => {
    for (const name of ['Content-Type', 'content-type']) {
      // Lynx's Headers through 4.2: a Map keyed by the name as given.
      const entries = new Map([[name, 'application/json']]);
      stubFetch({
        headers: {
          forEach: (callback: (value: string, name: string) => void) =>
            entries.forEach(callback),
          get: (key: string) => entries.get(key) ?? null,
        } as unknown as Headers,
      });
      const response = await fetchForMainThread(1, request());
      expect(response.body).toEqual({ text: 'text body' });
    }
  });

  it('sends other bodies back as base64', async () => {
    for (const headers of [
      new Headers({ 'content-type': 'image/png' }),
      new Headers({ 'content-type': 'text/plain; charset=iso-8859-1' }),
      new Headers(),
    ]) {
      stubFetch({ headers });
      const response = await fetchForMainThread(1, request());
      expect(response.body).toEqual({
        base64: Buffer.from([1, 2, 3]).toString('base64'),
      });
    }
  });

  it('sends no body for a status that has none', async () => {
    stubFetch({ status: 204, headers: new Headers({ 'x-a': '1' }) });
    const response = await fetchForMainThread(1, request());
    expect(response.body).toBeNull();
  });

  it('sends back the status, headers, url and redirect', async () => {
    stubFetch({
      status: 404,
      statusText: 'Not Found',
      url: 'https://example.com/moved',
      redirected: true,
      headers: new Headers({ 'X-A': '1', 'content-type': 'text/plain' }),
    });
    const response = await fetchForMainThread(1, request());
    expect(response).toEqual({
      status: 404,
      statusText: 'Not Found',
      url: 'https://example.com/moved',
      redirected: true,
      headers: [
        ['content-type', 'text/plain'],
        ['x-a', '1'],
      ],
      body: { text: 'text body' },
    });
  });

  it("falls back to the request's URL, and to not redirected, where Lynx leaves them out", async () => {
    stubFetch({ redirected: undefined });
    const response = await fetchForMainThread(1, request());
    expect(response.url).toBe('https://example.com/data');
    expect(response.redirected).toBe(false);
  });

  it("rejects Lynx's 499 failure response with its status text, as fetch rejects a failed request", async () => {
    stubFetch({ status: 499, statusText: 'Could not connect to the server.' });
    await expect(fetchForMainThread(1, request())).rejects.toThrow(
      new TypeError('Could not connect to the server.'),
    );
    stubFetch({ status: 499, statusText: '' });
    await expect(fetchForMainThread(1, request())).rejects.toThrow(
      'Network request failed',
    );
  });

  it('keeps a 499 that a server sent, which has headers', async () => {
    stubFetch({ status: 499, headers: new Headers({ server: 'nginx' }) });
    const response = await fetchForMainThread(1, request());
    expect(response.status).toBe(499);
  });

  it('rejects when the fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await expect(fetchForMainThread(1, request())).rejects.toThrow('offline');
  });
});

describe('abortFetchForMainThread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts the request in flight with that ID', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal = init.signal!;
            signal.addEventListener('abort', () => reject(signal!.reason));
          }),
      ),
    );
    const pending = fetchForMainThread(7, request());
    abortFetchForMainThread(8);
    expect(signal!.aborted).toBe(false);
    abortFetchForMainThread(7);
    expect(signal!.aborted).toBe(true);
    await expect(pending).rejects.toBeDefined();
    // Done, so there's nothing left to abort.
    abortFetchForMainThread(7);
  });
});

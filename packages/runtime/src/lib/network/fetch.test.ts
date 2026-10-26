import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callOnBackground } from '../background-call';
import type { RelayedResponse } from './background-fetch';
import { LynxRequest, LynxResponse, relayFetch } from './fetch';
import { LynxHeaders } from './headers';

vi.mock('../background-call', () => ({ callOnBackground: vi.fn() }));

const call = vi.mocked(callOnBackground);

const URL_ = 'https://example.com/data';

const relayed = (
  overrides: Partial<RelayedResponse> = {},
): RelayedResponse => ({
  status: 200,
  statusText: 'OK',
  url: URL_,
  redirected: false,
  headers: [['content-type', 'application/json']],
  body: { text: '{"a":1}' },
  ...overrides,
});

const bytesOf = (text: string) => [...new TextEncoder().encode(text)];

describe('LynxRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to a GET with no body and the standard options', () => {
    const request = new LynxRequest(URL_);
    expect(request.url).toBe(URL_);
    expect(request.method).toBe('GET');
    expect(request.body).toBeNull();
    expect(request.signal.aborted).toBe(false);
    expect(request.destination).toBe('');
    expect(request.toRelayed()).toEqual({
      url: URL_,
      method: 'GET',
      headers: [],
      body: null,
      options: {},
    });
  });

  it('serializes the URL, from a string or a URL', () => {
    expect(new LynxRequest('https://EXAMPLE.com').url).toBe(
      'https://example.com/',
    );
    expect(new LynxRequest(new URL(URL_)).url).toBe(URL_);
  });

  it('rejects a relative URL, since Lynx has no page URL to resolve it against', () => {
    expect(() => new LynxRequest('/api/data')).toThrow(
      /Failed to parse URL from \/api\/data\. Lynx has no page URL/,
    );
  });

  it('uppercases the standard methods only, as the Fetch Standard does', () => {
    expect(new LynxRequest(URL_, { method: 'post' }).method).toBe('POST');
    expect(new LynxRequest(URL_, { method: 'patch' }).method).toBe('patch');
  });

  it('refuses a body on a GET or HEAD', () => {
    expect(() => new LynxRequest(URL_, { body: 'x' })).toThrow(TypeError);
    expect(() => new LynxRequest(URL_, { method: 'head', body: 'x' })).toThrow(
      TypeError,
    );
  });

  it('sends a string as text, typed as plain text unless a type is set', () => {
    const request = new LynxRequest(URL_, { method: 'POST', body: 'hi' });
    expect(request.headers.get('content-type')).toBe(
      'text/plain;charset=UTF-8',
    );
    expect(request.toRelayed().body).toEqual({ text: 'hi' });

    const json = new LynxRequest(URL_, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(json.headers.get('content-type')).toBe('application/json');
  });

  it('sends URLSearchParams as a form', () => {
    const request = new LynxRequest(URL_, {
      method: 'POST',
      body: new URLSearchParams({ a: '1', b: 'x y' }),
    });
    expect(request.headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
    expect(request.toRelayed().body).toEqual({ text: 'a=1&b=x+y' });
  });

  it('sends a copy of an ArrayBuffer or a view as base64, with no type', async () => {
    const buffer = new Uint8Array([1, 2, 250]).buffer;
    const fromBuffer = new LynxRequest(URL_, { method: 'POST', body: buffer });
    new Uint8Array(buffer)[0] = 9;
    expect(fromBuffer.headers.has('content-type')).toBe(false);
    expect(fromBuffer.toRelayed().body).toEqual({ base64: 'AQL6' });

    const view = new Uint8Array([7, 1, 2, 250, 7]).subarray(1, 4);
    const fromView = new LynxRequest(URL_, { method: 'POST', body: view });
    expect([...new Uint8Array(await fromView.arrayBuffer())]).toEqual([
      1, 2, 250,
    ]);
  });

  it("refuses Blob, FormData and stream bodies, which can't reach the background thread", () => {
    for (const body of [
      new Blob(['x']),
      new FormData(),
      new ReadableStream(),
      { getReader: () => ({}) },
    ]) {
      expect(() => new LynxRequest(URL_, { method: 'POST', body })).toThrow(
        /request bodies aren't supported on Lynx/,
      );
    }
  });

  it('checks body types only against globals that exist', () => {
    vi.stubGlobal('URLSearchParams', undefined);
    vi.stubGlobal('Blob', undefined);
    const request = new LynxRequest(URL_, { method: 'POST', body: { a: 1 } });
    expect(request.toRelayed().body).toEqual({ text: '[object Object]' });
  });

  it('copies another request, letting init override it', async () => {
    const controller = new AbortController();
    const original = new LynxRequest(URL_, {
      method: 'POST',
      body: 'hi',
      headers: { 'x-a': '1' },
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
      integrity: 'sha256-x',
      keepalive: true,
      mode: 'no-cors',
      priority: 'high',
      redirect: 'manual',
      referrer: '',
      referrerPolicy: 'no-referrer',
    });
    const copy = new LynxRequest(original);
    expect(copy.url).toBe(URL_);
    expect(copy.method).toBe('POST');
    expect(copy.headers.get('x-a')).toBe('1');
    expect(copy.signal).toBe(controller.signal);
    expect(await copy.text()).toBe('hi');
    expect(copy.toRelayed().options).toEqual({
      cache: 'no-store',
      credentials: 'include',
      integrity: 'sha256-x',
      keepalive: true,
      mode: 'no-cors',
      priority: 'high',
      redirect: 'manual',
      referrer: '',
      referrerPolicy: 'no-referrer',
    });

    const changed = new LynxRequest(original, {
      method: 'PUT',
      body: 'other',
      credentials: 'omit',
    });
    expect(changed.method).toBe('PUT');
    expect(await changed.text()).toBe('other');
    expect(changed.credentials).toBe('omit');
  });

  it('clones with its own body, and refuses once the body is read', async () => {
    const request = new LynxRequest(URL_, { method: 'POST', body: 'hi' });
    const clone = request.clone();
    expect(await clone.text()).toBe('hi');
    expect(await request.text()).toBe('hi');
    expect(() => request.clone()).toThrow(TypeError);
  });
});

describe('LynxResponse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to an empty 200', async () => {
    const response = new LynxResponse();
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.statusText).toBe('');
    expect(response.type).toBe('default');
    expect(response.url).toBe('');
    expect(response.redirected).toBe(false);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('reports ok for 2xx only', () => {
    expect(new LynxResponse(null, { status: 299 }).ok).toBe(true);
    expect(new LynxResponse(null, { status: 300 }).ok).toBe(false);
  });

  it('refuses a status outside 200 to 599', () => {
    for (const status of [199, 600, 200.5]) {
      expect(() => new LynxResponse(null, { status })).toThrow(RangeError);
    }
  });

  it('reads the body once, as text, JSON, bytes or an ArrayBuffer', async () => {
    const response = new LynxResponse('{"a":"✓"}', {
      headers: { 'content-type': 'application/json' },
    });
    expect(response.bodyUsed).toBe(false);
    expect(await response.clone().json()).toEqual({ a: '✓' });
    expect(await response.clone().bytes()).toEqual(
      new Uint8Array(bytesOf('{"a":"✓"}')),
    );
    expect(new TextDecoder().decode(await response.clone().arrayBuffer())).toBe(
      '{"a":"✓"}',
    );
    expect(await response.text()).toBe('{"a":"✓"}');
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toThrow(TypeError);
  });

  it('decodes a bytes body as UTF-8 for text()', async () => {
    const response = new LynxResponse(new TextEncoder().encode('é ✓'));
    expect(await response.text()).toBe('é ✓');
  });

  it("makes a Blob where there's a Blob, with the body's type", async () => {
    const response = new LynxResponse('hi', {
      headers: { 'content-type': 'text/x-test' },
    });
    const blob = await response.blob();
    expect(blob.type).toBe('text/x-test');
    expect(await blob.text()).toBe('hi');

    const untyped = new LynxResponse(new Uint8Array([1]));
    expect((await untyped.blob()).type).toBe('');
  });

  it('refuses blob() and formData() where Lynx has no Blob or FormData', async () => {
    vi.stubGlobal('Blob', undefined);
    await expect(new LynxResponse('x').blob()).rejects.toThrow(
      /Lynx has no Blob/,
    );
    await expect(new LynxResponse('x').formData()).rejects.toThrow(
      /Lynx has no FormData/,
    );
  });

  describe('body', () => {
    it('yields the body as one chunk, then ends, and marks the body used', async () => {
      const response = new LynxResponse('hi');
      const stream = response.body!;
      expect(response.body).toBe(stream);
      const reader = stream.getReader();
      expect(response.bodyUsed).toBe(true);
      expect(stream.locked).toBe(true);
      expect(await reader.read()).toEqual({
        done: false,
        value: new Uint8Array(bytesOf('hi')),
      });
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      await expect(reader.closed).resolves.toBeUndefined();
    });

    it('ends at once for an empty body', async () => {
      const reader = new LynxResponse('').body!.getReader();
      expect(await reader.read()).toEqual({ done: true, value: undefined });
    });

    it('allows one reader at a time', async () => {
      const stream = new LynxResponse('hi').body!;
      const reader = stream.getReader();
      expect(() => stream.getReader()).toThrow(TypeError);
      reader.releaseLock();
      expect(stream.locked).toBe(false);
      await expect(reader.read()).rejects.toThrow('released');
      expect((await stream.getReader().read()).done).toBe(false);
    });

    it('drops the body when the reader or the stream is canceled', async () => {
      const response = new LynxResponse('hi');
      const reader = response.body!.getReader();
      await reader.cancel();
      expect((await reader.read()).done).toBe(true);

      const other = new LynxResponse('hi');
      await other.body!.cancel();
      expect(other.bodyUsed).toBe(true);
      expect((await other.body!.getReader().read()).done).toBe(true);
    });

    it('can be read with for await', async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of new LynxResponse('hi').body!) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([new Uint8Array(bytesOf('hi'))]);
    });
  });

  it('clones the status, headers, details and body, and refuses once the body is read', async () => {
    const response = LynxResponse.fromRelayed(
      relayed({ status: 201, redirected: true }),
    );
    const clone = response.clone();
    expect(clone.status).toBe(201);
    expect(clone.statusText).toBe('OK');
    expect(clone.headers.get('content-type')).toBe('application/json');
    expect(clone.url).toBe(URL_);
    expect(clone.redirected).toBe(true);
    expect(clone.type).toBe('basic');
    expect(await clone.json()).toEqual({ a: 1 });
    expect(await response.json()).toEqual({ a: 1 });
    expect(() => response.clone()).toThrow(TypeError);
  });

  it('makes a network error with error()', () => {
    const response = LynxResponse.error();
    expect(response.status).toBe(0);
    expect(response.type).toBe('error');
    expect(response.ok).toBe(false);
  });

  it('makes a JSON response with json(), keeping a given type', async () => {
    const response = LynxResponse.json({ a: 1 }, { status: 201 });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ a: 1 });
    expect(
      LynxResponse.json(1, {
        headers: { 'content-type': 'application/x-test' },
      }).headers.get('content-type'),
    ).toBe('application/x-test');
    expect(LynxResponse.json(null).status).toBe(200);
  });

  it('makes a redirect with redirect(), for redirect statuses only', () => {
    const response = LynxResponse.redirect('https://example.com/next', 307);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/next');
    expect(LynxResponse.redirect(URL_).status).toBe(302);
    expect(() => LynxResponse.redirect(URL_, 200)).toThrow(RangeError);
  });

  it('builds the response the background thread sent, from text, base64 or no body', async () => {
    const text = LynxResponse.fromRelayed(relayed());
    expect(text.status).toBe(200);
    expect(text.headers).toBeInstanceOf(LynxHeaders);
    expect(await text.json()).toEqual({ a: 1 });

    const bytes = LynxResponse.fromRelayed(
      relayed({ body: { base64: 'AQL6' } }),
    );
    expect([...(await bytes.bytes())]).toEqual([1, 2, 250]);
    // The relayed body isn't typed again: the headers say what it is.
    expect(bytes.headers.get('content-type')).toBe('application/json');

    const empty = LynxResponse.fromRelayed(
      relayed({ status: 204, body: null }),
    );
    expect(empty.body).toBeNull();
  });
});

describe('relayFetch', () => {
  beforeEach(() => {
    call.mockReset();
  });

  it('runs the request on the background thread and resolves with its response', async () => {
    call.mockResolvedValueOnce(relayed());
    const response = await relayFetch(URL_, {
      method: 'POST',
      body: 'hi',
    });

    expect(call).toHaveBeenCalledWith('fetch', expect.any(Number), {
      url: URL_,
      method: 'POST',
      headers: [['content-type', 'text/plain;charset=UTF-8']],
      body: { text: 'hi' },
      options: {},
    });
    expect(response).toBeInstanceOf(LynxResponse);
    expect(await response.json()).toEqual({ a: 1 });
  });

  it('gives each request its own ID', async () => {
    call.mockResolvedValue(relayed());
    await relayFetch(URL_);
    await relayFetch(URL_);
    const [first, second] = call.mock.calls.map(([, id]) => id);
    expect(second).not.toBe(first);
  });

  it('rejects with a TypeError when the request fails', async () => {
    call.mockRejectedValueOnce(new Error('Could not connect to the server.'));
    await expect(relayFetch(URL_)).rejects.toThrow(
      new TypeError('Could not connect to the server.'),
    );
  });

  it('rejects an invalid request without sending it', async () => {
    await expect(relayFetch('/relative')).rejects.toThrow(TypeError);
    expect(call).not.toHaveBeenCalled();
  });

  it('rejects with the reason of a signal that has already aborted', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    await expect(relayFetch(URL_, { signal: controller.signal })).rejects.toBe(
      'stop',
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('rejects when the signal aborts, and aborts the background request', async () => {
    let answer!: (value: RelayedResponse) => void;
    call.mockImplementation((name) =>
      name === 'fetch'
        ? new Promise((resolve) => (answer = resolve as never))
        : Promise.reject(new Error('no background thread')),
    );
    const controller = new AbortController();
    const pending = relayFetch(URL_, { signal: controller.signal });
    controller.abort('stop');

    await expect(pending).rejects.toBe('stop');
    const id = call.mock.calls[0]![1];
    expect(call).toHaveBeenCalledWith('abortFetch', id);
    // The background thread's answer comes too late to matter.
    answer(relayed());
  });

  it('ignores an abort after the response has arrived', async () => {
    call.mockResolvedValueOnce(relayed());
    const controller = new AbortController();
    await relayFetch(URL_, { signal: controller.signal });
    controller.abort();
    expect(call).toHaveBeenCalledTimes(1);
  });
});

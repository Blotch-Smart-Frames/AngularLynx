import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxResponse } from './fetch';
import { LynxHeaders } from './headers';
import { LynxXMLHttpRequest, type XhrEvent } from './xhr';

const URL_ = 'https://example.com/data';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A stand-in for the thread's fetch, answering with `response`.
 */
const stubFetch = (
  response: () => Promise<Response> | Response = () =>
    new LynxResponse('{"a":1}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json', 'x-a': '1' },
    }) as unknown as Response,
) => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit): Promise<Response> => response(),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

/**
 * Records every event the request and its upload fire, in order.
 */
const record = (xhr: LynxXMLHttpRequest) => {
  const events: string[] = [];
  for (const type of [
    'readystatechange',
    'loadstart',
    'progress',
    'load',
    'error',
    'abort',
    'timeout',
    'loadend',
  ]) {
    xhr.addEventListener(type, (event: XhrEvent) =>
      events.push(
        type === 'readystatechange'
          ? `${type}:${xhr.readyState}`
          : `${type}:${event.loaded}/${event.total}`,
      ),
    );
    xhr.upload.addEventListener(type, (event: XhrEvent) =>
      events.push(`upload.${type}:${event.loaded}/${event.total}`),
    );
  }
  return events;
};

describe('LynxXMLHttpRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('has the readyState constants on the class and the instance', () => {
    const xhr = new LynxXMLHttpRequest();
    expect([
      LynxXMLHttpRequest.UNSENT,
      LynxXMLHttpRequest.OPENED,
      LynxXMLHttpRequest.HEADERS_RECEIVED,
      LynxXMLHttpRequest.LOADING,
      LynxXMLHttpRequest.DONE,
    ]).toEqual([0, 1, 2, 3, 4]);
    expect([
      xhr.UNSENT,
      xhr.OPENED,
      xhr.HEADERS_RECEIVED,
      xhr.LOADING,
      xhr.DONE,
    ]).toEqual([0, 1, 2, 3, 4]);
    expect(xhr.readyState).toBe(0);
  });

  it('refuses synchronous requests', () => {
    expect(() => new LynxXMLHttpRequest().open('GET', URL_, false)).toThrow(
      expect.objectContaining({ name: 'InvalidAccessError' }),
    );
  });

  it('refuses headers and sending before open() and while sending', () => {
    stubFetch();
    const xhr = new LynxXMLHttpRequest();
    expect(() => xhr.setRequestHeader('a', '1')).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
    expect(() => xhr.send()).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
    xhr.open('GET', URL_);
    xhr.send();
    expect(() => xhr.send()).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
  });

  it('loads a response, firing the events in the order browsers do', async () => {
    const fetch = stubFetch();
    const xhr = new LynxXMLHttpRequest();
    const events = record(xhr);
    xhr.open('GET', new URL(URL_));
    xhr.setRequestHeader('X-B', '2');
    expect(xhr.getResponseHeader('x-a')).toBeNull();
    expect(xhr.getAllResponseHeaders()).toBe('');
    xhr.send();
    await flush();

    expect(events).toEqual([
      'readystatechange:1',
      'loadstart:0/0',
      'readystatechange:2',
      'readystatechange:3',
      'progress:7/7',
      'readystatechange:4',
      'load:7/7',
      'loadend:7/7',
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL_);
    expect(init.method).toBe('GET');
    expect((init.headers as unknown as LynxHeaders).get('x-b')).toBe('2');
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('same-origin');
    expect(xhr.status).toBe(200);
    expect(xhr.statusText).toBe('OK');
    expect(xhr.responseURL).toBe('');
    expect(xhr.response).toBe('{"a":1}');
    expect(xhr.responseText).toBe('{"a":1}');
    expect(xhr.getResponseHeader('X-A')).toBe('1');
    expect(xhr.getAllResponseHeaders()).toBe(
      'content-type: application/json\r\nx-a: 1\r\n',
    );
  });

  it('calls the on<event> handlers too', async () => {
    stubFetch();
    const xhr = new LynxXMLHttpRequest();
    const onload = vi.fn();
    const onreadystatechange = vi.fn();
    const listener = vi.fn();
    xhr.onload = onload;
    xhr.onreadystatechange = onreadystatechange;
    xhr.addEventListener('load', listener);
    xhr.addEventListener('load', listener);
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    expect(onload).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'load', target: xhr }),
    );
    expect(onreadystatechange).toHaveBeenCalledTimes(4);
    // A listener added twice is still called once, as with EventTarget.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops calling a removed listener, and ignores a null one', async () => {
    stubFetch();
    const xhr = new LynxXMLHttpRequest();
    const listener = vi.fn();
    xhr.addEventListener('load', listener);
    xhr.removeEventListener('load', listener);
    xhr.addEventListener('load', null);
    xhr.removeEventListener('load', null);
    xhr.removeEventListener('other', listener);
    expect(xhr.dispatchEvent({ type: 'other' })).toBe(true);
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('sends a body with its upload events, and credentials when asked', async () => {
    const fetch = stubFetch();
    const xhr = new LynxXMLHttpRequest();
    const events = record(xhr);
    xhr.open('POST', URL_);
    xhr.withCredentials = true;
    xhr.send('abc');
    await flush();

    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      body: 'abc',
      credentials: 'include',
    });
    expect(events.filter((event) => event.startsWith('upload.'))).toEqual([
      'upload.loadstart:0/3',
      'upload.progress:3/3',
      'upload.load:3/3',
      'upload.loadend:3/3',
    ]);
  });

  it('counts the bytes of a buffer body, and nothing for other bodies', async () => {
    stubFetch();
    const sizes: number[] = [];
    for (const body of [
      new Uint8Array(5),
      new ArrayBuffer(2),
      new URLSearchParams('a=1'),
    ]) {
      const xhr = new LynxXMLHttpRequest();
      xhr.upload.onprogress = (event) => sizes.push(event.total);
      xhr.open('PUT', URL_);
      xhr.send(body);
      await flush();
    }
    expect(sizes).toEqual([5, 2, 0]);
  });

  it("doesn't send a body with a GET", async () => {
    const fetch = stubFetch();
    const xhr = new LynxXMLHttpRequest();
    const upload = vi.fn();
    xhr.upload.onloadstart = upload;
    xhr.open('get', URL_);
    xhr.send('ignored');
    await flush();
    expect(fetch.mock.calls[0]![1].body).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('parses JSON for responseType json, or gives null', async () => {
    for (const [body, expected] of [
      ['{"a":1}', { a: 1 }],
      ['', null],
      ['not json', null],
    ] as const) {
      stubFetch(() => new LynxResponse(body) as unknown as Response);
      const xhr = new LynxXMLHttpRequest();
      xhr.responseType = 'json';
      xhr.open('GET', URL_);
      xhr.send();
      await flush();
      expect(xhr.response).toEqual(expected);
      expect(() => xhr.responseText).toThrow(
        expect.objectContaining({ name: 'InvalidStateError' }),
      );
    }
  });

  it('gives an ArrayBuffer, a Blob, or null for a document', async () => {
    stubFetch(
      () =>
        new LynxResponse(new Uint8Array([1, 2]), {
          headers: { 'content-type': 'image/png' },
        }) as unknown as Response,
    );
    const responses: Record<string, unknown> = {};
    for (const type of ['arraybuffer', 'blob', 'document'] as const) {
      const xhr = new LynxXMLHttpRequest();
      xhr.responseType = type;
      xhr.open('GET', URL_);
      xhr.send();
      await flush();
      responses[type] = xhr.response;
    }
    expect([
      ...new Uint8Array(responses['arraybuffer'] as ArrayBuffer),
    ]).toEqual([1, 2]);
    expect((responses['blob'] as Blob).type).toBe('image/png');
    expect(responses['document']).toBeNull();
  });

  it('gives an untyped Blob for a response without a type', async () => {
    stubFetch(
      () => new LynxResponse(new Uint8Array([1])) as unknown as Response,
    );
    const xhr = new LynxXMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    expect((xhr.response as Blob).type).toBe('');
  });

  it('gives null for a blob where Lynx has no Blob', async () => {
    stubFetch(() => new LynxResponse('x') as unknown as Response);
    vi.stubGlobal('Blob', undefined);
    const xhr = new LynxXMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    expect(xhr.response).toBeNull();
  });

  it('reports the Content-Length as the progress, when there is one', async () => {
    stubFetch(
      () =>
        new LynxResponse('é ✓', {
          headers: { 'content-length': '6' },
        }) as unknown as Response,
    );
    const xhr = new LynxXMLHttpRequest();
    const loaded: number[] = [];
    xhr.onprogress = (event) => loaded.push(event.loaded);
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    expect(loaded).toEqual([6]);
  });

  it('ends with error when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    const xhr = new LynxXMLHttpRequest();
    const events = record(xhr);
    xhr.open('POST', URL_);
    xhr.send('abc');
    await flush();

    expect(events.slice(-5)).toEqual([
      'readystatechange:4',
      'upload.error:0/0',
      'upload.loadend:0/0',
      'error:0/0',
      'loadend:0/0',
    ]);
    expect(xhr.status).toBe(0);
    expect(xhr.response).toBe('');
  });

  it('ends with abort, aborts the fetch and ignores its result', async () => {
    let answer!: (response: Response) => void;
    const fetch = stubFetch(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const xhr = new LynxXMLHttpRequest();
    xhr.responseType = 'json';
    const events = record(xhr);
    xhr.open('GET', URL_);
    xhr.abort(); // Not sent yet: nothing to abort.
    xhr.send();
    await flush();
    xhr.abort();

    expect(fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(events.slice(-3)).toEqual([
      'readystatechange:4',
      'abort:0/0',
      'loadend:0/0',
    ]);
    expect(xhr.readyState).toBe(0);
    expect(xhr.response).toBeNull();
    answer(new LynxResponse('{}') as unknown as Response);
    await flush();
    expect(events.at(-1)).toBe('loadend:0/0');
  });

  it('ignores a body that arrives after an abort', async () => {
    let finish!: (text: string) => void;
    stubFetch(
      () =>
        ({
          status: 200,
          statusText: 'OK',
          url: URL_,
          headers: new LynxHeaders(),
          text: () => new Promise<string>((resolve) => (finish = resolve)),
        }) as unknown as Response,
    );
    const xhr = new LynxXMLHttpRequest();
    const onload = vi.fn();
    xhr.onload = onload;
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    expect(xhr.readyState).toBe(3);
    xhr.abort();
    finish('late');
    await flush();
    expect(onload).not.toHaveBeenCalled();
  });

  it('resets to UNSENT when aborted after loading, without events', async () => {
    stubFetch();
    const xhr = new LynxXMLHttpRequest();
    xhr.open('GET', URL_);
    xhr.send();
    await flush();
    const onabort = vi.fn();
    xhr.onabort = onabort;
    xhr.abort();
    expect(xhr.readyState).toBe(0);
    expect(onabort).not.toHaveBeenCalled();
  });

  it('ends with timeout when the response takes longer than timeout', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(() => new Promise<Response>(() => {}));
    const xhr = new LynxXMLHttpRequest();
    const events = record(xhr);
    xhr.timeout = 100;
    xhr.open('GET', URL_);
    xhr.send();
    await vi.advanceTimersByTimeAsync(100);

    expect(events.slice(-2)).toEqual(['timeout:0/0', 'loadend:0/0']);
    expect(fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
  });

  it('clears the timeout once the response loads', async () => {
    vi.useFakeTimers();
    stubFetch();
    const xhr = new LynxXMLHttpRequest();
    const ontimeout = vi.fn();
    xhr.ontimeout = ontimeout;
    xhr.timeout = 100;
    xhr.open('GET', URL_);
    xhr.send();
    await vi.advanceTimersByTimeAsync(200);
    expect(xhr.status).toBe(200);
    expect(ontimeout).not.toHaveBeenCalled();
  });

  it('ignores the timer of a request that was reopened', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Promise<Response>(() => {}));
    const xhr = new LynxXMLHttpRequest();
    const ontimeout = vi.fn();
    xhr.ontimeout = ontimeout;
    xhr.timeout = 100;
    xhr.open('GET', URL_);
    xhr.send();
    // A timer that fires anyway, as Lynx's might after clearTimeout, is ignored.
    vi.stubGlobal('clearTimeout', () => {});
    xhr.open('GET', URL_);
    await vi.advanceTimersByTimeAsync(200);
    expect(ontimeout).not.toHaveBeenCalled();
    expect(xhr.readyState).toBe(1);
  });

  it('has no MIME type to override', () => {
    expect(() =>
      new LynxXMLHttpRequest().overrideMimeType('text/plain'),
    ).not.toThrow();
  });
});

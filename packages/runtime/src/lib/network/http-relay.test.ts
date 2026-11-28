// @vitest-environment jsdom
import '@angular/compiler';
import {
  FetchBackend,
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
  HttpParams,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
  withXhr,
  ɵHTTP_FETCH_MAX_RESPONSE_SIZE as HTTP_FETCH_MAX_RESPONSE_SIZE,
  ɵHTTP_ROOT_INTERCEPTOR_FNS as HTTP_ROOT_INTERCEPTOR_FNS,
  type HttpEvent,
} from '@angular/common/http';
import {
  createEnvironmentInjector,
  EnvironmentInjector,
  Injectable,
  provideZonelessChangeDetection,
  type Provider,
  type EnvironmentProviders,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { firstValueFrom, type Observable } from 'rxjs';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { callOnBackground } from '../background-call';
import type { RelayedRequest, RelayedResponse } from './background-fetch';
import { bytesToBase64 } from './base64';
import { LynxResponse } from './fetch';
import { relayHttpRequest } from './http-relay';
import { httpRelayInterceptor, setHttpRelay } from './http-relay-hook';
import { installXMLHttpRequest } from './index';

vi.mock('../background-call', () => ({ callOnBackground: vi.fn() }));

/**
 * HttpClient's relay (http-relay.ts) against FetchBackend on the relayed
 * fetch, which it stands in for: each scenario runs both ways, with the
 * background thread answering the same, and must send the same request and
 * emit the same events.
 */

const API = 'https://api.example.com';

type Answer = RelayedResponse | Error | 'never';

/** What the stand-in background thread answers the next `fetch` with. */
let answer: Answer;
/** The requests the main thread relayed. */
let relayed: RelayedRequest[];

const response = (
  init: Partial<RelayedResponse> & Pick<RelayedResponse, 'body'>,
): RelayedResponse => ({
  status: 200,
  statusText: 'OK',
  url: `${API}/data`,
  redirected: false,
  headers: [['Content-Type', 'application/json; charset=utf-8']],
  ...init,
});

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  setHttpRelay(relayHttpRequest);
});

beforeEach(() => {
  const target: Record<string, unknown> = {};
  // What an app that provides HttpClient gets on Lynx's main thread.
  installXMLHttpRequest(target);
  for (const [name, value] of Object.entries(target)) {
    vi.stubGlobal(name, value);
  }
  relayed = [];
  vi.mocked(callOnBackground).mockReset();
  vi.mocked(callOnBackground).mockImplementation(((
    name: string,
    _id: number,
    request: RelayedRequest,
  ) => {
    if (name === 'abortFetch') return Promise.resolve();
    // As the real relay does, the request crosses as JSON.
    relayed.push(copy(request));
    const current = answer;
    if (current === 'never') return new Promise(() => {});
    if (current instanceof Error) return Promise.reject(current);
    return Promise.resolve(copy(current));
  }) as never);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

/**
 * An injector with HttpClient, and with the relay where `relay` is set.
 */
const injector = (
  relay: boolean,
  providers: (Provider | EnvironmentProviders)[] = [],
): EnvironmentInjector =>
  createEnvironmentInjector(
    [
      provideHttpClient(),
      ...providers,
      ...(relay
        ? [
            {
              provide: HTTP_ROOT_INTERCEPTOR_FNS,
              multi: true,
              useValue: httpRelayInterceptor,
            },
          ]
        : []),
    ],
    TestBed.inject(EnvironmentInjector),
  );

/**
 * An event or error as plain data, to compare the two ways by.
 */
const describeValue = (value: unknown): unknown => {
  if (value instanceof HttpResponse || value instanceof HttpErrorResponse) {
    return {
      kind: value.constructor.name,
      type: value.type,
      status: value.status,
      statusText: value.statusText,
      url: value.url,
      ok: value.ok,
      redirected: value.redirected,
      responseType: value.responseType,
      headers: value.headers
        .keys()
        .map((name) => [name, value.headers.getAll(name)]),
      body: value instanceof HttpResponse ? value.body : undefined,
      error:
        value instanceof HttpErrorResponse
          ? describeValue(value.error)
          : undefined,
      message: value instanceof HttpErrorResponse ? value.message : undefined,
    };
  }
  if (value instanceof Error || value instanceof DOMException) {
    return { name: value.name, message: value.message };
  }
  return value;
};

type Outcome = {
  requests: RelayedRequest[];
  events: unknown[];
  error?: unknown;
  /** Whether the response went through the relayed fetch's Response. */
  throughFetch: boolean;
};

/**
 * Sends a request one way and collects what it emits.
 */
const send = async (
  relay: boolean,
  request: (http: HttpClient) => Observable<HttpEvent<unknown>>,
  providers?: (Provider | EnvironmentProviders)[],
): Promise<Outcome> => {
  relayed = [];
  const fromRelayed = vi.spyOn(LynxResponse, 'fromRelayed');
  const http = injector(relay, providers).get(HttpClient);
  const events: unknown[] = [];
  let error: unknown;
  await new Promise<void>((resolve) => {
    request(http).subscribe({
      next: (event) => events.push(describeValue(event)),
      error: (e: unknown) => {
        error = describeValue(e);
        resolve();
      },
      complete: () => resolve(),
    });
  });
  const throughFetch = fromRelayed.mock.calls.length > 0;
  fromRelayed.mockRestore();
  return { requests: relayed, events, error, throughFetch };
};

/**
 * Runs a scenario through FetchBackend and through the relay, and expects the
 * same of both. Returns the relay's outcome.
 */
const same = async (
  request: (http: HttpClient) => Observable<HttpEvent<unknown>>,
  providers?: (Provider | EnvironmentProviders)[],
): Promise<Outcome> => {
  const viaFetch = await send(false, request, providers);
  const viaRelay = await send(true, request, providers);
  // FetchBackend reads a response through the relayed fetch's Response.
  const answered = answer !== 'never' && !(answer instanceof Error);
  expect(viaFetch.throughFetch).toBe(answered);
  const { throughFetch: _a, ...expected } = viaFetch;
  const { throughFetch: _b, ...actual } = viaRelay;
  expect(actual).toEqual(expected);
  return viaRelay;
};

describe('HttpClient through the relay', () => {
  it('gets JSON as FetchBackend does, without the relayed fetch', async () => {
    answer = response({
      headers: [
        ['Content-Type', 'application/json; charset=utf-8'],
        ['X-Many', ' a '],
        ['x-many', 'b'],
        ['Set-Cookie', 'a=1'],
        ['set-cookie', 'b=2'],
        ['Date', 'Sat, 28 Nov 2026 10:00:00 GMT'],
      ],
      body: { text: ')]}\',\n{"greeting":"é ✓"}' },
    });
    const outcome = await same((http) =>
      http.get(`${API}/data`, {
        observe: 'events',
        params: new HttpParams().set('page', '2'),
        headers: { 'X-Token': ' t ', Accept: 'application/json' },
      }),
    );
    expect(outcome.throughFetch).toBe(false);
    expect(outcome.requests).toEqual([
      {
        url: `${API}/data?page=2`,
        method: 'GET',
        headers: [
          ['accept', 'application/json'],
          ['x-token', 't'],
        ],
        body: null,
        options: {},
      },
    ]);
    expect(outcome.events.at(-1)).toMatchObject({
      body: { greeting: 'é ✓' },
      headers: expect.arrayContaining([
        ['x-many', ['a, b']],
        ['set-cookie', ['a=1', 'b=2']],
      ]),
    });
  });

  it('posts JSON, text and form bodies through an interceptor', async () => {
    answer = response({
      status: 201,
      statusText: 'Created',
      body: { text: '{}' },
    });
    const providers = [
      withInterceptors([
        (request, next) =>
          next(request.clone({ setHeaders: { Authorization: 'token' } })),
      ]).ɵproviders,
    ];
    for (const body of [
      { a: '✓' },
      'plain',
      new HttpParams().set('q', 'a b'),
    ]) {
      const outcome = await same(
        (http) => http.post(`${API}/echo`, body, { observe: 'events' }),
        providers,
      );
      expect(outcome.throughFetch).toBe(false);
    }
    const outcome = await same((http) =>
      http.patch(`${API}/echo`, { a: 1 }, { observe: 'events' }),
    );
    expect(outcome.requests[0]).toMatchObject({
      method: 'PATCH',
      body: { text: '{"a":1}' },
      headers: [
        ['accept', 'application/json, text/plain, */*'],
        ['content-type', 'application/json'],
      ],
    });
  });

  it("sends the request's options that aren't the defaults", async () => {
    answer = response({ body: { text: '{}' } });
    const outcome = await same((http) =>
      http.get(`${API}/data`, {
        observe: 'events',
        withCredentials: true,
        keepalive: true,
        cache: 'no-cache',
        priority: 'high',
        mode: 'same-origin',
        redirect: 'manual',
        referrer: 'about:client',
        integrity: 'sha256-x',
        referrerPolicy: 'no-referrer',
      }),
    );
    expect(outcome.throughFetch).toBe(false);
    expect(outcome.requests[0]!.options).toEqual({
      credentials: 'include',
      keepalive: true,
      cache: 'no-cache',
      priority: 'high',
      mode: 'same-origin',
      redirect: 'manual',
      integrity: 'sha256-x',
      referrerPolicy: 'no-referrer',
    });
    await same((http) =>
      http.head(`${API}/data`, { observe: 'events', credentials: 'omit' }),
    );
  });

  it('reads text, and bytes in a charset or UTF-8', async () => {
    for (const [body, type] of [
      [{ text: '﻿hello' }, 'text/plain'],
      [
        { base64: bytesToBase64(new Uint8Array([104, 195, 169])) },
        'text/plain; charset=iso-8859-1',
      ],
      [
        { base64: bytesToBase64(new Uint8Array([104, 195, 169])) },
        'text/plain; charset=utf-8',
      ],
      [
        { base64: bytesToBase64(new Uint8Array([104, 195, 169])) },
        'application/octet-stream',
      ],
    ] as const) {
      answer = response({ headers: [['content-type', type]], body });
      const outcome = await same((http) =>
        http.get(`${API}/data`, { observe: 'events', responseType: 'text' }),
      );
      expect(outcome.throughFetch).toBe(false);
    }
    answer = response({
      body: { base64: bytesToBase64(new Uint8Array([123, 125])) },
    });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
  });

  it('reads an empty body as null, and none at all', async () => {
    answer = response({ body: { text: '' } });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
    answer = response({
      status: 204,
      statusText: 'No Content',
      headers: [],
      body: null,
    });
    await same((http) => http.delete(`${API}/data`, { observe: 'events' }));
  });

  it('fails as FetchBackend does', async () => {
    // JSON that doesn't parse: the error of a success, the text of a failure.
    answer = response({ body: { text: '{nope' } });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
    answer = response({
      status: 500,
      statusText: 'Oops',
      body: { text: '{nope' },
    });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
    answer = response({
      status: 404,
      statusText: 'Not Found',
      body: { text: '{"error":"nope"}' },
    });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
    // A response with no status is a success only with a body.
    answer = response({ status: 0, statusText: '', body: { text: '{"a":1}' } });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
    answer = response({ status: 0, statusText: '', body: null });
    await same((http) => http.get(`${API}/data`, { observe: 'events' }));
    // A request that never reached the server.
    answer = new Error('Could not connect to the server.');
    const outcome = await same((http) =>
      http.get(`${API}/data`, { observe: 'events' }),
    );
    expect(outcome.error).toMatchObject({
      status: 0,
      error: { name: 'TypeError', message: 'Could not connect to the server.' },
    });
  });

  it('times out with a TimeoutError, aborting the background request', async () => {
    answer = 'never';
    const outcome = await same((http) =>
      http.get(`${API}/slow`, { observe: 'events', timeout: 5 }),
    );
    expect(outcome.error).toMatchObject({
      status: 0,
      error: { name: 'TimeoutError' },
    });
    expect(callOnBackground).toHaveBeenCalledWith(
      'abortFetch',
      expect.any(Number),
    );
  });

  it('aborts the background request when unsubscribed, and not once it has answered', async () => {
    answer = 'never';
    const http = injector(true).get(HttpClient);
    http.get(`${API}/slow`).subscribe().unsubscribe();
    expect(callOnBackground).toHaveBeenLastCalledWith(
      'abortFetch',
      expect.any(Number),
    );
    vi.mocked(callOnBackground).mockClear();
    answer = response({ body: { text: '{}' } });
    await firstValueFrom(http.get(`${API}/data`, { timeout: 1000 }));
    expect(callOnBackground).not.toHaveBeenCalledWith(
      'abortFetch',
      expect.anything(),
    );
  });

  it("drops a body that arrives once HttpClient's injector is destroyed", async () => {
    for (const relay of [false, true]) {
      let reply!: (value: RelayedResponse) => void;
      vi.mocked(callOnBackground).mockImplementation(
        () => new Promise<any>((resolve) => (reply = resolve)),
      );
      const env = injector(relay);
      const events: unknown[] = [];
      const done = new Promise<void>((resolve) =>
        env
          .get(HttpClient)
          .get(`${API}/data`, { observe: 'events' })
          .subscribe({
            next: (event) => events.push(event.type),
            complete: resolve,
          }),
      );
      env.destroy();
      reply(response({ body: { text: '{}' } }));
      await done;
      expect(events).toEqual([0]);
      // A response with no body still arrives.
      const env2 = injector(relay);
      const next = firstValueFrom(
        env2.get(HttpClient).delete(`${API}/data`, { observe: 'response' }),
      );
      env2.destroy();
      reply(response({ status: 204, headers: [], body: null }));
      expect((await next).status).toBe(204);
    }
  });

  it("keeps a request's own Content-Type, and a response's missing URL and type", async () => {
    answer = response({
      url: '',
      headers: [],
      body: { base64: bytesToBase64(new Uint8Array([104, 105])) },
    });
    const outcome = await same((http) =>
      http.post(`${API}/echo`, 'hi', {
        observe: 'events',
        responseType: 'text',
        headers: { 'Content-Type': 'text/csv' },
      }),
    );
    expect(outcome.requests[0]!.headers).toContainEqual([
      'content-type',
      'text/csv',
    ]);
  });

  it('ignores what the background thread sends after the request settled', async () => {
    let reply!: (value: RelayedResponse) => void;
    let fail!: (error: Error) => void;
    vi.mocked(callOnBackground).mockImplementation(((name: string) =>
      name === 'abortFetch'
        ? Promise.reject(new Error('gone'))
        : new Promise<any>((resolve, reject) => {
            reply = resolve;
            fail = reject;
          })) as never);
    const http = injector(true).get(HttpClient);
    const error = await firstValueFrom(
      http.get(`${API}/slow`, { timeout: 1 }),
    ).catch((e: unknown) => e);
    expect((error as HttpErrorResponse).error.name).toBe('TimeoutError');
    reply(response({ body: { text: '{}' } }));
    const subscription = http.get(`${API}/slow`).subscribe({ error: () => {} });
    subscription.unsubscribe();
    fail(new Error('aborted'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  describe('passes on to FetchBackend', () => {
    const throughFetch = async (
      request: (http: HttpClient) => Observable<HttpEvent<unknown>>,
      providers?: (Provider | EnvironmentProviders)[],
    ) => {
      answer = response({ body: { text: '{"a":1}' } });
      const outcome = await send(true, request, providers);
      expect(outcome.throughFetch).toBe(true);
      return outcome;
    };

    it('a request with progress events', async () => {
      await throughFetch((http) =>
        http.get(`${API}/data`, { observe: 'events', reportProgress: true }),
      );
    });

    it('a blob or arraybuffer response', async () => {
      await throughFetch((http) =>
        http.get(`${API}/data`, { observe: 'events', responseType: 'blob' }),
      );
      await throughFetch((http) =>
        http.get(`${API}/data`, {
          observe: 'events',
          responseType: 'arraybuffer',
        }),
      );
    });

    it("a body that isn't text, or a GET's body", async () => {
      await throughFetch((http) =>
        http.post(`${API}/echo`, new Uint8Array([1]).buffer, {
          observe: 'events',
        }),
      );
      const outcome = await send(true, (http) =>
        http.request('GET', `${API}/data`, { body: 'x', observe: 'events' }),
      );
      // The main thread's Request refuses it.
      expect(outcome.error).toMatchObject({
        status: 0,
        error: { name: 'TypeError' },
      });
      expect(outcome.requests).toEqual([]);
    });

    it('a URL that needs parsing', async () => {
      const outcome = await throughFetch((http) =>
        http.get(`${API}/a b`, { observe: 'events' }),
      );
      expect(outcome.requests[0]!.url).toBe(`${API}/a%20b`);
    });

    it("a header the main thread's Headers refuses", async () => {
      const outcome = await send(true, (http) =>
        http.get(`${API}/data`, {
          observe: 'events',
          headers: { 'Bad Name': 'x' },
        }),
      );
      expect(outcome.error).toMatchObject({
        status: 0,
        error: { name: 'TypeError' },
      });
    });

    it('withCredentials with credentials, and a response size limit', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await throughFetch((http) =>
        http.get(`${API}/data`, {
          observe: 'events',
          withCredentials: true,
          credentials: 'omit',
        }),
      );
      await throughFetch(
        (http) => http.get(`${API}/data`, { observe: 'events' }),
        [{ provide: HTTP_FETCH_MAX_RESPONSE_SIZE, useValue: 1000 }],
      );
    });

    it("another backend, or a subclass of FetchBackend's", async () => {
      await throughFetch(
        (http) => http.get(`${API}/data`, { observe: 'events' }),
        [withXhr().ɵproviders],
      );
      @Injectable()
      class LoggingBackend extends FetchBackend {}
      await throughFetch(
        (http) => http.get(`${API}/data`, { observe: 'events' }),
        [LoggingBackend, { provide: HttpBackend, useExisting: LoggingBackend }],
      );
    });

    it("a fetch that isn't the relayed one", async () => {
      const own = vi.fn(
        async () =>
          new Response('{"a":1}', {
            headers: { 'content-type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', own);
      const body = await firstValueFrom(
        injector(true).get(HttpClient).get(`${API}/data`),
      );
      expect(body).toEqual({ a: 1 });
      expect(own).toHaveBeenCalled();
      expect(relayed).toEqual([]);
    });
  });
});

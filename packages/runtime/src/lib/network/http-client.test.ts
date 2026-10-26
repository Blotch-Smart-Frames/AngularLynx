// @vitest-environment jsdom
import '@angular/compiler';
import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
  httpResource,
  provideHttpClient,
  withInterceptors,
  withXhr,
  type HttpEvent,
} from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
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
import {
  abortFetchForMainThread,
  fetchForMainThread,
  type RelayedRequest,
} from './background-fetch';
import { installNetworkGlobals } from './index';

vi.mock('../background-call', () => ({ callOnBackground: vi.fn() }));

/**
 * Angular's own HTTP stack on the globals installNetworkGlobals() puts on
 * Lynx's main thread, with a stand-in background thread: each relayed call
 * runs fetchForMainThread() against `server` below, with the request and
 * response copied as JSON, as the real relay does.
 */

const NodeResponse = globalThis.Response;
const API = 'https://api.example.com';

/** The background thread's fetch: a tiny fake server. */
const server = vi.fn(async (url: string, init: RequestInit) => {
  const path = new URL(url).pathname;
  if (path === '/offline')
    throw new TypeError('Could not connect to the server.');
  if (path === '/slow') {
    return new Promise<Response>((_resolve, reject) =>
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
    );
  }
  if (path === '/echo') {
    const body = init.body as string | ArrayBuffer;
    return new NodeResponse(body, {
      status: 201,
      headers: {
        'content-type':
          typeof body === 'string'
            ? 'application/json'
            : 'application/octet-stream',
        'x-auth': new Headers(init.headers).get('authorization') ?? '',
      },
    });
  }
  if (path === '/missing') {
    return new NodeResponse('{"error":"nope"}', {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
    });
  }
  return new NodeResponse(')]}\',\n{"greeting":"é ✓"}', {
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-a': '1' },
  });
});

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('HttpClient on the main thread', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    const target: Record<string, unknown> = {};
    installNetworkGlobals(target);
    for (const [name, value] of Object.entries(target)) {
      vi.stubGlobal(name, value);
    }
    vi.mocked(callOnBackground).mockImplementation(((
      name: string,
      id: number,
      request: RelayedRequest,
    ) => {
      if (name === 'abortFetch') {
        abortFetchForMainThread(id);
        return Promise.resolve();
      }
      // fetchForMainThread() takes the thread's fetch when it starts, so the
      // server only stands in for it during the call.
      const relayFetch = globalThis.fetch;
      vi.stubGlobal('fetch', server);
      try {
        return fetchForMainThread(id, copy(request)).then(copy);
      } finally {
        vi.stubGlobal('fetch', relayFetch);
      }
    }) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  const http = (...features: Parameters<typeof provideHttpClient>) => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(...features),
      ],
    });
    return TestBed.inject(HttpClient);
  };

  for (const [backend, features] of [
    ['FetchBackend (the default)', []],
    ['HttpXhrBackend (withXhr())', [withXhr()]],
  ] as const) {
    describe(backend, () => {
      it("gets JSON, with Angular's `)]}'` prefix stripped, and its headers", async () => {
        const response = await firstValueFrom(
          http(...features).get<{ greeting: string }>(`${API}/data`, {
            observe: 'response',
          }),
        );
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ greeting: 'é ✓' });
        expect(response.headers.get('X-A')).toBe('1');
        expect(response.url).toBe(`${API}/data`);
      });

      it('posts JSON through an interceptor', async () => {
        const client = http(
          ...features,
          withInterceptors([
            (request, next) =>
              next(request.clone({ setHeaders: { Authorization: 'token' } })),
          ]),
        );
        const response = await firstValueFrom(
          client.post(`${API}/echo`, { a: '✓' }, { observe: 'response' }),
        );
        expect(response.status).toBe(201);
        expect(response.body).toEqual({ a: '✓' });
        expect(response.headers.get('x-auth')).toBe('token');
      });

      it('sends and receives bytes', async () => {
        const body = await firstValueFrom(
          http(...features).post(
            `${API}/echo`,
            new Uint8Array([1, 2, 250]).buffer,
            { responseType: 'arraybuffer' },
          ),
        );
        expect([...new Uint8Array(body)]).toEqual([1, 2, 250]);
      });

      it('fails a 404 with the parsed error body', async () => {
        const error = await firstValueFrom(
          http(...features).get(`${API}/missing`),
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpErrorResponse);
        expect(error).toMatchObject({
          status: 404,
          statusText: 'Not Found',
          error: { error: 'nope' },
        });
      });

      it('fails a request that never reached the server with status 0', async () => {
        const error = await firstValueFrom(
          http(...features).get(`${API}/offline`),
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpErrorResponse);
        expect((error as HttpErrorResponse).status).toBe(0);
      });

      it('times out with a TimeoutError, aborting the background request', async () => {
        const error = await firstValueFrom(
          http(...features).get(`${API}/slow`, { timeout: 10 }),
        ).catch((e: unknown) => e);
        expect((error as HttpErrorResponse).status).toBe(0);
        expect((error as HttpErrorResponse).error).toMatchObject({
          name: 'TimeoutError',
        });
        expect(callOnBackground).toHaveBeenCalledWith(
          'abortFetch',
          expect.any(Number),
        );
      });

      it('aborts the background request when unsubscribed', async () => {
        const subscription = http(...features)
          .get(`${API}/slow`)
          .subscribe();
        await new Promise((resolve) => setTimeout(resolve, 0));
        subscription.unsubscribe();
        expect(callOnBackground).toHaveBeenCalledWith(
          'abortFetch',
          expect.any(Number),
        );
      });

      it('reports progress once, when the body has arrived', async () => {
        const events = await lastValueFrom(
          http(...features)
            .get(`${API}/data`, { observe: 'events', reportProgress: true })
            .pipe(toArray()),
        );
        expect(events.map((event: HttpEvent<unknown>) => event.type)).toEqual([
          HttpEventType.Sent,
          HttpEventType.ResponseHeader,
          HttpEventType.DownloadProgress,
          HttpEventType.Response,
        ]);
      });
    });
  }

  it('loads an httpResource', async () => {
    http();
    const resource = TestBed.runInInjectionContext(() =>
      httpResource<{ greeting: string }>(() => `${API}/data`),
    );
    TestBed.tick();
    await vi.waitFor(() => expect(resource.hasValue()).toBe(true));
    expect(resource.value()).toEqual({ greeting: 'é ✓' });
  });
});

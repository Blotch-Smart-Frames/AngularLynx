import {
  FetchBackend,
  HttpBackend,
  HttpErrorResponse,
  HttpEventType,
  HttpHeaders,
  HttpResponse,
  ɵHTTP_FETCH_MAX_RESPONSE_SIZE as HTTP_FETCH_MAX_RESPONSE_SIZE,
  type HttpEvent,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { DestroyRef, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { callOnBackground } from '../background-call';
import type {
  RelayedBody,
  RelayedRequest,
  RelayedResponse,
} from './background-fetch';
import { base64ToBytes } from './base64';
import { relayedOptions, relayFetch } from './fetch';
import { normalizeName, normalizeValue } from './headers';
import { isSerializedHttpUrl, nextRelayId } from './relay';

/**
 * HttpClient's requests, sent to the background thread without going
 * through the main thread's `fetch`.
 *
 * `HttpClient` runs on the main thread, where Angular does, and its default
 * backend, `FetchBackend`, calls the main thread's `fetch` (fetch.ts), which
 * relays the request to the background thread's. On the way, each request
 * became a `Request` with `Headers` and had its URL parsed by the runtime's
 * JavaScript `URL`, and each response became a `Response`, whose body
 * `FetchBackend` reads as a `ReadableStream`: the text the background thread
 * sent was encoded to bytes and decoded back, both in JavaScript. On the iOS
 * Simulator that cost about 0.33 ms of the main thread to start a request and
 * 0.5 ms to handle its response (#869), on the thread that also lays out and
 * animates. ReactLynx makes its requests from the background thread, where
 * none of this is on the engine thread.
 *
 * So a request `FetchBackend` would send through the relayed `fetch` is sent
 * here instead: the `HttpRequest` becomes what the relay carries, and its
 * `HttpResponse` is built from the relayed text, as `FetchBackend` would
 * build it. This runs as the last of HttpClient's interceptors (Angular's
 * `HTTP_ROOT_INTERCEPTOR_FNS`, which its HTTP transfer cache answers requests
 * from in the same way), so the app's interceptors, `PendingTasks` and
 * HttpClient's own handling stay as they are.
 *
 * It takes only what it can answer exactly as `FetchBackend` would, and
 * passes the rest on to `FetchBackend`: a request when the backend isn't
 * `FetchBackend` itself (`withXhr()`, a testing backend, a subclass), when
 * `fetch` isn't the relayed one (the web preview, a test's), with progress
 * events, a `blob` or `arraybuffer` response type, a body that isn't text, a
 * URL that needs parsing (see isSerializedHttpUrl()), a header `Headers`
 * would refuse, or a response size limit.
 */

/** FetchBackend's `Accept` when a request has none. */
const ACCEPT = 'application/json, text/plain, */*';

/** What a JSON response may start with to stop it running as a script, which HttpClient strips. */
const SCRIPT_GUARD = /^\)\]\}',?\n/;

/** A response body's charset, as FetchBackend reads it. */
const CHARSET = /charset=\s*["']?([^;"'\s]+)["']?/i;

const BYTE_ORDER_MARK = 0xfeff;

/** Leading and trailing HTTP whitespace, which a header value drops. */
const HTTP_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/**
 * The request as the relay carries it, built as `FetchBackend` and the main
 * thread's `Request` would build it, or null when it should go to
 * `FetchBackend` instead.
 */
const relayedRequest = (
  request: HttpRequest<unknown>,
): RelayedRequest | null => {
  // Each `inject()` and check here is in the injector of the HttpClient
  // that sends the request, whose backend it would be.
  if ((globalThis as { fetch?: unknown }).fetch !== relayFetch) return null;
  if (Object.getPrototypeOf(inject(HttpBackend)) !== FetchBackend.prototype) {
    return null;
  }
  if (
    request.reportProgress ||
    request.reportDownloadProgress ||
    request.reportUploadProgress ||
    (request.responseType !== 'json' && request.responseType !== 'text') ||
    // FetchBackend warns about the two together, in development.
    (request.withCredentials && request.credentials) ||
    inject(HTTP_FETCH_MAX_RESPONSE_SIZE) !== null
  ) {
    return null;
  }
  const url = request.urlWithParams;
  if (!isSerializedHttpUrl(url)) return null;
  const body = request.serializeBody();
  // A GET or HEAD with a body makes the main thread's Request throw, which
  // FetchBackend reports.
  if (
    body !== null &&
    (typeof body !== 'string' ||
      request.method === 'GET' ||
      request.method === 'HEAD')
  ) {
    return null;
  }
  const headers = relayedHeaders(request);
  if (!headers) return null;
  return {
    url,
    method: request.method,
    headers,
    body: body === null ? null : { text: body },
    options: relayedOptions({
      credentials: request.withCredentials ? 'include' : request.credentials,
      keepalive: request.keepalive,
      cache: request.cache,
      priority: request.priority,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      integrity: request.integrity,
      referrerPolicy: request.referrerPolicy,
    }),
  };
};

/**
 * The request's headers as FetchBackend sets them (each name's values joined
 * with `,`, and `Accept` and `Content-Type` when the request has none) and
 * the main thread's `Headers` relays them: names lowercased, values trimmed,
 * sorted by name. Null for a header `Headers` would refuse.
 */
const relayedHeaders = (
  request: HttpRequest<unknown>,
): [string, string][] | null => {
  const headers: [string, string][] = [];
  try {
    // FetchBackend reads them with HttpHeaders' internal forEach(), which
    // gives the same names and values as these.
    for (const name of request.headers.keys()) {
      const values = request.headers.getAll(name) as string[];
      headers.push([normalizeName(name), normalizeValue(values.join(','))]);
    }
  } catch {
    return null;
  }
  if (!request.headers.has('Accept')) headers.push(['accept', ACCEPT]);
  if (!request.headers.has('Content-Type')) {
    // A text body always has one (`text/plain` for a string), so the main
    // thread's Request never adds its own.
    const type = request.detectContentTypeHeader();
    if (type !== null) headers.push(['content-type', type]);
  }
  // HttpHeaders keeps one entry per name, whatever its case, so no two
  // entries share a name.
  return headers.sort(([a], [b]) => (a < b ? -1 : 1));
};

/**
 * A response's headers as FetchBackend gives them, from the main thread's
 * `Headers`: names lowercased, sorted, and each name's values joined with
 * `, `, except `Set-Cookie`'s.
 */
const responseHeaders = (relayed: [string, string][]): HttpHeaders => {
  const byName = new Map<string, string[]>();
  for (const [name, value] of relayed) {
    const key = name.toLowerCase();
    const values = byName.get(key);
    // As the main thread's Headers trims them. The native side's names and
    // values are valid, so they aren't checked again.
    const trimmed = value.replace(HTTP_WHITESPACE, '');
    if (values) values.push(trimmed);
    else byName.set(key, [trimmed]);
  }
  const init: Record<string, string | string[]> = {};
  for (const name of [...byName.keys()].sort()) {
    const values = byName.get(name) as string[];
    init[name] = name === 'set-cookie' ? values : values.join(', ');
  }
  return new HttpHeaders(init);
};

/**
 * The body's text, decoded as FetchBackend decodes it: UTF-8 for JSON, and
 * the `Content-Type`'s charset for text where `TextDecoder` knows it. The
 * relay sends a UTF-8 body as text, which needs no decoding, but a decoder
 * drops a byte order mark at the start.
 */
const bodyText = (
  body: Exclude<RelayedBody, null>,
  responseType: string,
  contentType: string,
): string => {
  if ('text' in body) {
    return body.text.charCodeAt(0) === BYTE_ORDER_MARK
      ? body.text.slice(1)
      : body.text;
  }
  const bytes = base64ToBytes(body.base64);
  const Decoder = (globalThis as unknown as { TextDecoder: typeof TextDecoder })
    .TextDecoder;
  const charset =
    responseType === 'text' ? CHARSET.exec(contentType)?.[1] : undefined;
  if (charset !== undefined) {
    try {
      return new Decoder(charset).decode(bytes);
    } catch {
      // An encoding the decoder doesn't know is read as UTF-8, as FetchBackend does.
    }
  }
  return new Decoder().decode(bytes);
};

/**
 * The response body as `responseType` asks, as FetchBackend's `parseBody()`
 * gives it. JSON that doesn't parse is the error of a successful response,
 * and the text of a failed one.
 */
const parseBody = (
  request: HttpRequest<unknown>,
  text: string,
  status: number,
): unknown => {
  if (request.responseType === 'text') return text;
  const json = text.replace(SCRIPT_GUARD, '');
  if (json === '') return null;
  try {
    return JSON.parse(json);
  } catch (error) {
    if (status < 200 || status >= 300) return json;
    throw error;
  }
};

/**
 * Sends the request through the relay, and emits what FetchBackend would:
 * `Sent`, then the `HttpResponse`, or an `HttpErrorResponse`.
 */
const relay = (
  request: HttpRequest<unknown>,
  relayed: RelayedRequest,
  destroyRef: DestroyRef,
): Observable<HttpEvent<unknown>> =>
  new Observable<HttpEvent<unknown>>((observer) => {
    const id = nextRelayId();
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      return true;
    };
    /**
     * What FetchBackend reports when `fetch` rejects.
     */
    const fail = (error: unknown) =>
      observer.error(
        new HttpErrorResponse({ error, status: 0, url: request.urlWithParams }),
      );
    const abort = () => {
      callOnBackground('abortFetch', id).catch(() => {});
    };
    const respond = (response: RelayedResponse) => {
      const headers = responseHeaders(response.headers);
      const { statusText } = response;
      const url = response.url || request.urlWithParams;
      let status = response.status;
      let body: unknown = null;
      if (response.body !== null) {
        // FetchBackend stops reading a body once its injector is destroyed.
        if (destroyRef.destroyed) {
          observer.complete();
          return;
        }
        const text = bodyText(
          response.body,
          request.responseType,
          headers.get('content-type') ?? '',
        );
        try {
          body = parseBody(request, text, status);
        } catch (error) {
          observer.error(
            new HttpErrorResponse({ error, headers, status, statusText, url }),
          );
          return;
        }
      }
      if (status === 0) status = body ? 200 : 0;
      const init = {
        headers,
        status,
        statusText,
        url,
        redirected: response.redirected,
        // Lynx's HTTP services have no CORS (see LynxResponse's `type`).
        responseType: 'basic' as const,
      };
      if (status >= 200 && status < 300) {
        observer.next(new HttpResponse({ body, ...init }));
        observer.complete();
      } else {
        observer.error(new HttpErrorResponse({ error: body, ...init }));
      }
    };
    callOnBackground('fetch', id, relayed).then(
      (response) => {
        if (settle()) respond(response);
      },
      (error: Error) => {
        // The relayed `fetch` rejects with a TypeError, as `fetch` does.
        if (settle()) fail(new TypeError(error.message));
      },
    );
    observer.next({ type: HttpEventType.Sent });
    if (request.timeout) {
      // Settling clears it, so it only fires while the request is in flight.
      timeout = setTimeout(() => {
        settle();
        abort();
        fail(new DOMException('signal timed out', 'TimeoutError'));
      }, request.timeout);
    }
    // Unsubscribing before the response arrives aborts the request on the
    // background thread, as FetchBackend's abort does.
    return () => {
      if (settle()) abort();
    };
  });

/**
 * The interceptor that sends a request through the relay when FetchBackend
 * would have sent it through the relayed `fetch`, and passes any other on.
 *
 * @param request - The request.
 * @param next - The rest of the chain: FetchBackend.
 * @returns The request's events.
 */
export const relayHttpRequest: HttpInterceptorFn = (request, next) => {
  const relayed = relayedRequest(request);
  return relayed ? relay(request, relayed, inject(DestroyRef)) : next(request);
};

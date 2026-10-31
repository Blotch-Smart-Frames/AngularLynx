import { base64ToBytes, bytesToBase64 } from './base64';

/**
 * The background thread's half of the main thread's `fetch` (see fetch.ts).
 * Lynx has `fetch` on the background thread only, and Angular runs on the
 * main thread, so the main thread's `fetch` sends each request here, where
 * background-call.ts's relay runs it, and this sends the response back.
 *
 * Everything crosses as JSON. A body is text when it can be, and base64
 * otherwise, since JSON can't carry bytes.
 */

/** A request or response body as it crosses threads. */
export type RelayedBody = { text: string } | { base64: string } | null;

/** A request as the main thread sends it. */
export type RelayedRequest = {
  url: string;
  method: string;
  /** Unique names, since the main thread's Headers joins repeated ones. */
  headers: [string, string][];
  body: RelayedBody;
  /** The rest of `RequestInit`, for hosts that use it (Lynx for Web's worker). */
  options: {
    cache?: string;
    credentials?: string;
    integrity?: string;
    keepalive?: boolean;
    mode?: string;
    priority?: string;
    redirect?: string;
    referrer?: string;
    referrerPolicy?: string;
  };
};

/** A response as the background thread sends it back. */
export type RelayedResponse = {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: [string, string][];
  body: RelayedBody;
};

/**
 * Lynx's HTTP services don't reject when a request fails: they resolve with
 * status 499, the failure as its status text, and no headers
 * (`SDK_ERROR_STATUS_CODE` in LynxHttpService.m, `CODE_FAILED_INTERNALLY` in
 * LynxHttpService.kt). That covers a refused connection, a bad host, a
 * relative URL ("unsupported URL") and Android's cleartext block.
 */
const LYNX_FAILURE_STATUS = 499;

/** Statuses whose responses have no body (the Fetch Standard's null body statuses). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Media types sent as text. Others go as base64, since text would lose bytes
 * that aren't valid UTF-8.
 */
const TEXT_TYPE =
  /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql)\b)/;

/**
 * Whether a body of this `Content-Type` is safe to send as text: a textual
 * type in UTF-8. Lynx decodes `response.text()` as UTF-8 whatever the
 * charset, so another charset goes as bytes, for the main thread to decode.
 */
const isUtf8Text = (contentType: string | null): boolean => {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  const charset = /;\s*charset="?([^";]+)/.exec(type)?.[1];
  return (
    TEXT_TYPE.test(type) && (charset === undefined || /^utf-?8$/.test(charset))
  );
};

/**
 * A header name in the case HTTP/1.1 clients send it: `content-type` →
 * `Content-Type`, `x-api-key` → `X-Api-Key`.
 *
 * The main thread's Headers lowercases names, as the standard's does, but
 * Lynx's background `Headers` (through 4.2) matches them by exact spelling.
 * Its `Request` looks for `Content-Type`, and when that misses it adds
 * `Content-Type: text/plain;charset=UTF-8` beside the request's own. iOS
 * then sends whichever of the two it sets last (dictionary order), and
 * Android sends both. HTTP names are case-insensitive, so every name goes
 * in this case, not only that one, for a host's own HTTP service that looks
 * others up by their usual spelling.
 */
const canonicalName = (name: string): string =>
  name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');

const decodeBody = (body: RelayedBody): string | ArrayBuffer | undefined => {
  if (body === null) return undefined;
  if ('text' in body) return body.text;
  const bytes = base64ToBytes(body.base64);
  // Lynx's Request copies `body.buffer` whole, so it must hold only the body.
  return bytes.buffer;
};

/**
 * The thread's own `fetch`, by name rather than from `globalThis`: Lynx's
 * background thread passes it into the bundle's wrapper function as a
 * parameter, so `globalThis.fetch` is undefined there.
 */
const backgroundFetch = (): typeof fetch | undefined =>
  typeof fetch === 'function' ? fetch : undefined;

/** The controller for each request in flight, by the main thread's ID. */
const controllers = new Map<number, AbortController>();

/**
 * Runs a request for the main thread and resolves with the response, body
 * included. It rejects with a TypeError when the request fails, as `fetch`
 * does.
 *
 * @param id - The main thread's ID for the request, to abort it by.
 * @param request - The request.
 * @returns The response.
 */
export const fetchForMainThread = async (
  id: number,
  request: RelayedRequest,
): Promise<RelayedResponse> => {
  const fetchImpl = backgroundFetch();
  if (!fetchImpl) {
    throw new TypeError(
      "fetch isn't available on the background thread in this environment",
    );
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const response = await fetchImpl(request.url, {
      ...(request.options as RequestInit),
      method: request.method,
      headers: Object.fromEntries(
        request.headers.map(([name, value]) => [canonicalName(name), value]),
      ),
      body: decodeBody(request.body),
      signal: controller.signal,
    });
    const headers: [string, string][] = [];
    response.headers.forEach((value, name) => headers.push([name, value]));
    if (response.status === LYNX_FAILURE_STATUS && headers.length === 0) {
      throw new TypeError(response.statusText || 'Network request failed');
    }
    // Looked up by hand, since Lynx's `get()` matches names by exact spelling,
    // and a response's names come lowercase on Android but capitalized on
    // iOS (`Content-Type`).
    const contentType =
      headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ??
      null;
    let body: RelayedBody = null;
    if (!NULL_BODY_STATUSES.has(response.status)) {
      body = isUtf8Text(contentType)
        ? { text: await response.text() }
        : {
            base64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
          };
    }
    return {
      status: response.status,
      statusText: response.statusText,
      // Lynx leaves out `redirected`, and on Android `url` is the request's.
      url: response.url || request.url,
      redirected: response.redirected === true,
      headers,
      body,
    };
  } finally {
    controllers.delete(id);
  }
};

/**
 * Aborts a request the main thread sent, when its signal aborts. The main
 * thread has already rejected its own promise; this stops the work here.
 *
 * @param id - The main thread's ID for the request.
 */
export const abortFetchForMainThread = (id: number): void => {
  controllers.get(id)?.abort();
};

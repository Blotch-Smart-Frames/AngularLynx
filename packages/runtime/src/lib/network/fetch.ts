import { callOnBackground } from '../background-call';
import type {
  RelayedBody,
  RelayedRequest,
  RelayedResponse,
} from './background-fetch';
import { base64ToBytes, bytesToBase64 } from './base64';
import { blobForURL, decodeDataURL, LynxBlob } from './blob';
import { readBundledAsset, typeOfAsset } from './bundled-asset';
import { LynxHeaders, type HeadersInit } from './headers';
import { isDisturbed, LynxReadableStream } from './readable-stream';
import { LynxTextDecoder, LynxTextEncoder } from './text-codec';

/**
 * `fetch`, `Request` and `Response` for Lynx's main thread.
 *
 * Lynx has `fetch` on the background thread only, and Angular runs on the
 * main thread, so `HttpClient` (whose default backend, `FetchBackend`, calls
 * `globalThis.fetch`), `httpResource` and any library that calls `fetch`
 * failed there. This `fetch` sends each request to the background thread
 * through callOnBackground() and builds the `Response` from what comes back
 * (background-fetch.ts has the other half).
 *
 * The whole body arrives at once: Lynx's own `fetch` doesn't stream unless
 * the page sets `enableFetchAPIStandardStreaming`, and the relay carries one
 * message per call. So `response.body` yields one chunk, and a download
 * reports its progress once, when it's done.
 *
 * Bodies can be strings, `URLSearchParams`, `ArrayBuffer`s and typed arrays.
 * A `Blob`, `FormData` or `ReadableStream` body throws a TypeError: Lynx has
 * no `Blob` or `FormData` and its `fetch` doesn't take them, and a stream
 * can't cross threads.
 */

/** What a body holds: text, bytes, or nothing. */
type BodySource = string | Uint8Array | null;

export type RequestInit = {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  signal?: AbortSignal | null;
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

export type ResponseInit = {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
};

const toBytes = (source: BodySource): Uint8Array =>
  typeof source === 'string'
    ? new LynxTextEncoder().encode(source)
    : (source ?? new Uint8Array(0));

const unsupportedBody = (kind: string) =>
  new TypeError(
    `${kind} request bodies aren't supported on Lynx. Send a string, URLSearchParams, an ArrayBuffer or a typed array.`,
  );

/**
 * Turns a `BodyInit` into text or bytes, and the `Content-Type` it implies.
 * Bytes are copied, so changing the caller's buffer later doesn't change the
 * request.
 */
const extractBody = (
  body: unknown,
): { source: BodySource; type: string | null } => {
  if (body == null) return { source: null, type: null };
  if (typeof body === 'string') {
    return { source: body, type: 'text/plain;charset=UTF-8' };
  }
  if (body instanceof ArrayBuffer) {
    return { source: new Uint8Array(body.slice(0)), type: null };
  }
  if (ArrayBuffer.isView(body)) {
    return {
      source: new Uint8Array(
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      ),
      type: null,
    };
  }
  if (
    typeof URLSearchParams !== 'undefined' &&
    body instanceof URLSearchParams
  ) {
    return {
      source: body.toString(),
      type: 'application/x-www-form-urlencoded;charset=UTF-8',
    };
  }
  if (body instanceof LynxBlob) {
    return { source: body.bytesSync().slice(), type: body.type || null };
  }
  for (const kind of ['Blob', 'FormData', 'ReadableStream']) {
    const type = (globalThis as any)[kind];
    if (typeof type === 'function' && body instanceof type) {
      throw unsupportedBody(kind);
    }
  }
  if (typeof (body as any).getReader === 'function') {
    throw unsupportedBody('ReadableStream');
  }
  return { source: String(body), type: 'text/plain;charset=UTF-8' };
};

/**
 * The `ReadableStream` a body exposes as `body`, holding the body as one
 * chunk, since it arrives in one piece.
 */
const bodyStream = (bytes: Uint8Array): LynxReadableStream<Uint8Array> =>
  new LynxReadableStream<Uint8Array>({
    start: (controller) => {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });

/**
 * A stream's chunks, joined.
 */
const readAll = async (
  stream: LynxReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk =
      value instanceof Uint8Array
        ? value
        : new Uint8Array(value as ArrayBuffer);
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * Whether a body is a ReadableStream (ours, or a library's).
 */
const isStream = (body: unknown): body is LynxReadableStream<Uint8Array> =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as { getReader?: unknown }).getReader === 'function';

/**
 * What `Request` and `Response` share: the body and the ways to read it.
 */
abstract class LynxBody {
  #source: BodySource;
  #used = false;
  #stream: LynxReadableStream<Uint8Array> | undefined;

  abstract readonly headers: LynxHeaders;

  /**
   * A body given as a stream (`new Response(stream)`), which is read when the
   * body is: three.js's FileLoader re-wraps each download this way to report
   * its progress.
   */
  #streamed = false;

  constructor(source: BodySource, stream?: LynxReadableStream<Uint8Array>) {
    this.#source = source;
    if (stream) {
      this.#stream = stream;
      this.#streamed = true;
    }
  }

  get body(): LynxReadableStream<Uint8Array> | null {
    if (this.#streamed) return this.#stream!;
    if (this.#source === null) return null;
    this.#stream ??= bodyStream(toBytes(this.#source));
    return this.#stream;
  }

  /**
   * Whether the body has been read, through a method such as `text()` or
   * through `body`.
   */
  get bodyUsed(): boolean {
    return (
      this.#used || (this.#stream !== undefined && isDisturbed(this.#stream))
    );
  }

  /**
   * Throws if the body can't be read again: it's been read, or a reader
   * holds `body`.
   */
  #assertUnused(action: string): void {
    if (this.bodyUsed || this.#stream?.locked) {
      throw new TypeError(
        `Failed to execute '${action}': body stream already read`,
      );
    }
  }

  /**
   * The body for sending to the other thread, without consuming it.
   */
  protected relayedBody(): RelayedBody {
    // A request can't have a stream for its body (extractBody refuses one),
    // so only text or bytes are ever relayed.
    const source = this.#source;
    if (source === null) return null;
    return typeof source === 'string'
      ? { text: source }
      : { base64: bytesToBase64(source) };
  }

  /**
   * The body for a clone, which must not share the original's stream.
   */
  protected cloneSource(): BodySource {
    this.#assertUnused('clone');
    if (this.#streamed) {
      throw new TypeError(
        "Failed to execute 'clone': a body given as a stream can't be cloned on Lynx",
      );
    }
    return this.#source;
  }

  async #consume(): Promise<BodySource> {
    this.#assertUnused('text');
    this.#used = true;
    if (this.#streamed) return readAll(this.#stream!);
    return this.#source;
  }

  async text(): Promise<string> {
    const source = await this.#consume();
    // `text()` always decodes UTF-8, whatever the Content-Type says.
    return typeof source === 'string'
      ? source
      : new LynxTextDecoder().decode(toBytes(source));
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }

  async bytes(): Promise<Uint8Array> {
    return toBytes(await this.#consume());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async blob(): Promise<Blob> {
    const BlobType = (globalThis as any).Blob as typeof Blob | undefined;
    if (typeof BlobType !== 'function') {
      throw new TypeError('Lynx has no Blob. Use arrayBuffer() instead.');
    }
    return new BlobType([await this.arrayBuffer()], {
      type: this.headers.get('content-type') ?? '',
    });
  }

  async formData(): Promise<never> {
    throw new TypeError('Lynx has no FormData. Use text() or json() instead.');
  }
}

/** The methods the Fetch Standard uppercases. Others, such as PATCH, keep their case. */
const NORMALIZED_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
]);

/**
 * Parses a request URL. There's no page URL on Lynx to resolve a relative
 * one against (Lynx's HTTP services reject it as "unsupported URL"), so it
 * must be absolute.
 */
const parseUrl = (input: string): string => {
  try {
    return new URL(input).href;
  } catch {
    throw new TypeError(
      `Failed to parse URL from ${input}. Lynx has no page URL to resolve a relative URL against, so requests need an absolute URL.`,
    );
  }
};

/** The Fetch Standard's defaults for a request's other options. */
const DEFAULT_OPTIONS: {
  cache: string;
  credentials: string;
  integrity: string;
  keepalive: boolean;
  mode: string;
  priority: string;
  redirect: string;
  referrer: string;
  referrerPolicy: string;
} = {
  cache: 'default',
  credentials: 'same-origin',
  integrity: '',
  keepalive: false,
  mode: 'cors',
  priority: 'auto',
  redirect: 'follow',
  referrer: 'about:client',
  referrerPolicy: '',
};

/**
 * A signal that never aborts, for requests made without one.
 */
const neverAborts = (): AbortSignal => new AbortController().signal;

export class LynxRequest extends LynxBody {
  readonly url: string;
  readonly method: string;
  readonly headers: LynxHeaders;
  readonly signal: AbortSignal;
  readonly cache: string;
  readonly credentials: string;
  readonly integrity: string;
  readonly keepalive: boolean;
  readonly mode: string;
  readonly priority: string;
  readonly redirect: string;
  readonly referrer: string;
  readonly referrerPolicy: string;
  readonly destination = '';

  constructor(input: string | URL | LynxRequest, init: RequestInit = {}) {
    const base = input instanceof LynxRequest ? input : undefined;
    const method = init.method ?? base?.method ?? 'GET';
    const upper = method.toUpperCase();
    const normalizedMethod = NORMALIZED_METHODS.has(upper) ? upper : method;
    const { source, type } =
      init.body !== undefined
        ? extractBody(init.body)
        : { source: base ? base.cloneSource() : null, type: null };
    if (source !== null && (upper === 'GET' || upper === 'HEAD')) {
      throw new TypeError(
        "Failed to construct 'Request': Request with GET/HEAD method cannot have body.",
      );
    }
    super(source);
    this.url = base ? base.url : parseUrl(String(input));
    this.method = normalizedMethod;
    this.headers = new LynxHeaders(init.headers ?? base?.headers);
    if (type !== null && !this.headers.has('content-type')) {
      this.headers.set('content-type', type);
    }
    this.signal = init.signal ?? base?.signal ?? neverAborts();
    const options: typeof DEFAULT_OPTIONS = base ?? DEFAULT_OPTIONS;
    this.cache = init.cache ?? options.cache;
    this.credentials = init.credentials ?? options.credentials;
    this.integrity = init.integrity ?? options.integrity;
    this.keepalive = init.keepalive ?? options.keepalive;
    this.mode = init.mode ?? options.mode;
    this.priority = init.priority ?? options.priority;
    this.redirect = init.redirect ?? options.redirect;
    this.referrer = init.referrer ?? options.referrer;
    this.referrerPolicy = init.referrerPolicy ?? options.referrerPolicy;
  }

  clone(): LynxRequest {
    return new LynxRequest(this);
  }

  /**
   * The request as fetchForMainThread() takes it.
   */
  toRelayed(): RelayedRequest {
    return {
      url: this.url,
      method: this.method,
      headers: [...this.headers.entries()],
      body: this.relayedBody(),
      // Only what the caller set: Lynx ignores these, and Lynx for Web's
      // worker would apply them to a request it could make without them.
      options: Object.fromEntries(
        Object.entries(DEFAULT_OPTIONS)
          .filter(([name, value]) => (this as any)[name] !== value)
          .map(([name]) => [name, (this as any)[name]]),
      ),
    };
  }
}

/**
 * A body that's already text or bytes, which internal callers pass to the
 * constructors so it isn't converted again.
 */
class ExtractedBody {
  constructor(readonly source: BodySource) {}
}

/** Values only a response from the network has. */
type NetworkDetails = {
  url: string;
  redirected: boolean;
  type: string;
};

export class LynxResponse extends LynxBody {
  readonly status: number;
  readonly statusText: string;
  readonly headers: LynxHeaders;
  readonly url: string;
  readonly redirected: boolean;
  /**
   * `basic` for a response from the network: Lynx's HTTP services have no
   * CORS, so there are no `cors` or `opaque` responses.
   */
  readonly type: string;

  constructor(
    body?: unknown,
    init: ResponseInit = {},
    details: NetworkDetails = { url: '', redirected: false, type: 'default' },
  ) {
    const status = init.status ?? 200;
    if (
      details.type === 'default' &&
      (!Number.isInteger(status) || status < 200 || status > 599)
    ) {
      throw new RangeError(
        `Failed to construct 'Response': The status provided (${status}) is outside the range [200, 599].`,
      );
    }
    // A response, unlike a request, can take a stream for its body.
    const { source, type } =
      body instanceof ExtractedBody
        ? { source: body.source, type: null }
        : isStream(body)
          ? { source: null, type: null }
          : extractBody(body);
    super(source, isStream(body) ? body : undefined);
    this.status = status;
    this.statusText = init.statusText ?? '';
    this.headers = new LynxHeaders(init.headers);
    if (type !== null && !this.headers.has('content-type')) {
      this.headers.set('content-type', type);
    }
    this.url = details.url;
    this.redirected = details.redirected;
    this.type = details.type;
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  clone(): LynxResponse {
    return new LynxResponse(
      new ExtractedBody(this.cloneSource()),
      {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
      },
      { url: this.url, redirected: this.redirected, type: this.type },
    );
  }

  static error(): LynxResponse {
    return new LynxResponse(
      null,
      { status: 0 },
      { url: '', redirected: false, type: 'error' },
    );
  }

  static json(data: unknown, init: ResponseInit = {}): LynxResponse {
    const response = new LynxResponse(
      new ExtractedBody(JSON.stringify(data)),
      init,
    );
    if (!response.headers.has('content-type')) {
      response.headers.set('content-type', 'application/json');
    }
    return response;
  }

  static redirect(url: string, status = 302): LynxResponse {
    if (![301, 302, 303, 307, 308].includes(status)) {
      throw new RangeError(
        `Failed to execute 'redirect' on 'Response': Invalid status code ${status}`,
      );
    }
    return new LynxResponse(null, {
      status,
      headers: { location: parseUrl(url) },
    });
  }

  /**
   * Builds the response the background thread sent.
   *
   * @param relayed - The response from fetchForMainThread().
   * @returns The response.
   */
  static fromRelayed(relayed: RelayedResponse): LynxResponse {
    const body = relayed.body;
    const source: BodySource =
      body === null
        ? null
        : 'text' in body
          ? body.text
          : base64ToBytes(body.base64);
    return new LynxResponse(
      new ExtractedBody(source),
      {
        status: relayed.status,
        statusText: relayed.statusText,
        headers: relayed.headers,
      },
      { url: relayed.url, redirected: relayed.redirected, type: 'basic' },
    );
  }
}

let nextFetchId = 0;

/**
 * A relative URL: one with no scheme.
 */
const isRelative = (url: string): boolean =>
  !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);

/**
 * The response to a GET of a file the app bundles, read by the shell, or
 * null for any other request.
 */
const bundledResponse = (
  input: string | URL | LynxRequest,
  init?: RequestInit,
): LynxResponse | null => {
  if (typeof input !== 'string' || !isRelative(input)) return null;
  if (init?.method && init.method.toUpperCase() !== 'GET') return null;
  const bytes = readBundledAsset(input);
  if (!bytes) return null;
  return new LynxResponse(
    new ExtractedBody(bytes),
    {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': typeOfAsset(input),
        'content-length': String(bytes.byteLength),
      },
    },
    { url: input, redirected: false, type: 'basic' },
  );
};

/**
 * The response to a `blob:` URL (see blob.ts) or a `data:` URL, read here, or
 * null for a URL that needs the network. A revoked object URL fails, as in
 * a browser.
 */
const localResponse = (url: string): LynxResponse | TypeError | null => {
  if (url.startsWith('blob:')) {
    const blob = blobForURL(url);
    if (!blob) return new TypeError('Failed to fetch');
    return new LynxResponse(
      new ExtractedBody(blob.bytesSync().slice()),
      {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': blob.type,
          'content-length': String(blob.size),
        },
      },
      { url, redirected: false, type: 'basic' },
    );
  }
  if (url.startsWith('data:')) {
    const data = decodeDataURL(url);
    if (!data) return new TypeError('Failed to fetch');
    return new LynxResponse(
      new ExtractedBody(data.bytes),
      { status: 200, statusText: 'OK', headers: { 'content-type': data.type } },
      { url, redirected: false, type: 'basic' },
    );
  }
  return null;
};

/**
 * `fetch` for Lynx's main thread: runs the request on the background thread
 * and resolves with its response. It rejects with the signal's reason when
 * the signal aborts, which also aborts the background thread's request, and
 * with a TypeError when the request fails.
 *
 * @param input - The URL, or a Request.
 * @param init - The request's options.
 * @returns The response.
 */
export const relayFetch = (
  input: string | URL | LynxRequest,
  init?: RequestInit,
): Promise<LynxResponse> =>
  new Promise((resolve, reject) => {
    // A file the app bundles, under a URL relative to the app, which Lynx
    // has no page URL to resolve (see bundled-asset.ts).
    const bundled = bundledResponse(input, init);
    if (bundled) {
      resolve(bundled);
      return;
    }
    const request = new LynxRequest(input, init);
    const { signal } = request;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    // An object URL or a data: URL needs no request: its bytes are here.
    const local = localResponse(request.url);
    if (local) {
      if (local instanceof LynxResponse) resolve(local);
      else reject(local);
      return;
    }
    const id = nextFetchId++;
    let settled = false;
    /**
     * Removed once the request settles, so it only runs while in flight.
     */
    const onAbort = () => {
      settled = true;
      reject(signal.reason);
      callOnBackground('abortFetch', id).catch(() => {});
    };
    signal.addEventListener('abort', onAbort);
    const settle = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      fn();
    };
    callOnBackground('fetch', id, request.toRelayed()).then(
      (relayed) => settle(() => resolve(LynxResponse.fromRelayed(relayed))),
      (error: Error) => settle(() => reject(new TypeError(error.message))),
    );
  });

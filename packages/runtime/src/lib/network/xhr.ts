import { LynxDOMException } from './dom-exception';
import { LynxHeaders } from './headers';

/**
 * `XMLHttpRequest` for Lynx, which has none on either thread, built on the
 * thread's `fetch` (on the main thread, fetch.ts's relay). Angular's
 * `HttpXhrBackend` (`provideHttpClient(withXhr())`) uses it, as do libraries
 * such as axios, which pick XHR whenever it exists.
 *
 * It's asynchronous only: a synchronous request would have to block the
 * thread until another thread answers. Like the relayed `fetch`, the body
 * arrives in one piece, so `progress` fires once, when it's done, and an
 * upload's `progress` fires once the response starts.
 */

type Listener = (event: XhrEvent) => void;

/** The event objects XHR listeners get. */
export type XhrEvent = {
  type: string;
  target: unknown;
  currentTarget: unknown;
  lengthComputable: boolean;
  loaded: number;
  total: number;
};

/**
 * Listeners by type, plus the `on<type>` properties, for the request and `upload`.
 */
class XhrEventTarget {
  #listeners = new Map<string, Set<Listener>>();
  onloadstart: Listener | null = null;
  onprogress: Listener | null = null;
  onabort: Listener | null = null;
  onerror: Listener | null = null;
  onload: Listener | null = null;
  ontimeout: Listener | null = null;
  onloadend: Listener | null = null;

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (listener) this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string }): boolean {
    const full: XhrEvent = {
      lengthComputable: false,
      loaded: 0,
      total: 0,
      ...event,
      target: this,
      currentTarget: this,
    };
    const handler = (this as any)[`on${event.type}`];
    if (typeof handler === 'function') handler.call(this, full);
    // A copy, so a listener that adds or removes listeners doesn't change
    // who this event reaches, as with EventTarget.
    for (const listener of Array.from(this.#listeners.get(event.type) ?? [])) {
      listener.call(this, full);
    }
    return true;
  }

  /**
   * Fires a progress-style event with byte counts.
   */
  protected fire(type: string, loaded = 0, total = 0): void {
    this.dispatchEvent({
      type,
      lengthComputable: total > 0,
      loaded,
      total,
    } as XhrEvent);
  }
}

class XhrUpload extends XhrEventTarget {
  /**
   * Lets the request fire the upload's events.
   */
  emit(type: string, loaded?: number, total?: number): void {
    this.fire(type, loaded, total);
  }
}

const UNSENT = 0;
const OPENED = 1;
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

/**
 * The size of a body for upload progress, as far as it can be known.
 */
const bodySize = (body: unknown): number => {
  if (typeof body === 'string') return body.length;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  return 0;
};

export class LynxXMLHttpRequest extends XhrEventTarget {
  static readonly UNSENT = UNSENT;
  static readonly OPENED = OPENED;
  static readonly HEADERS_RECEIVED = HEADERS_RECEIVED;
  static readonly LOADING = LOADING;
  static readonly DONE = DONE;
  readonly UNSENT = UNSENT;
  readonly OPENED = OPENED;
  readonly HEADERS_RECEIVED = HEADERS_RECEIVED;
  readonly LOADING = LOADING;
  readonly DONE = DONE;

  readonly upload = new XhrUpload();
  onreadystatechange: Listener | null = null;
  readyState = UNSENT;
  status = 0;
  statusText = '';
  responseURL = '';
  responseType: XMLHttpRequestResponseType = '';
  response: unknown = '';
  timeout = 0;
  withCredentials = false;

  #method = 'GET';
  #url = '';
  #requestHeaders = new LynxHeaders();
  #responseHeaders = new LynxHeaders();
  #responseText = '';
  #controller: AbortController | undefined;
  /** Counts sends, so a request that was aborted or reopened ignores its old fetch. */
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the upload's events are still to come. */
  #uploading = false;

  get responseText(): string {
    if (this.responseType !== '' && this.responseType !== 'text') {
      throw new LynxDOMException(
        `Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '${this.responseType}').`,
        'InvalidStateError',
      );
    }
    return this.#responseText;
  }

  open(method: string, url: string | URL, async = true): void {
    if (!async) {
      throw new LynxDOMException(
        "Failed to execute 'open' on 'XMLHttpRequest': Synchronous requests aren't supported on Lynx, where the request runs on another thread.",
        'InvalidAccessError',
      );
    }
    this.#cancel();
    this.#method = method;
    this.#url = String(url);
    this.#requestHeaders = new LynxHeaders();
    this.#reset();
    this.#setReadyState(OPENED);
  }

  setRequestHeader(name: string, value: string): void {
    this.#assertOpened('setRequestHeader');
    this.#requestHeaders.append(name, value);
  }

  send(body: unknown = null): void {
    this.#assertOpened('send');
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#controller = controller;
    const method = this.#method.toUpperCase();
    const sendsBody = method !== 'GET' && method !== 'HEAD' && body != null;
    const uploadSize = sendsBody ? bodySize(body) : 0;
    this.#uploading = sendsBody;
    this.fire('loadstart');
    if (sendsBody) this.upload.emit('loadstart', 0, uploadSize);
    if (this.timeout > 0) {
      this.#timer = setTimeout(() => {
        if (generation !== this.#generation) return;
        this.#fail('timeout');
      }, this.timeout);
    }
    const current = () => generation === this.#generation;
    Promise.resolve()
      .then(() =>
        globalThis.fetch(this.#url, {
          method: this.#method,
          headers: this.#requestHeaders as unknown as HeadersInit,
          body: sendsBody ? (body as BodyInit) : undefined,
          credentials: this.withCredentials ? 'include' : 'same-origin',
          signal: controller.signal,
        }),
      )
      .then(async (response) => {
        if (!current()) return;
        this.#uploadDone(uploadSize);
        this.status = response.status;
        this.statusText = response.statusText;
        this.responseURL = response.url;
        this.#responseHeaders = new LynxHeaders(
          response.headers as unknown as Iterable<[string, string]>,
        );
        this.#setReadyState(HEADERS_RECEIVED);
        this.#setReadyState(LOADING);
        const size = await this.#readResponse(response);
        if (!current()) return;
        this.#finish();
        this.fire('progress', size, size);
        this.#setReadyState(DONE);
        this.fire('load', size, size);
        this.fire('loadend', size, size);
      })
      .catch(() => {
        // An abort or a timeout has already ended the request.
        if (current()) this.#fail('error');
      });
  }

  abort(): void {
    if (this.#controller && this.readyState !== DONE) {
      this.#fail('abort');
    }
    if (this.readyState === DONE) {
      this.readyState = UNSENT;
    }
  }

  getResponseHeader(name: string): string | null {
    return this.readyState >= HEADERS_RECEIVED
      ? this.#responseHeaders.get(name)
      : null;
  }

  /**
   * Each header as `name: value`, one per line, the way browsers list them.
   */
  getAllResponseHeaders(): string {
    if (this.readyState < HEADERS_RECEIVED) return '';
    let headers = '';
    for (const [name, value] of this.#responseHeaders) {
      headers += `${name}: ${value}\r\n`;
    }
    return headers;
  }

  overrideMimeType(_mime: string): void {
    // Only UTF-8 text is decoded, so there's no charset to override.
  }

  /**
   * Reads the body into `response` for `responseType`, and returns its size
   * for the progress events. Text is read as text, so the relayed `fetch`
   * doesn't turn it into bytes only for this to decode them again.
   */
  async #readResponse(response: Response): Promise<number> {
    const type = this.responseType;
    if (type === 'arraybuffer' || type === 'blob') {
      const buffer = await response.arrayBuffer();
      const BlobType = (globalThis as any).Blob as typeof Blob | undefined;
      this.response =
        type === 'arraybuffer'
          ? buffer
          : typeof BlobType === 'function'
            ? new BlobType([buffer], {
                type: this.#responseHeaders.get('content-type') ?? '',
              })
            : // Lynx has no Blob, so there's nothing to return.
              null;
      return buffer.byteLength;
    }
    const text = await response.text();
    if (type === 'json') {
      try {
        this.response = text === '' ? null : JSON.parse(text);
      } catch {
        this.response = null;
      }
    } else if (type === 'document') {
      // There's no DOM to parse into.
      this.response = null;
    } else {
      this.#responseText = text;
      this.response = text;
    }
    const length = Number(this.#responseHeaders.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : text.length;
  }

  /**
   * Fires the upload's closing events, once the response starts.
   */
  #uploadDone(size: number): void {
    if (!this.#uploading) return;
    this.#uploading = false;
    this.upload.emit('progress', size, size);
    this.upload.emit('load', size, size);
    this.upload.emit('loadend', size, size);
  }

  /**
   * Ends a request that didn't load: a network error, an abort or a timeout.
   */
  #fail(type: 'error' | 'abort' | 'timeout'): void {
    this.#cancel();
    this.#reset();
    this.#setReadyState(DONE);
    if (this.#uploading) {
      this.#uploading = false;
      this.upload.emit(type);
      this.upload.emit('loadend');
    }
    this.fire(type);
    this.fire('loadend');
  }

  /**
   * Stops the request in flight, if any, so its result is ignored.
   */
  #cancel(): void {
    this.#generation++;
    this.#finish();
    this.#controller?.abort();
    this.#controller = undefined;
  }

  #finish(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #reset(): void {
    this.status = 0;
    this.statusText = '';
    this.responseURL = '';
    this.response =
      this.responseType === '' || this.responseType === 'text' ? '' : null;
    this.#responseText = '';
    this.#responseHeaders = new LynxHeaders();
  }

  #assertOpened(method: string): void {
    if (this.readyState !== OPENED || this.#controller) {
      throw new LynxDOMException(
        `Failed to execute '${method}' on 'XMLHttpRequest': The object's state must be OPENED.`,
        'InvalidStateError',
      );
    }
  }

  #setReadyState(state: number): void {
    this.readyState = state;
    this.dispatchEvent({ type: 'readystatechange' });
  }
}

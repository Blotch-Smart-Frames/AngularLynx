import { lynxAtob, lynxBtoa } from './base64';
import { LynxBlob } from './blob';
import {
  createObjectURL,
  installObjectURLs,
  revokeObjectURL,
} from './blob-urls';
import { LynxDOMException } from './dom-exception';
import { LynxRequest, LynxResponse, relayFetch } from './fetch';
import { LynxHeaders } from './headers';
import { LynxReadableStream } from './readable-stream';
import { LynxTextDecoder, LynxTextEncoder } from './text-codec';
import { LynxXMLHttpRequest } from './xhr';

export {
  createObjectURL,
  installObjectURLs,
  LynxBlob,
  revokeObjectURL,
  lynxAtob,
  lynxBtoa,
  LynxDOMException,
  LynxHeaders,
  LynxReadableStream,
  LynxRequest,
  LynxResponse,
  LynxTextDecoder,
  LynxTextEncoder,
  LynxXMLHttpRequest,
  relayFetch,
};

/**
 * Returns a function that sets a global on `target` only where it's missing,
 * so a runtime's own (a browser frame's, a Web Worker's) wins.
 */
const installer =
  (target: Record<string, unknown>) => (name: string, value: unknown) => {
    if (typeof target[name] === 'undefined') target[name] = value;
  };

/**
 * Installs `atob`, `btoa` and the `DOMException` they throw on `target`, on
 * either of Lynx's threads, where they're missing. Neither thread has them,
 * and libraries written for browsers call them directly: Firebase Firestore
 * encodes and decodes its resume and stream tokens with them (issue #206).
 * An app's background functions run browser code too, so the background
 * thread gets them as well as the main thread.
 *
 * `DOMException` comes with them, so `error instanceof DOMException` works
 * for what `atob` throws on bad input, as it does in a browser.
 *
 * Each is installed only where it's missing: the web preview's threads, a
 * browser frame and a Web Worker, keep their own. Takes the global as a
 * parameter so tests can pass a stand-in, as installUrl() does.
 *
 * @param target - The global object.
 */
export const installBase64Globals = (target: Record<string, unknown>): void => {
  const install = installer(target);
  install('DOMException', LynxDOMException);
  install('atob', lynxAtob);
  install('btoa', lynxBtoa);
};

/**
 * Installs `TextEncoder` on `target`, Lynx's main thread, where it's missing.
 *
 * Not every app gets it, nor `TextDecoder`, `ReadableStream` or `Blob`: the
 * build plugin calls each one's enable function in each module that names it
 * (see enable.ts), and `fetch` brings them all (installFetch()). Each is
 * installed only where it's missing, so the web preview, whose main thread is
 * a browser frame, keeps its own. Each takes the global as a parameter so
 * tests can pass a stand-in, as installUrl() does.
 *
 * @param target - The global object.
 */
export const installTextEncoder = (target: Record<string, unknown>): void => {
  installer(target)('TextEncoder', LynxTextEncoder);
};

/**
 * Installs `TextDecoder` on `target`, Lynx's main thread, where it's missing
 * (see installTextEncoder()).
 *
 * @param target - The global object.
 */
export const installTextDecoder = (target: Record<string, unknown>): void => {
  installer(target)('TextDecoder', LynxTextDecoder);
};

/**
 * Installs `ReadableStream` on `target`, Lynx's main thread, where it's
 * missing (see installTextEncoder()). Code checks for the global before it
 * reads a response's `body` as a stream, and Firestore's WebChannel drops a
 * response it reads any other way (readable-stream.ts), so a module that
 * names it gets it whether or not it names `fetch`.
 *
 * @param target - The global object.
 */
export const installReadableStream = (
  target: Record<string, unknown>,
): void => {
  installer(target)('ReadableStream', LynxReadableStream);
};

/**
 * Installs `Blob` on `target`, Lynx's main thread, where it's missing (see
 * installTextEncoder()). three.js's glTF loader makes a Blob and an object
 * URL of each image a .glb holds, then loads the URL (see blob.ts); a
 * canvas's `toBlob()` and LynxImagePicker's photos are Blobs too. Object
 * URLs themselves are in every app (blob-urls.ts's installObjectURLs()).
 *
 * @param target - The global object.
 */
export const installBlob = (target: Record<string, unknown>): void => {
  installer(target)('Blob', LynxBlob);
};

/**
 * Installs `fetch`, relayed to the background thread's, on `target`, Lynx's
 * main thread, where it's missing, with `Headers`, `Request` and `Response`.
 * `TextEncoder`, `TextDecoder`, `ReadableStream` and `Blob` come with it,
 * for reading a response. With them, `provideHttpClient()` works as it does
 * in a browser (`FetchBackend` is its default), and so do `httpResource` and
 * libraries that call `fetch`. `DOMException`, which Angular's HTTP backends throw on a
 * timeout, comes from installBase64Globals(), on both threads.
 *
 * Not every app gets it: the build plugin calls ɵenableFetch(), which calls
 * this, in each module that names one of these (see enable.ts). Each is
 * installed only where it's missing, so the web preview keeps its own.
 *
 * @param target - The global object.
 */
export const installFetch = (target: Record<string, unknown>): void => {
  // The classes go together: the relayed fetch builds a LynxResponse, and
  // Angular checks `headers instanceof Headers`.
  if (typeof target['fetch'] !== 'undefined') return;
  // A response's body is read with them (`body` is a ReadableStream,
  // `blob()` makes a Blob), and code that fetches uses them on what it gets
  // back without naming them: Angular's FetchBackend decodes each `json` and
  // `text` response with a TextDecoder of @angular/common's, which doesn't
  // count (on-demand.ts's ANGULAR_UNUSED). The relayed fetch brings their
  // classes anyway.
  installTextEncoder(target);
  installTextDecoder(target);
  installReadableStream(target);
  installBlob(target);
  const install = installer(target);
  install('fetch', relayFetch);
  install('Headers', LynxHeaders);
  install('Request', LynxRequest);
  install('Response', LynxResponse);
};

/**
 * Installs `XMLHttpRequest` on `target`, Lynx's main thread, where it's
 * missing, for `HttpXhrBackend` (`provideHttpClient(withXhr())`) and the
 * libraries that use XHR. It sends each request through `fetch`, so that
 * comes too (installFetch()).
 *
 * Not every app gets it: the build plugin calls ɵenableXMLHttpRequest() in
 * each module that names it (see enable.ts).
 *
 * @param target - The global object.
 */
export const installXMLHttpRequest = (
  target: Record<string, unknown>,
): void => {
  installFetch(target);
  installer(target)('XMLHttpRequest', LynxXMLHttpRequest);
};

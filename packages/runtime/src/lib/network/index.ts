import { lynxAtob, lynxBtoa } from './base64';
import { LynxDOMException } from './dom-exception';
import { LynxRequest, LynxResponse, relayFetch } from './fetch';
import { LynxHeaders } from './headers';
import { LynxReadableStream } from './readable-stream';
import { LynxTextDecoder, LynxTextEncoder } from './text-codec';
import { LynxXMLHttpRequest } from './xhr';

export {
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
 * Installs the web's network APIs on `target`, Lynx's main thread, where
 * they're missing: `fetch` (relayed to the background thread's), `Headers`,
 * `Request`, `Response`, `ReadableStream`, `XMLHttpRequest`, `TextEncoder`
 * and `TextDecoder`. With them, `provideHttpClient()` works as it does in a
 * browser, whichever backend it uses (`FetchBackend` by default, or
 * `HttpXhrBackend` with `withXhr()`), and so do `httpResource` and libraries
 * that call `fetch` or XHR. `DOMException`, which Angular's HTTP backends
 * throw on a timeout, comes from installBase64Globals(), on both threads.
 *
 * Each is installed only where it's missing, so the web preview, whose main
 * thread is a browser frame, keeps its own. Takes the global as a parameter
 * so tests can pass a stand-in, as installUrl() does.
 *
 * @param target - The global object.
 */
export const installNetworkGlobals = (
  target: Record<string, unknown>,
): void => {
  const install = installer(target);
  install('TextEncoder', LynxTextEncoder);
  install('TextDecoder', LynxTextDecoder);
  // On its own, not with fetch: code checks for the global before it reads
  // a response's `body` as a stream, and Firestore's WebChannel drops a
  // response it reads any other way (readable-stream.ts).
  install('ReadableStream', LynxReadableStream);
  // The classes go together: the relayed fetch builds a LynxResponse, and
  // Angular checks `headers instanceof Headers`.
  if (typeof target['fetch'] === 'undefined') {
    install('fetch', relayFetch);
    install('Headers', LynxHeaders);
    install('Request', LynxRequest);
    install('Response', LynxResponse);
  }
  install('XMLHttpRequest', LynxXMLHttpRequest);
};

import { LynxDOMException } from './dom-exception';
import { LynxRequest, LynxResponse, relayFetch } from './fetch';
import { LynxHeaders } from './headers';
import { LynxTextDecoder, LynxTextEncoder } from './text-codec';
import { LynxXMLHttpRequest } from './xhr';

export {
  LynxDOMException,
  LynxHeaders,
  LynxRequest,
  LynxResponse,
  LynxTextDecoder,
  LynxTextEncoder,
  LynxXMLHttpRequest,
  relayFetch,
};

/**
 * Installs the web's network APIs on `target`, Lynx's main thread, where
 * they're missing: `fetch` (relayed to the background thread's), `Headers`,
 * `Request`, `Response`, `XMLHttpRequest`, `TextEncoder`, `TextDecoder` and
 * `DOMException`. With them, `provideHttpClient()` works as it does in a
 * browser, whichever backend it uses (`FetchBackend` by default, or
 * `HttpXhrBackend` with `withXhr()`), and so do `httpResource` and libraries
 * that call `fetch` or XHR.
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
  const install = (name: string, value: unknown) => {
    if (typeof target[name] === 'undefined') target[name] = value;
  };
  install('TextEncoder', LynxTextEncoder);
  install('TextDecoder', LynxTextDecoder);
  install('DOMException', LynxDOMException);
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

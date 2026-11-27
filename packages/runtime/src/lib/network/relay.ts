import { callOnBackground } from '../background-call';
import { utf8Encode } from '../url/percent-encoding';
import { base64ToBytes } from './base64';
import { readBundledAsset } from './bundled-asset';

let nextId = 0;

/**
 * An ID for a request the main thread relays to the background thread, which
 * keeps an AbortController for each one by its ID (background-fetch.ts). The
 * main thread's `fetch` and relayBytes() share the count, so no two requests
 * in flight have one ID.
 */
export const nextRelayId = (): number => nextId++;

/**
 * A relative URL: one with no scheme.
 */
export const isRelative = (url: string): boolean =>
  !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);

/**
 * A file's bytes, for a GET of `url` (not an object URL or a data: URL),
 * read the way the main thread's `fetch` reads them: a relative URL is a
 * file the app bundles (bundled-asset.ts), and any other goes to the
 * background thread's `fetch`.
 *
 * For the runtime's own loads, such as an `Image`'s, in an app that has no
 * `fetch` on the main thread: the build plugin installs it only where a module
 * names it (network/enable.ts), and a browser loads an image without `fetch`
 * too.
 *
 * @param url - The URL.
 * @returns The bytes. It rejects when there's no such file, the request
 * fails, or the status isn't a 2xx.
 */
export const relayBytes = async (url: string): Promise<Uint8Array> => {
  if (isRelative(url)) {
    const bytes = readBundledAsset(url);
    if (!bytes) {
      throw new TypeError(
        `Failed to load ${url}: the app bundles no such file`,
      );
    }
    return bytes;
  }
  const response = await callOnBackground('fetch', nextRelayId(), {
    url,
    method: 'GET',
    headers: [],
    body: null,
    options: {},
  });
  if (response.status < 200 || response.status > 299) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  const { body } = response;
  if (body === null) return new Uint8Array(0);
  return 'text' in body
    ? new Uint8Array(utf8Encode(body.text))
    : base64ToBytes(body.base64);
};

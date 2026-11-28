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
 * An absolute `http:` or `https:` URL in the form the URL Standard's parser
 * writes one: a lowercase scheme and host, a port only where it isn't the
 * default, a path, and a query, of characters the parser leaves as they are.
 * Its host and port are checked further by isSerializedHttpUrl().
 */
const HTTP_URL =
  /^(https?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::([1-9][0-9]{0,4}))?(\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*)(?:\?[A-Za-z0-9\-._~!$&()*+,;=:@%/?]*)?$/;

/**
 * A path segment the parser removes or resolves: `.` or `..`, which it also
 * reads percent-encoded (`%2e`).
 */
const DOT_SEGMENT = /\/(?:\.|%2e){1,2}(?=\/|$)/i;

/** A host's last label that makes the parser read the host as IPv4 (`127.1`, `0x7f.0.0.1`). */
const NUMBER_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/i;

/** An IPv4 address as the parser writes one: four decimal parts, 0 to 255, without leading zeros. */
const IPV4 =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;

/**
 * Whether `new URL(url).href` would be `url` itself, which most of the URLs
 * an app requests are (`https://api.example.com/items?page=2`). The main
 * thread's `URL` is the runtime's JavaScript one (url/url.ts), and parsing
 * a URL with it cost about 0.1 ms of the main thread per request on the iOS
 * Simulator (#869), so the main thread's `fetch` and HttpClient's relay
 * (http-relay.ts) send a URL like this as it is, and parse any other.
 *
 * It's conservative: a URL it turns down may still be serialized, and goes
 * through the parser. It turns down a fragment, userinfo, a dot segment,
 * characters the parser percent-encodes, an uppercase scheme or host, a
 * default or zero-padded port, a host the parser reads as an IPv4 address
 * unless it's written as one (`127.1` becomes `127.0.0.1`), and a Punycode
 * label (`xn--`), which the parser checks.
 *
 * @param url - The URL.
 */
export const isSerializedHttpUrl = (url: string): boolean => {
  const match = HTTP_URL.exec(url);
  if (!match) return false;
  const [, scheme, host, port, path] = match as unknown as [
    string,
    string,
    string,
    string | undefined,
    string,
  ];
  if (DOT_SEGMENT.test(path)) return false;
  const labels = host.split('.');
  if (labels.some((label) => label.startsWith('xn--'))) return false;
  if (
    NUMBER_LABEL.test(labels[labels.length - 1] as string) &&
    !IPV4.test(host)
  ) {
    return false;
  }
  if (port !== undefined) {
    const value = Number(port);
    if (value > 65535 || value === (scheme === 'http' ? 80 : 443)) return false;
  }
  return true;
};

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

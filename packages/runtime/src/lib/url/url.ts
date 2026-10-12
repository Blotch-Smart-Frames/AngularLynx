import { parseHost } from './host';
import {
  FRAGMENT_SET,
  percentEncode,
  QUERY_SET,
  SPECIAL_QUERY_SET,
  USERINFO_SET,
} from './percent-encoding';
import {
  defaultPort,
  findPortColon,
  isSpecialScheme,
  parsePathStart,
  parsePort,
  parseUrl,
  serializePath,
  serializeUrl,
  type UrlRecord,
} from './url-record';
import { LINK_TO_URL, LynxURLSearchParams } from './url-search-params';

/**
 * `URL` for runtimes that don't have it, following the WHATWG URL Standard
 * (https://url.spec.whatwg.org/#url-class).
 *
 * Lynx's main thread (PrimJS) has no `URL` global, but Angular needs one:
 * since 22.2 the Router serializes every URL through
 * `new URL(url, 'http://fake')` to reject protocol-relative URLs, and treats
 * the `ReferenceError` as an unsafe URL. Every URL then serialized to `/`, so
 * each navigation looked like a navigation to the current URL and was
 * skipped. HttpClient and NgOptimizedImage's loaders use `URL` too.
 *
 * Known gaps, none of which Angular relies on: domains get lowercasing and
 * Punycode rather than the full UTS #46 mapping, `file:` URLs ignore Windows
 * drive letters, and `blob:` URLs only report the origin of an http(s) inner
 * URL.
 */
export class LynxURL {
  #url: UrlRecord;
  // One object for the URL's lifetime: `url.searchParams === url.searchParams`
  // in browsers, and code holding on to it must see later `search` changes.
  // `#linkSearchParams` refreshes its entries instead of replacing it.
  readonly #searchParams = new LynxURLSearchParams();

  constructor(
    url: string | { toString(): string },
    base?: string | { toString(): string },
  ) {
    this.#url = parseUrl(
      String(url),
      base === undefined ? undefined : parseUrl(String(base)),
    );
    this.#linkSearchParams();
  }

  static canParse(url: string, base?: string): boolean {
    try {
      new LynxURL(url, base);
      return true;
    } catch {
      return false;
    }
  }

  static parse(url: string, base?: string): LynxURL | null {
    try {
      return new LynxURL(url, base);
    } catch {
      return null;
    }
  }

  get href(): string {
    return serializeUrl(this.#url);
  }

  set href(value: string) {
    // `parseUrl` throws before the assignment, so an invalid `href` leaves the
    // URL unchanged and throws, as the native setter does.
    this.#url = parseUrl(String(value));
    this.#linkSearchParams();
  }

  get origin(): string {
    const { scheme, host, port } = this.#url;
    // A `blob:` URL created by a page carries that page's URL as its path, and
    // shares its origin, so blob URLs pass same-origin checks.
    if (scheme === 'blob') {
      const inner = LynxURL.parse(serializePath(this.#url));
      return inner && /^https?:$/.test(inner.protocol) ? inner.origin : 'null';
    }
    if (!isSpecialScheme(scheme) || scheme === 'file') return 'null';
    // Special URLs other than file: always have a host.
    return `${scheme}://${host as string}${port === null ? '' : `:${port}`}`;
  }

  get protocol(): string {
    return `${this.#url.scheme}:`;
  }

  set protocol(value: string) {
    // Browsers accept `https`, `https:` and even `https:anything`: only the
    // scheme before the first `:` is used. Anything else that isn't a valid
    // scheme leaves the URL unchanged.
    const match = /^([a-zA-Z][a-zA-Z0-9+\-.]*)(:|$)/.exec(
      String(value).replace(/[\t\n\r]/g, ''),
    );
    if (!match) return;
    const scheme = (match[1] as string).toLowerCase();
    const url = this.#url;
    // A URL can't switch between special and non-special schemes, since they
    // parse differently, nor become `file:` while it has credentials or a
    // port, which file URLs can't have.
    if (isSpecialScheme(url.scheme) !== isSpecialScheme(scheme)) return;
    if (
      scheme === 'file' &&
      (url.username !== '' || url.password !== '' || url.port !== null)
    ) {
      return;
    }
    if (url.scheme === 'file' && url.host === '') return;
    url.scheme = scheme;
    if (url.port === defaultPort(scheme)) url.port = null;
  }

  get username(): string {
    return this.#url.username;
  }

  set username(value: string) {
    if (this.#cannotHaveCredentialsOrPort()) return;
    this.#url.username = percentEncode(String(value), USERINFO_SET);
  }

  get password(): string {
    return this.#url.password;
  }

  set password(value: string) {
    if (this.#cannotHaveCredentialsOrPort()) return;
    this.#url.password = percentEncode(String(value), USERINFO_SET);
  }

  get host(): string {
    const { host, port } = this.#url;
    if (host === null) return '';
    return port === null ? host : `${host}:${port}`;
  }

  set host(value: string) {
    this.#setHost(String(value), true);
  }

  get hostname(): string {
    return this.#url.host ?? '';
  }

  set hostname(value: string) {
    this.#setHost(String(value), false);
  }

  get port(): string {
    return this.#url.port === null ? '' : String(this.#url.port);
  }

  set port(value: string) {
    if (this.#cannotHaveCredentialsOrPort()) return;
    const input = String(value).replace(/[\t\n\r]/g, '');
    if (input === '') {
      this.#url.port = null;
      return;
    }
    // Like browsers, take the leading digits and ignore the rest (`8080abc`).
    const digits = /^[0-9]+/.exec(input);
    if (!digits) return;
    try {
      this.#url.port = parsePort(this.#url.scheme, digits[0]);
    } catch {
      // Out of range: the setter leaves the port unchanged.
    }
  }

  get pathname(): string {
    return serializePath(this.#url);
  }

  set pathname(value: string) {
    const url = this.#url;
    if (typeof url.path === 'string') return;
    const input = String(value).replace(/[\t\n\r]/g, '');
    // A host-less URL keeps at least `/`, so `foo:/x` can't turn into an
    // opaque `foo:`.
    url.path =
      input === '' && url.host === null
        ? ['']
        : parsePathStart(input, isSpecialScheme(url.scheme));
  }

  get search(): string {
    const { query } = this.#url;
    return query === null || query === '' ? '' : `?${query}`;
  }

  set search(value: string) {
    // Setting `''` removes the query (no `?` left in `href`), and a leading
    // `?` is optional, as in browsers. Tabs and newlines are dropped like the
    // parser drops them.
    const input = String(value).replace(/[\t\n\r]/g, '');
    if (input === '') {
      this.#url.query = null;
    } else {
      this.#url.query = percentEncode(
        input.startsWith('?') ? input.slice(1) : input,
        isSpecialScheme(this.#url.scheme) ? SPECIAL_QUERY_SET : QUERY_SET,
      );
    }
    this.#linkSearchParams();
  }

  get searchParams(): LynxURLSearchParams {
    return this.#searchParams;
  }

  get hash(): string {
    const { fragment } = this.#url;
    return fragment === null || fragment === '' ? '' : `#${fragment}`;
  }

  set hash(value: string) {
    // Same rules as `search`: `''` removes the fragment, a leading `#` is
    // optional.
    const input = String(value).replace(/[\t\n\r]/g, '');
    this.#url.fragment =
      input === ''
        ? null
        : percentEncode(
            input.startsWith('#') ? input.slice(1) : input,
            FRAGMENT_SET,
          );
  }

  toString(): string {
    return this.href;
  }

  toJSON(): string {
    return this.href;
  }

  /**
   * URLs without a host, with an empty host, or `file:` URLs.
   */
  #cannotHaveCredentialsOrPort(): boolean {
    const { host, scheme } = this.#url;
    return host === null || host === '' || scheme === 'file';
  }

  /**
   * The `host` and `hostname` setters. Invalid input leaves the URL
   * unchanged, as the standard's setters do.
   */
  #setHost(value: string, withPort: boolean): void {
    const url = this.#url;
    if (typeof url.path === 'string') return;
    const special = isSpecialScheme(url.scheme);
    // Anything from the first path, query or fragment delimiter on is ignored.
    const input = value
      .replace(/[\t\n\r]/g, '')
      .split(special ? /[/\\?#]/ : /[/?#]/)[0] as string;
    if (url.scheme === 'file') {
      // File URLs have no port, so a `:` makes the host invalid.
      try {
        const host = input === '' ? '' : parseHost(input, false);
        url.host = host === 'localhost' ? '' : host;
      } catch {
        // Invalid host: unchanged.
      }
      return;
    }
    const colonIndex = findPortColon(input);
    // `hostname` doesn't take a port, so `hostname = 'a:1'` is ignored.
    if (colonIndex !== -1 && !withPort) return;
    const hostInput = colonIndex === -1 ? input : input.slice(0, colonIndex);
    if (hostInput === '') {
      // Special URLs need a host, and so does a port or credentials.
      if (
        special ||
        colonIndex !== -1 ||
        url.username !== '' ||
        url.password !== '' ||
        url.port !== null
      ) {
        return;
      }
    }
    try {
      url.host = parseHost(hostInput, !special);
    } catch {
      // Invalid host: unchanged.
      return;
    }
    if (colonIndex === -1) return;
    // As with the `port` setter, only the leading digits count, and an
    // out-of-range port is ignored (the new host is still kept).
    // `[0-9]*` always matches, possibly the empty string.
    const [digits] = /^[0-9]*/.exec(
      input.slice(colonIndex + 1),
    ) as RegExpExecArray;
    if (digits === '') return;
    try {
      url.port = parsePort(url.scheme, digits);
    } catch {
      // Out of range: port unchanged.
    }
  }

  /**
   * Points `searchParams` at the current query, and writes changes back.
   *
   * Called whenever the query is replaced (construction, `href`, `search`).
   * An empty serialization becomes no query at all, so removing the last
   * param doesn't leave a dangling `?` in `href`.
   */
  #linkSearchParams(): void {
    this.#searchParams[LINK_TO_URL](this.#url.query ?? '', (query) => {
      this.#url.query = query === '' ? null : query;
    });
  }
}

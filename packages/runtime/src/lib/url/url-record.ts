import { invalidUrl, parseHost } from './host';
import {
  C0_CONTROL_SET,
  FRAGMENT_SET,
  PATH_SET,
  percentEncode,
  QUERY_SET,
  SPECIAL_QUERY_SET,
  USERINFO_SET,
} from './percent-encoding';

/**
 * The parsed form of a URL: the standard's "URL record"
 * (https://url.spec.whatwg.org/#concept-url). `URL`'s getters and setters
 * read and replace its fields, and `serializeUrl` turns it back into `href`.
 *
 * Keeping the parsed fields, rather than re-parsing `href` on every access,
 * mirrors the standard's own model, which is what makes the setters'
 * documented behavior (each one changes one field and leaves the rest
 * alone) straightforward to follow.
 */
export type UrlRecord = {
  /** Lowercase, without the trailing `:`. */
  scheme: string;
  username: string;
  password: string;
  /** `null` when the URL has no authority (`mailto:x`, `foo:/path`). */
  host: string | null;
  /** `null` for no port, or for the scheme's default port. */
  port: number | null;
  /**
   * Path segments, serialized as `/` + each one. A string is an opaque path,
   * which non-special URLs without a `/` after the scheme have
   * (`mailto:someone@example.com`).
   */
  path: string[] | string;
  query: string | null;
  fragment: string | null;
};

// The special schemes and their default ports. A URL never stores its default
// port, so `http://a:80/` and `http://a/` are the same URL and origin.
const SPECIAL_SCHEME_PORTS: Readonly<Record<string, number | null>> = {
  ftp: 21,
  file: null,
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
};

/**
 * Special schemes get the web's URL rules: `\` works as `/`, the host is
 * required and lowercased, and the path is never empty.
 */
export const isSpecialScheme = (scheme: string): boolean =>
  Object.prototype.hasOwnProperty.call(SPECIAL_SCHEME_PORTS, scheme);

export const defaultPort = (scheme: string): number | null =>
  isSpecialScheme(scheme)
    ? (SPECIAL_SCHEME_PORTS[scheme] as number | null)
    : null;

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;

const isSlash = (char: string | undefined, special: boolean): boolean =>
  char === '/' || (special && char === '\\');

/**
 * Dot segments also count in their percent-encoded forms (`%2e`, `.%2E`), as
 * the standard requires. Otherwise `/a/%2e%2e/b` would keep a `..` segment
 * that a server decodes and resolves, while the URL claims a different path.
 */
const isSingleDot = (segment: string): boolean =>
  segment === '.' || segment.toLowerCase() === '%2e';

const isDoubleDot = (segment: string): boolean =>
  ['..', '.%2e', '%2e.', '%2e%2e'].includes(segment.toLowerCase());

/**
 * Splits off the query and fragment. Everything before them is the path (or
 * authority and path), which callers parse themselves.
 *
 * Splitting first matches the standard's parser, where `?` and `#` end the
 * authority and the path wherever they appear: in `http://a#b@c`, `a` is the
 * host and `b@c` the fragment, not credentials.
 */
const splitQueryAndFragment = (
  input: string,
  special: boolean,
): { rest: string; query: string | null; fragment: string | null } => {
  const hashIndex = input.indexOf('#');
  const fragment =
    hashIndex === -1
      ? null
      : percentEncode(input.slice(hashIndex + 1), FRAGMENT_SET);
  const beforeFragment = hashIndex === -1 ? input : input.slice(0, hashIndex);
  const queryIndex = beforeFragment.indexOf('?');
  const query =
    queryIndex === -1
      ? null
      : percentEncode(
          beforeFragment.slice(queryIndex + 1),
          special ? SPECIAL_QUERY_SET : QUERY_SET,
        );
  const rest =
    queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  return { rest, query, fragment };
};

/**
 * Appends the segments of `path` to `segments`, resolving `.` and `..` (also
 * in their percent-encoded forms). `path` excludes the slash that starts it.
 */
const appendPath = (
  segments: string[],
  path: string,
  special: boolean,
): string[] => {
  const parts = path.split(special ? /[/\\]/ : '/');
  parts.forEach((part, index) => {
    // A trailing `.` or `..` keeps a trailing slash, so `/a/b/..` is `/a/`.
    const isLast = index === parts.length - 1;
    if (isDoubleDot(part)) {
      segments.pop();
      if (isLast) segments.push('');
    } else if (isSingleDot(part)) {
      if (isLast) segments.push('');
    } else {
      segments.push(percentEncode(part, PATH_SET));
    }
  });
  return segments;
};

/**
 * Parses the path that follows a host (or an absolute path), starting with
 * its optional leading slash. Special URLs always get at least `/`; other
 * URLs keep an empty path empty (`foo://host`).
 */
export const parsePathStart = (path: string, special: boolean): string[] => {
  if (special) {
    return appendPath([], isSlash(path[0], true) ? path.slice(1) : path, true);
  }
  if (path === '') return [];
  return appendPath([], path.startsWith('/') ? path.slice(1) : path, false);
};

/**
 * Parses `[user[:password]@]host[:port]`, then the path, query and fragment.
 */
const parseAuthority = (scheme: string, input: string): UrlRecord => {
  const special = isSpecialScheme(scheme);
  const { rest, query, fragment } = splitQueryAndFragment(input, special);
  const authorityEnd = rest.search(special ? /[/\\]/ : /\//);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const path = authorityEnd === -1 ? '' : rest.slice(authorityEnd);

  // The last `@` ends the credentials, so an unencoded `@` in a password
  // still parses (`http://a:p@ss@host`).
  const atIndex = authority.lastIndexOf('@');
  let username = '';
  let password = '';
  if (atIndex !== -1) {
    const userinfo = authority.slice(0, atIndex);
    const colonIndex = userinfo.indexOf(':');
    username = percentEncode(
      colonIndex === -1 ? userinfo : userinfo.slice(0, colonIndex),
      USERINFO_SET,
    );
    if (colonIndex !== -1) {
      password = percentEncode(userinfo.slice(colonIndex + 1), USERINFO_SET);
    }
  }
  const hostAndPort = authority.slice(atIndex + 1);
  const colonIndex = findPortColon(hostAndPort);
  const hostInput =
    colonIndex === -1 ? hostAndPort : hostAndPort.slice(0, colonIndex);
  // A URL with credentials or a port must have a host, and special URLs
  // (other than file:, parsed separately) always must.
  if (hostInput === '' && (special || atIndex !== -1 || colonIndex !== -1)) {
    throw invalidUrl();
  }
  return {
    scheme,
    username,
    password,
    host: parseHost(hostInput, !special),
    port:
      colonIndex === -1
        ? null
        : parsePort(scheme, hostAndPort.slice(colonIndex + 1)),
    path: parsePathStart(path, special),
    query,
    fragment,
  };
};

/**
 * Finds the `:` that starts the port in `host[:port]`: the first one outside
 * an IPv6 literal's brackets. Returns -1 when there is no port.
 */
export const findPortColon = (input: string): number => {
  let insideBrackets = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '[') insideBrackets = true;
    if (char === ']') insideBrackets = false;
    if (char === ':' && !insideBrackets) return index;
  }
  return -1;
};

/**
 * Parses a port, dropping the scheme's default port as browsers do.
 *
 * Only digits are accepted, and anything above 65535 fails: a port the
 * standard rejects must not turn into a different, valid one.
 */
export const parsePort = (scheme: string, input: string): number | null => {
  if (input === '') return null;
  if (!/^[0-9]+$/.test(input)) throw invalidUrl();
  const port = parseInt(input, 10);
  if (port > 65535) throw invalidUrl();
  return port === defaultPort(scheme) ? null : port;
};

/**
 * A copy of `base` without its path, query and fragment.
 */
const withBaseAuthority = (base: UrlRecord): UrlRecord => ({
  ...base,
  path: [],
  query: null,
  fragment: null,
});

/**
 * Resolves `input`, which has no scheme, against `base`: the standard's
 * "relative state".
 */
const parseRelative = (input: string, base: UrlRecord): UrlRecord => {
  const special = isSpecialScheme(base.scheme);
  if (isSlash(input[0], special)) {
    if (isSlash(input[1], special)) {
      // A scheme-relative URL (`//host/path`). Special URLs skip any number
      // of slashes before the host, as browsers do.
      return parseAuthority(
        base.scheme,
        special ? input.replace(/^[/\\]+/, '') : input.slice(2),
      );
    }
    const { rest, query, fragment } = splitQueryAndFragment(input, special);
    return {
      ...withBaseAuthority(base),
      path: parsePathStart(rest, special),
      query,
      fragment,
    };
  }
  const { rest, query, fragment } = splitQueryAndFragment(input, special);
  const basePath = (base.path as string[]).slice();
  if (rest === '') {
    // Only a query and/or fragment (or nothing): keep the base's path, and
    // its query too when the input has no query of its own.
    return { ...base, path: basePath, query: query ?? base.query, fragment };
  }
  basePath.pop();
  return {
    ...withBaseAuthority(base),
    path: appendPath(basePath, rest, special),
    query,
    fragment,
  };
};

/**
 * Parses a `file:` URL. File URLs have a host (possibly empty), and a
 * `localhost` host is the same as none. Windows drive-letter quirks are not
 * modeled: Lynx apps don't get Windows file paths.
 */
const parseFile = (input: string, base: UrlRecord | undefined): UrlRecord => {
  if (isSlash(input[0], true) && isSlash(input[1], true)) {
    const afterSlashes = input.slice(2);
    const hostEnd = afterSlashes.search(/[/\\?#]/);
    const hostInput =
      hostEnd === -1 ? afterSlashes : afterSlashes.slice(0, hostEnd);
    const host = hostInput === '' ? '' : parseHost(hostInput, false);
    const { rest, query, fragment } = splitQueryAndFragment(
      hostEnd === -1 ? '' : afterSlashes.slice(hostEnd),
      true,
    );
    return {
      scheme: 'file',
      username: '',
      password: '',
      host: host === 'localhost' ? '' : host,
      port: null,
      path: parsePathStart(rest, true),
      query,
      fragment,
    };
  }
  if (base?.scheme === 'file') return parseRelative(input, base);
  const { rest, query, fragment } = splitQueryAndFragment(input, true);
  return {
    scheme: 'file',
    username: '',
    password: '',
    host: '',
    port: null,
    path: parsePathStart(rest, true),
    query,
    fragment,
  };
};

/**
 * The basic URL parser (https://url.spec.whatwg.org/#concept-basic-url-parser).
 * Throws `TypeError: Invalid URL` where the standard returns failure.
 */
export const parseUrl = (rawInput: string, base?: UrlRecord): UrlRecord => {
  // Leading and trailing C0 controls and spaces are dropped, and tabs and
  // newlines are ignored anywhere, so a URL wrapped across lines still parses.
  const input = rawInput
    // oxlint-disable-next-line no-control-regex -- the standard trims C0 controls and spaces
    .replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
    .replace(/[\t\n\r]/g, '');

  const schemeMatch = SCHEME.exec(input);
  if (schemeMatch) {
    const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
    const rest = input.slice(schemeMatch[0].length);
    if (scheme === 'file') return parseFile(rest, base);
    if (isSpecialScheme(scheme)) {
      // Against a base with the same scheme, only `//` starts a host:
      // `http:path` and `http:/path` resolve against the base like `path`
      // and `/path` would.
      if (base?.scheme === scheme && !rest.startsWith('//')) {
        return parseRelative(rest, base);
      }
      // Otherwise any run of slashes and backslashes before the host is
      // skipped, so `http:example.com` and `http:\\example.com` parse like
      // `http://example.com`, as in browsers.
      return parseAuthority(scheme, rest.replace(/^[/\\]*/, ''));
    }
    if (rest.startsWith('//')) return parseAuthority(scheme, rest.slice(2));
    const { rest: path, query, fragment } = splitQueryAndFragment(rest, false);
    return {
      scheme,
      username: '',
      password: '',
      host: null,
      port: null,
      path: path.startsWith('/')
        ? parsePathStart(path, false)
        : percentEncode(path, C0_CONTROL_SET),
      query,
      fragment,
    };
  }

  if (!base) throw invalidUrl();
  if (typeof base.path === 'string') {
    // An opaque base (`mailto:x`) can only take a fragment.
    if (!input.startsWith('#')) throw invalidUrl();
    return { ...base, fragment: percentEncode(input.slice(1), FRAGMENT_SET) };
  }
  if (base.scheme === 'file') return parseFile(input, base);
  return parseRelative(input, base);
};

/**
 * Serializes the path as `pathname` reports it: an opaque path as written,
 * otherwise `/` before each segment, so `['a', '']` is `/a/`.
 */
export const serializePath = ({ path }: UrlRecord): string =>
  typeof path === 'string'
    ? path
    : path.map((segment) => `/${segment}`).join('');

/**
 * The URL serializer (https://url.spec.whatwg.org/#concept-url-serializer).
 *
 * Its output is `href`, and parsing it again gives the same record, which is
 * what lets code compare URLs by their `href`.
 */
export const serializeUrl = (url: UrlRecord): string => {
  let output = `${url.scheme}:`;
  if (url.host !== null) {
    output += '//';
    if (url.username !== '' || url.password !== '') {
      output += url.username;
      if (url.password !== '') output += `:${url.password}`;
      output += '@';
    }
    output += url.host;
    if (url.port !== null) output += `:${url.port}`;
  } else if (
    typeof url.path !== 'string' &&
    url.path.length > 1 &&
    url.path[0] === ''
  ) {
    // Without this, `foo:/.//bar` would serialize to `foo://bar`, whose
    // `bar` would then parse as a host.
    output += '/.';
  }
  output += serializePath(url);
  if (url.query !== null) output += `?${url.query}`;
  if (url.fragment !== null) output += `#${url.fragment}`;
  return output;
};

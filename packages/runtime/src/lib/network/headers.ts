/**
 * The Fetch Standard's `Headers` for Lynx's main thread, which has no Fetch
 * API. Angular's `FetchBackend` reads a response's headers through it
 * (`response.headers.get('content-type')`, and `new HttpHeaders(headers)`,
 * which iterates anything that is `instanceof Headers`).
 */

export type HeadersInit =
  | LynxHeaders
  | Iterable<readonly [string, string]>
  | Record<string, string>;

/** RFC 9110's `token`: the characters a header name may use. */
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const normalizeValue = (value: unknown): string => {
  // Leading and trailing HTTP whitespace is dropped, as browsers do.
  const normalized = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  if (/[\r\n]/.test(normalized) || normalized.includes('\0')) {
    throw new TypeError(`Invalid header value: ${JSON.stringify(value)}`);
  }
  return normalized;
};

const normalizeName = (name: unknown): string => {
  const normalized = String(name);
  if (!NAME.test(normalized)) {
    throw new TypeError(`Invalid header name: ${JSON.stringify(name)}`);
  }
  return normalized.toLowerCase();
};

export class LynxHeaders {
  /** Each header in the order it was added, with its name lowercased. */
  #list: [name: string, value: string][] = [];

  constructor(init?: HeadersInit | null) {
    if (init == null) return;
    if (init instanceof LynxHeaders) {
      this.#list = init.#list.map(([name, value]) => [name, value]);
    } else if (typeof (init as any)[Symbol.iterator] === 'function') {
      for (const pair of init as Iterable<readonly string[]>) {
        if (pair.length !== 2) {
          throw new TypeError(
            "Failed to construct 'Headers': Invalid value: each header must be a [name, value] pair",
          );
        }
        this.append(pair[0] as string, pair[1] as string);
      }
    } else {
      for (const name of Object.keys(init)) {
        this.append(name, (init as Record<string, string>)[name] as string);
      }
    }
  }

  append(name: string, value: string): void {
    this.#list.push([normalizeName(name), normalizeValue(value)]);
  }

  delete(name: string): void {
    const key = normalizeName(name);
    this.#list = this.#list.filter(([listed]) => listed !== key);
  }

  /**
   * The header's values joined with ", ", or null if it isn't set.
   */
  get(name: string): string | null {
    const key = normalizeName(name);
    const values = this.#list
      .filter(([listed]) => listed === key)
      .map(([, value]) => value);
    return values.length > 0 ? values.join(', ') : null;
  }

  /**
   * Each `Set-Cookie` value: the one header that can't be joined.
   */
  getSetCookie(): string[] {
    return this.#list
      .filter(([name]) => name === 'set-cookie')
      .map(([, value]) => value);
  }

  has(name: string): boolean {
    const key = normalizeName(name);
    return this.#list.some(([listed]) => listed === key);
  }

  set(name: string, value: string): void {
    const key = normalizeName(name);
    const index = this.#list.findIndex(([listed]) => listed === key);
    if (index === -1) {
      this.append(key, value);
      return;
    }
    // The first entry keeps its place and takes the value; the rest go.
    this.#list[index] = [key, normalizeValue(value)];
    this.#list = this.#list.filter(
      ([listed], i) => listed !== key || i === index,
    );
  }

  forEach(
    callback: (value: string, name: string, parent: LynxHeaders) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of this.entries()) {
      callback.call(thisArg, value, name, this);
    }
  }

  /**
   * The headers sorted by name, with each name's values joined, except
   * `Set-Cookie`, which is listed once per value, as the standard says.
   */
  *entries(): IterableIterator<[string, string]> {
    const names = [...new Set(this.#list.map(([name]) => name))].sort();
    for (const name of names) {
      if (name === 'set-cookie') {
        for (const value of this.getSetCookie()) yield [name, value];
      } else {
        yield [name, this.get(name) as string];
      }
    }
  }

  *keys(): IterableIterator<string> {
    for (const [name] of this.entries()) yield name;
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

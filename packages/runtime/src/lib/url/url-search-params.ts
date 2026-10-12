import { formUrlEncode, percentDecode } from './percent-encoding';

type Entry = [name: string, value: string];

export type URLSearchParamsInit =
  | string
  | Iterable<readonly unknown[]>
  | Record<string, unknown>
  | LynxURLSearchParams
  | null;

/**
 * Parses `application/x-www-form-urlencoded` (`a=1&b=x+y`).
 *
 * `+` becomes a space before percent-decoding, so an escaped plus (`%2B`)
 * still decodes to a literal `+`.
 */
const parseQuery = (query: string): Entry[] =>
  query
    .split('&')
    .filter((sequence) => sequence !== '')
    .map((sequence) => {
      const equalsIndex = sequence.indexOf('=');
      const name =
        equalsIndex === -1 ? sequence : sequence.slice(0, equalsIndex);
      const value = equalsIndex === -1 ? '' : sequence.slice(equalsIndex + 1);
      return [
        percentDecode(name.replace(/\+/g, ' ')),
        percentDecode(value.replace(/\+/g, ' ')),
      ];
    });

/**
 * Lets the owning `URL` keep its query and its `searchParams` in sync without
 * exposing a public method for it. Only url.ts imports it.
 *
 * A symbol rather than a `#private` method because `#private` members can't be
 * reached from another class, and a named method would add non-standard API
 * that app code could start relying on.
 */
export const LINK_TO_URL = Symbol('linkToUrl');

/**
 * `URLSearchParams` for runtimes that don't have it (Lynx's main thread), per
 * the WHATWG URL Standard (https://url.spec.whatwg.org/#interface-urlsearchparams).
 *
 * The iterators return a snapshot of the entries rather than a live view.
 * Code iterates the params straight away in practice, and snapshots avoid
 * the bookkeeping a live iterator needs when the list changes mid-iteration.
 *
 * Every name and value goes through `String()`, as the WebIDL conversion of
 * the native class's arguments does, so `params.set('page', 2)` stores `'2'`.
 */
export class LynxURLSearchParams {
  #entries: Entry[] = [];
  /** Writes the serialized params back to the owning URL's query. */
  #updateUrl: ((query: string) => void) | undefined;

  constructor(init: URLSearchParamsInit = '') {
    // Anything but an object is converted to a string, so `null` is the
    // query `null`, as in browsers.
    if (typeof init !== 'object' || init === null) {
      const query = String(init);
      this.#entries = parseQuery(
        query.startsWith('?') ? query.slice(1) : query,
      );
    } else if (
      typeof (init as Iterable<unknown>)[Symbol.iterator] === 'function'
    ) {
      for (const pair of init as Iterable<readonly unknown[]>) {
        const items = Array.from(pair);
        if (items.length !== 2) {
          throw new TypeError(
            "Failed to construct 'URLSearchParams': Each query pair must be an iterable [name, value] tuple",
          );
        }
        this.#entries.push([String(items[0]), String(items[1])]);
      }
    } else {
      for (const name of Object.keys(init)) {
        this.#entries.push([
          name,
          String((init as Record<string, unknown>)[name]),
        ]);
      }
    }
  }

  /**
   * Called by the owning URL: replaces the entries with those of `query`, and
   * registers `updateUrl` to receive every later change.
   */
  [LINK_TO_URL](query: string, updateUrl: (query: string) => void): void {
    this.#entries = parseQuery(query);
    this.#updateUrl = updateUrl;
  }

  get size(): number {
    return this.#entries.length;
  }

  append(name: string, value: string): void {
    this.#entries.push([String(name), String(value)]);
    this.#update();
  }

  delete(name: string, value?: string): void {
    const match = (entry: Entry) =>
      entry[0] === String(name) &&
      (value === undefined || entry[1] === String(value));
    this.#entries = this.#entries.filter((entry) => !match(entry));
    this.#update();
  }

  get(name: string): string | null {
    const entry = this.#entries.find(
      (candidate) => candidate[0] === String(name),
    );
    return entry ? entry[1] : null;
  }

  getAll(name: string): string[] {
    return this.#entries
      .filter((entry) => entry[0] === String(name))
      .map((entry) => entry[1]);
  }

  has(name: string, value?: string): boolean {
    return this.#entries.some(
      (entry) =>
        entry[0] === String(name) &&
        (value === undefined || entry[1] === String(value)),
    );
  }

  /**
   * Sets the first entry named `name` to `value` and removes the others, or
   * appends one if there is none.
   */
  set(name: string, value: string): void {
    const key = String(name);
    const index = this.#entries.findIndex((entry) => entry[0] === key);
    if (index === -1) {
      this.#entries.push([key, String(value)]);
    } else {
      this.#entries[index] = [key, String(value)];
      this.#entries = this.#entries.filter(
        (entry, entryIndex) => entryIndex <= index || entry[0] !== key,
      );
    }
    this.#update();
  }

  /**
   * Stable-sorts by name, comparing UTF-16 code units as the standard does.
   *
   * Entries are tagged with their position to break ties, because
   * `Array.prototype.sort` was only required to be stable from ES2019, and
   * entries with the same name must keep their order.
   */
  sort(): void {
    this.#entries = this.#entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) =>
        a.entry[0] < b.entry[0]
          ? -1
          : a.entry[0] > b.entry[0]
            ? 1
            : a.index - b.index,
      )
      .map(({ entry }) => entry);
    this.#update();
  }

  forEach(
    callback: (value: string, name: string, params: this) => void,
    thisArg?: unknown,
  ): void {
    // A copy, so a callback that changes the params can't skip or repeat
    // entries.
    for (const [name, value] of this.#entries.slice()) {
      callback.call(thisArg, value, name, this);
    }
  }

  entries(): IterableIterator<[string, string]> {
    return this.#entries
      .map((entry): [string, string] => [entry[0], entry[1]])
      [Symbol.iterator]();
  }

  keys(): IterableIterator<string> {
    return this.#entries.map((entry) => entry[0])[Symbol.iterator]();
  }

  values(): IterableIterator<string> {
    return this.#entries.map((entry) => entry[1])[Symbol.iterator]();
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  toString(): string {
    return this.#entries
      .map(([name, value]) => `${formUrlEncode(name)}=${formUrlEncode(value)}`)
      .join('&');
  }

  /**
   * Writes every change back to the owning URL's query, so `url.href`
   * reflects `url.searchParams.set(...)` right away, as in browsers.
   */
  #update(): void {
    this.#updateUrl?.(this.toString());
  }
}

import {
  type CollationData,
  type CollationTable,
  DECOMPOSED,
  EXPANSION_SECONDARY,
  EXPANSION_TERTIARY_BUMP,
  UNASSIGNED,
  WEIGHT_WIDTH,
} from './collation-format.js';

/**
 * `Intl.Collator` for Lynx, which has none and whose `localeCompare` returns
 * the difference of the first differing UTF-16 code units (`'é'.localeCompare('z')`
 * is 111). FormatJS has no Collator polyfill, so this one sorts with the
 * weights the build took from ICU (collation-data.ts): the Unicode Collation
 * Algorithm's three levels, for the characters in its tables, with each
 * locale's own order of letters.
 */

/** A collation element: one character's (or contraction's) weights. */
type Element = {
  readonly primary: number;
  readonly secondary: number;
  readonly tertiary: number;
  /** Whether the character is uppercase, for `caseFirst` and the case level. */
  readonly upper: boolean;
  /** With `numeric`, the digits of a number, without leading zeros. */
  readonly digits?: string;
};

/** A decoded {@link CollationTable}. */
type Table = {
  /**
   * By code point: the element, or the characters it sorts as, or nothing
   * for a code point outside the table, or that it's unassigned.
   */
  readonly lookup: (
    codePoint: number,
  ) => Element | SortsAs | { readonly unassigned: true } | undefined;
  readonly contractions: ReadonlyMap<string, Element>;
  readonly caseFirst: 'upper' | 'lower' | 'false';
  /** The primary weight of a character outside the table. */
  readonly outsidePrimary: (codePoint: number) => number;
};

type SortsAs = {
  readonly parts: string;
  /**
   * The level it follows its parts at: the secondary for `æ` (after `ae`),
   * the tertiary for `ﬁ` (after `fi`), or none for `é`, which is `e` +
   * U+0301 in another form.
   */
  readonly follows?: 2 | 3;
};

/**
 * Where the primary weights of unassigned code points start: after
 * everything else, by code point.
 */
const OUTSIDE_PRIMARY = 36 ** 3;

const MAX_CODE_POINT = 0x10ffff;

const decodeElement = (
  weights: string,
  offset: number,
  upper: boolean,
): Element => ({
  primary: parseInt(weights.slice(offset, offset + 3), 36),
  secondary: parseInt(weights.slice(offset + 3, offset + 5), 36),
  tertiary: parseInt(weights.slice(offset + 5, offset + 7), 36),
  upper,
});

const isUpper = (char: string): boolean => char !== char.toLowerCase();

const decodeTable = (data: CollationData, table: CollationTable): Table => {
  // The index of each range's first code point.
  const starts: number[] = [];
  let count = 0;
  for (const [first, last] of data.r) {
    starts.push(count);
    count += last - first + 1;
  }
  const hanPrimary = table.b[data.k.findIndex(([first]) => first === 0x4e00)]!;
  // Each code point's weights' offset in `w`, or a marker. The weights have
  // a fixed width and the markers are one character, so `w` is read once,
  // here, rather than searched on every lookup.
  const offsets = new Int32Array(count);
  for (let index = 0, offset = 0; index < count; index++) {
    const marker = table.w[offset];
    if (marker === UNASSIGNED) {
      offsets[index] = -1;
      offset++;
    } else if (marker === DECOMPOSED) {
      offsets[index] = -2;
      offset++;
    } else {
      offsets[index] = offset;
      offset += WEIGHT_WIDTH;
    }
  }
  // Each code point's answer, worked out once.
  const found = new Map<number, ReturnType<Table['lookup']>>();
  const find = (codePoint: number): ReturnType<Table['lookup']> => {
    for (let range = 0; range < data.r.length; range++) {
      const [first, last] = data.r[range]!;
      if (codePoint < first || codePoint > last) continue;
      const offset = offsets[starts[range]! + codePoint - first]!;
      // Unassigned: after everything, as ICU sorts them.
      if (offset === -1) return { unassigned: true };
      const char = String.fromCodePoint(codePoint);
      if (offset === -2) {
        const expansion = table.x[char];
        return expansion === undefined
          ? { parts: data.d[char]! }
          : {
              parts: expansion.slice(1),
              follows: expansion[0] === '2' ? 2 : 3,
            };
      }
      return decodeElement(table.w, offset, isUpper(char));
    }
    return undefined;
  };
  return {
    lookup: (codePoint) => {
      if (!found.has(codePoint)) found.set(codePoint, find(codePoint));
      return found.get(codePoint);
    },
    contractions: new Map(
      Object.entries(table.c).map(([pair, weights]) => [
        pair,
        decodeElement(weights, 0, isUpper(pair[0]!)),
      ]),
    ),
    caseFirst: table.f,
    outsidePrimary: (codePoint) => {
      const block = data.k.findIndex(
        ([first, last]) => codePoint >= first && codePoint <= last,
      );
      if (block >= 0) {
        // Between the block's first character's weight and the next weight.
        const [first, last] = data.k[block]!;
        return table.b[block]! + (codePoint - first) / (last - first + 1);
      }
      // Other scripts sort before the Han ideographs in ICU, so just
      // before the main block's weight, by code point.
      return hanPrimary - 1 + (codePoint + 1) / (MAX_CODE_POINT + 2);
    },
  };
};

const PUNCTUATION_OR_SPACE = /^[\p{P}\p{Z}]$/u;
const DIGIT = /^[0-9]$/;

type ResolvedCollatorOptions = {
  readonly locale: string;
  readonly usage: 'sort' | 'search';
  readonly sensitivity: 'base' | 'accent' | 'case' | 'variant';
  readonly ignorePunctuation: boolean;
  readonly collation: 'default';
  readonly numeric: boolean;
  readonly caseFirst: 'upper' | 'lower' | 'false';
};

/**
 * The collation elements of `text`, as the Unicode Collation Algorithm
 * builds them: contractions first, then each character, or the characters
 * it sorts as.
 */
const elementsOf = (
  text: string,
  table: Table,
  options: ResolvedCollatorOptions,
): Element[] => {
  const elements: Element[] = [];
  const pushChar = (char: string, upper: boolean): void => {
    const codePoint = char.codePointAt(0)!;
    const found = table.lookup(codePoint);
    if (found === undefined || 'unassigned' in found) {
      elements.push({
        primary:
          found === undefined
            ? table.outsidePrimary(codePoint)
            : OUTSIDE_PRIMARY + codePoint,
        secondary: 1,
        tertiary: 1,
        upper,
      });
    } else if ('parts' in found) {
      // The case is the original character's: `É` is uppercase `e` + U+0301.
      const first = elements.length;
      for (const part of found.parts) pushChar(part, upper);
      if (found.follows === 2) {
        elements.splice(first + 1, 0, {
          primary: 0,
          secondary: EXPANSION_SECONDARY,
          tertiary: 1,
          upper: false,
        });
      } else if (found.follows === 3) {
        const last = elements[elements.length - 1]!;
        elements[elements.length - 1] = {
          ...last,
          tertiary: last.tertiary + EXPANSION_TERTIARY_BUMP,
        };
      }
    } else {
      elements.push({ ...found, upper });
    }
  };
  const chars = [...text];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    const next = chars[index + 1];
    if (next !== undefined && table.contractions.size > 0) {
      const contraction = table.contractions.get(char + next);
      if (contraction) {
        elements.push(contraction);
        index++;
        continue;
      }
    }
    if (options.numeric && DIGIT.test(char)) {
      let digits = char;
      while (DIGIT.test(chars[index + 1] ?? '')) digits += chars[++index];
      const zero = table.lookup(48) as Element;
      elements.push({ ...zero, digits: digits.replace(/^0+(?=.)/, '') });
      continue;
    }
    if (options.ignorePunctuation && PUNCTUATION_OR_SPACE.test(char)) {
      continue;
    }
    pushChar(char, isUpper(char));
  }
  return elements;
};

const sign = (value: number): number => (value < 0 ? -1 : value > 0 ? 1 : 0);

/**
 * A string's weights level by level, each without its zeros, as the Unicode
 * Collation Algorithm's sort key has them. Built once per string, so a sort
 * compares arrays of numbers.
 */
type SortKey = {
  readonly primary: readonly number[];
  /** With `numeric`, the digits of each primary weight that's a number. */
  readonly digits: readonly (string | undefined)[];
  /** Whether each primary weight's character is uppercase. */
  readonly upper: readonly boolean[];
  readonly secondary: readonly number[];
  readonly tertiary: readonly number[];
};

const sortKey = (elements: readonly Element[]): SortKey => {
  const key = {
    primary: [] as number[],
    digits: [] as (string | undefined)[],
    upper: [] as boolean[],
    secondary: [] as number[],
    tertiary: [] as number[],
  };
  for (const element of elements) {
    if (element.primary !== 0) {
      key.primary.push(element.primary);
      key.digits.push(element.digits);
      key.upper.push(element.upper);
    }
    if (element.secondary !== 0) key.secondary.push(element.secondary);
    if (element.tertiary !== 0) key.tertiary.push(element.tertiary);
  }
  return key;
};

/**
 * Compares two levels' weights, the way strings compare.
 */
const compareWeights = (a: readonly number[], b: readonly number[]): number => {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return sign(a[index]! - b[index]!);
  }
  return sign(a.length - b.length);
};

const comparePrimary = (a: SortKey, b: SortKey): number => {
  const length = Math.min(a.primary.length, b.primary.length);
  for (let index = 0; index < length; index++) {
    const x = a.digits[index];
    const y = b.digits[index];
    if (x !== undefined && y !== undefined) {
      const order = x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
      if (order !== 0) return sign(order);
    } else if (a.primary[index] !== b.primary[index]) {
      return sign(a.primary[index]! - b.primary[index]!);
    }
  }
  return sign(a.primary.length - b.primary.length);
};

/**
 * Compares `a` and `b` as a collator with `options` does.
 */
const compareKeys = (
  a: SortKey,
  b: SortKey,
  options: ResolvedCollatorOptions,
): number => {
  const primary = comparePrimary(a, b);
  if (primary !== 0 || options.sensitivity === 'base') return primary;
  /**
   * With caseFirst, case decides before the other tertiary differences:
   * uppercase first for 'upper', lowercase for 'lower'.
   */
  const caseWeights = (key: SortKey): number[] =>
    key.upper.map((upper) =>
      (options.caseFirst === 'upper') !== upper ? 2 : 1,
    );
  if (options.sensitivity === 'case') {
    return compareWeights(caseWeights(a), caseWeights(b));
  }
  const secondary = compareWeights(a.secondary, b.secondary);
  if (secondary !== 0 || options.sensitivity === 'accent') return secondary;
  if (options.caseFirst !== 'false') {
    const byCase = compareWeights(caseWeights(a), caseWeights(b));
    if (byCase !== 0) return byCase;
  }
  return compareWeights(a.tertiary, b.tertiary);
};

const SENSITIVITIES = ['base', 'accent', 'case', 'variant'] as const;
const CASE_FIRSTS = ['upper', 'lower', 'false'] as const;

/**
 * Reads a string option the way ECMA-402's GetOption does.
 */
const stringOption = <T extends string>(
  options: Record<string, unknown>,
  name: string,
  values: readonly T[],
): T | undefined => {
  const value = options[name];
  if (value === undefined) return undefined;
  const text = String(value) as T;
  if (!values.includes(text)) {
    throw new RangeError(
      `Value ${text} out of range for Intl.Collator options property ${name}`,
    );
  }
  return text;
};

export type CollatorEnvironment = {
  readonly data: CollationData;
  /**
   * The locale to use when none of the requested ones has a table: the
   * phone's language, if the app has data for it, or else its source locale.
   */
  readonly defaultLocale: (available: ReadonlySet<string>) => string;
  readonly canonicalize: (locales: unknown) => string[];
};

/**
 * The tags a locale's table also serves: `de-CH` serves `de` too, unless
 * `de` is in the data itself, as in FormatJS.
 */
const availableLocales = (data: CollationData): Map<string, number> => {
  const available = new Map<string, number>();
  for (const [locale, table] of Object.entries(data.l)) {
    available.set(locale, table);
  }
  for (const [locale, table] of Object.entries(data.l)) {
    const parts = locale.split('-');
    while (parts.length > 1) {
      parts.pop();
      const fallback = parts.join('-');
      if (!available.has(fallback)) available.set(fallback, table);
    }
  }
  return available;
};

/**
 * The longest available prefix of `tag` (ECMA-402's BestAvailableLocale).
 */
const bestAvailable = (
  available: ReadonlyMap<string, number>,
  tag: string,
): string | undefined => {
  const parts = tag.split('-');
  while (parts.length > 0) {
    const candidate = parts.join('-');
    if (available.has(candidate)) return candidate;
    parts.pop();
  }
  return undefined;
};

/**
 * Splits off a tag's Unicode extension (`-u-kn-true`) and reads its keywords,
 * where `kn` alone means `kn-true`.
 */
const parseExtension = (tag: string) => {
  const keywords = new Map<string, string>();
  const match = /^(.*?)-u((?:-[a-z0-9]{2,8})+?)(?=-[a-wy-z0-9]-|$)/i.exec(tag);
  if (!match) return { base: tag, keywords };
  let key: string | undefined;
  for (const part of match[2]!.slice(1).split('-')) {
    if (part.length === 2) {
      key = part.toLowerCase();
      keywords.set(key, 'true');
    } else if (key !== undefined) {
      const value = keywords.get(key)!;
      keywords.set(key, value === 'true' ? part : `${value}-${part}`);
    }
  }
  return { base: match[1]!, keywords };
};

/**
 * Creates the `Intl.Collator` constructor for `environment`.
 */
export const createCollator = (environment: CollatorEnvironment) => {
  const available = availableLocales(environment.data);
  const tables = new Map<number, Table>();
  const tableFor = (locale: string): Table => {
    const index = available.get(locale)!;
    let table = tables.get(index);
    if (!table) {
      table = decodeTable(environment.data, environment.data.t[index]!);
      tables.set(index, table);
    }
    return table;
  };
  const internals = new WeakMap<
    object,
    {
      options: ResolvedCollatorOptions;
      table: Table;
      keys: Map<string, SortKey>;
      bound?: (a: unknown, b: unknown) => number;
    }
  >();
  const internalsOf = (collator: unknown, method: string) => {
    const slots =
      collator !== null && typeof collator === 'object'
        ? internals.get(collator)
        : undefined;
    if (!slots) {
      throw new TypeError(
        `Method Intl.Collator.prototype.${method} called on incompatible receiver ${String(collator)}`,
      );
    }
    return slots;
  };

  const Collator = function Collator(
    this: unknown,
    locales?: string | readonly string[],
    options?: Record<string, unknown>,
  ): object {
    if (!(this instanceof Collator)) {
      return new (Collator as any)(locales, options);
    }
    const requested = environment.canonicalize(locales);
    const opts =
      options === undefined ? {} : (Object(options) as Record<string, unknown>);
    const usage = stringOption(opts, 'usage', ['sort', 'search']) ?? 'sort';
    stringOption(opts, 'localeMatcher', ['lookup', 'best fit']);
    let numericOption =
      opts['numeric'] === undefined ? undefined : Boolean(opts['numeric']);
    let caseFirstOption = stringOption(opts, 'caseFirst', CASE_FIRSTS);
    let locale: string | undefined;
    for (const tag of requested) {
      const { base, keywords } = parseExtension(tag);
      const found = bestAvailable(available, base);
      if (found === undefined) continue;
      locale = found;
      // Options win over the tag's extension keywords, which are echoed in
      // the resolved locale only when they're the ones that count.
      const kn = keywords.get('kn');
      const kf = keywords.get('kf');
      const echoed: string[] = [];
      if (numericOption === undefined && kn !== undefined) {
        numericOption = kn === 'true';
        echoed.push(`kn${kn === 'true' ? '' : `-${kn}`}`);
      }
      if (
        caseFirstOption === undefined &&
        kf !== undefined &&
        (CASE_FIRSTS as readonly string[]).includes(kf)
      ) {
        caseFirstOption = kf as (typeof CASE_FIRSTS)[number];
        echoed.push(`kf-${kf}`);
      }
      if (echoed.length > 0) locale += `-u-${echoed.join('-')}`;
      break;
    }
    locale ??= environment.defaultLocale(new Set(available.keys()));
    const sensitivity =
      stringOption(opts, 'sensitivity', SENSITIVITIES) ?? 'variant';
    const ignorePunctuation =
      opts['ignorePunctuation'] === undefined
        ? false
        : Boolean(opts['ignorePunctuation']);
    const table = tableFor(parseExtension(locale).base);
    internals.set(this as object, {
      options: {
        locale,
        usage,
        sensitivity,
        ignorePunctuation,
        collation: 'default',
        numeric: numericOption ?? false,
        caseFirst: caseFirstOption ?? table.caseFirst,
      },
      table,
      keys: new Map(),
    });
    return this as object;
  };

  // Its parameters are optional, so the built-in's length is 0.
  Object.defineProperty(Collator, 'length', { value: 0 });
  Object.defineProperty(Collator.prototype, 'compare', {
    configurable: true,
    enumerable: false,
    get(this: unknown) {
      const slots = internalsOf(this, 'compare');
      slots.bound ??= (a: unknown, b: unknown): number => {
        const keyOf = (text: string): SortKey => {
          let key = slots.keys.get(text);
          if (!key) {
            key = sortKey(elementsOf(text, slots.table, slots.options));
            // Sorting compares each string many times. The cap keeps a
            // long-lived collator from holding every string it ever saw.
            if (slots.keys.size < 1000) slots.keys.set(text, key);
          }
          return key;
        };
        return compareKeys(keyOf(String(a)), keyOf(String(b)), slots.options);
      };
      return slots.bound;
    },
  });
  Object.defineProperty(Collator.prototype, 'resolvedOptions', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: function resolvedOptions(this: unknown) {
      return { ...internalsOf(this, 'resolvedOptions').options };
    },
  });
  Object.defineProperty(Collator.prototype, Symbol.toStringTag, {
    configurable: true,
    value: 'Intl.Collator',
  });
  const supportedLocalesOf = (locales?: string | readonly string[]): string[] =>
    environment
      .canonicalize(locales)
      .filter(
        (tag) =>
          bestAvailable(available, parseExtension(tag).base) !== undefined,
      );
  Object.defineProperty(Collator, 'supportedLocalesOf', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: supportedLocalesOf,
  });
  return Collator as unknown as typeof Intl.Collator;
};

/**
 * `String.prototype.localeCompare` that compares with `Collator`, as the
 * spec has it do when there's an `Intl`. Collators are kept per locales and
 * options, so a sort makes one, not one per comparison.
 */
export const createLocaleCompare = (Collator: typeof Intl.Collator) => {
  const collators = new Map<string, Intl.Collator>();
  const localeCompare = function localeCompare(
    this: unknown,
    that: unknown,
    locales?: string | readonly string[],
    options?: Intl.CollatorOptions,
  ): number {
    if (this === null || this === undefined) {
      throw new TypeError(
        'String.prototype.localeCompare called on null or undefined',
      );
    }
    const key = JSON.stringify([locales, options]);
    let collator = collators.get(key);
    if (!collator) {
      collator = new Collator(locales, options);
      if (collators.size < 50) collators.set(key, collator);
    }
    return collator.compare(String(this), String(that));
  };
  // The built-in's length: `locales` and `options` are optional.
  Object.defineProperty(localeCompare, 'length', { value: 1 });
  return localeCompare;
};

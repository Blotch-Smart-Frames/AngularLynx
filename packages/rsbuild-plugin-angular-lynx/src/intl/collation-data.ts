import {
  type CollationData,
  type CollationTable,
  DECOMPOSED,
  UNASSIGNED,
} from './collation-format.js';

/**
 * The data our `Intl.Collator` (collator.ts) sorts with, made at build time
 * from Node's own `Intl.Collator`, which has ICU's full collation tables.
 *
 * FormatJS has no Collator, and the real thing, the Unicode Collation
 * Algorithm with CLDR's tailorings, needs megabytes of tables. So the build
 * asks ICU how it orders each character of the scripts most apps show, in
 * each of the app's locales, and writes down the answer as three weights per
 * character, as the algorithm does:
 *
 * - **primary**: the letter (`a` < `b`), equal for `e`, `é` and `E`;
 * - **secondary**: the accent (`e` < `é` < `è`);
 * - **tertiary**: the case and other variants (`e` < `E`).
 *
 * A character ICU treats as a letter plus accents (`é`) is written as those
 * (`e` and U+0301), so it compares the way ICU compares it, and the same as
 * the decomposed text. A character a locale sorts as a letter of its own,
 * such as `ä` in Swedish, after `z`, gets its own primary weight instead.
 * Two-letter contractions (Czech `ch` after `h`, Danish `aa`) and letters
 * that sort as two (`æ` as `ae`, `ß` as `ss` in most locales) are written
 * down too. What this leaves out is in the website's Internationalization
 * guide: characters outside {@link COLLATION_RANGES}, which sort by code
 * point after everything in them (Han ideographs and Hangul, for instance),
 * contractions of three or more letters, and reordering scripts such as Thai.
 */

/**
 * The code points the tables cover, as inclusive [first, last] ranges: Latin,
 * Greek, Cyrillic, Armenian, Hebrew, Arabic, Devanagari and Thai, the
 * combining accents, general punctuation, currency and letterlike symbols,
 * kana, ligatures (`ﬁ`) and fullwidth forms.
 */
export const COLLATION_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x06ff],
  [0x0900, 0x097f],
  [0x0e00, 0x0e7f],
  [0x1e00, 0x1fff],
  [0x2000, 0x218f],
  [0x3000, 0x30ff],
  [0xfb00, 0xfb4f],
  [0xff00, 0xffef],
];

/**
 * Blocks too big for the tables, which sort among the rest in ICU: Hangul
 * syllables before kana, the arrows, maths symbols and emoji with the other
 * symbols, and Han ideographs after everything. Each block gets the place its
 * first character has in ICU's order, and sorts by code point within it.
 */
export const COLLATION_BLOCKS: readonly (readonly [number, number])[] = [
  [0x2190, 0x2bff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0x1f000, 0x1faff],
  [0x20000, 0x3ffff],
];

/** The weights of the combining accents start here, above any letter's. */
export const ACCENT_SECONDARY_BASE = 200;

const ASSIGNED = /[^\p{Cn}\p{Cs}\p{Co}]/u;
const isLatinLetter = (char: string): boolean =>
  /^\p{Script=Latin}$/u.test(char) && /^\p{L}$/u.test(char);

/**
 * The characters of {@link COLLATION_RANGES} that are assigned.
 */
const repertoire = (): string[] => {
  const chars: string[] = [];
  for (const [first, last] of COLLATION_RANGES) {
    for (let cp = first; cp <= last; cp++) {
      const char = String.fromCodePoint(cp);
      if (ASSIGNED.test(char)) chars.push(char);
    }
  }
  return chars;
};

/**
 * Each character's decomposition: its canonical one (`é` to `e` + U+0301),
 * or else its compatibility one when that's longer than a character (`ﬁ` to
 * `fi`). Locale independent, so shared by every table.
 */
const decompositions = (chars: readonly string[]): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const char of chars) {
    const nfd = char.normalize('NFD');
    const nfkd = char.normalize('NFKD');
    if (nfd !== char) map[char] = nfd;
    else if (nfkd.length > 1) map[char] = nfkd;
  }
  return map;
};

const base36 = (value: number, width: number): string => {
  const text = value.toString(36);
  if (text.length > width) {
    throw new Error(`Collation weight ${value} doesn't fit in ${width} digits`);
  }
  return text.padStart(width, '0');
};

/**
 * A code point's weights as {@link CollationTable.w} writes them. Throws if
 * one doesn't fit, which would shift every weight after it.
 */
export const encodeWeights = (
  primary: number,
  secondary: number,
  tertiary: number,
): string => base36(primary, 3) + base36(secondary, 2) + base36(tertiary, 2);

/**
 * Builds the table for one locale, from ICU's collator for it.
 *
 * @param locale - A locale Node's `Intl.Collator` takes. One it has no
 *   tailoring for gets the root order, as it does in ICU.
 * @param chars - The characters of {@link COLLATION_RANGES} that are
 *   assigned.
 * @param decomposed - {@link decompositions} of `chars`.
 */
export const collationTable = (
  locale: string,
  chars: readonly string[] = repertoire(),
  decomposed: Readonly<Record<string, string>> = decompositions(chars),
): CollationTable => {
  const base = new Intl.Collator(locale, { sensitivity: 'base' }).compare;
  const accent = new Intl.Collator(locale, { sensitivity: 'accent' }).compare;
  const variant = new Intl.Collator(locale, { sensitivity: 'variant' }).compare;

  // Two-letter contractions: ICU tells one apart by a combining grapheme
  // joiner, which is ignorable but breaks a contraction. Only lowercase
  // Latin pairs are tried; their other cases follow.
  const lowerLatin = chars.filter(
    (char) => isLatinLetter(char) && char === char.toLowerCase(),
  );
  const contractions: string[] = [];
  for (const first of lowerLatin) {
    for (const second of lowerLatin) {
      if (base(first + second, `${first}͏${second}`) !== 0) {
        for (const pair of new Set([
          first + second,
          first.toUpperCase() + second,
          first.toUpperCase() + second.toUpperCase(),
          first + second.toUpperCase(),
        ])) {
          // Some letters' uppercase is two letters (`ŉ`), which isn't a pair.
          if ([...pair].length === 2) contractions.push(pair);
        }
      }
    }
  }

  // Letters that sort as two ASCII letters. Sorted once, the pairs let a
  // binary search find a letter's equal.
  const asciiPairs: string[] = [];
  for (let a = 97; a <= 122; a++) {
    for (let b = 97; b <= 122; b++) {
      asciiPairs.push(String.fromCharCode(a, b));
    }
  }
  asciiPairs.sort(base);
  const asciiPairEqualTo = (char: string): string | undefined => {
    let low = 0;
    let high = asciiPairs.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const order = base(char, asciiPairs[middle]!);
      if (order === 0) return asciiPairs[middle];
      if (order < 0) high = middle - 1;
      else low = middle + 1;
    }
    return undefined;
  };

  const expansions: Record<string, string> = {};
  const usesDecomposition = new Set<string>();
  const ignorable: string[] = [];
  const ranked: string[] = [...contractions];
  for (const char of chars) {
    const decomposition = decomposed[char];
    if (base(char, '') === 0 && accent(char, '') === 0) {
      ignorable.push(char);
    } else if (base(char, '') === 0) {
      // A combining accent: no primary weight, a secondary one of its own.
      ignorable.push(char);
    } else if (
      decomposition !== undefined &&
      variant(char, decomposition) === 0
    ) {
      // ICU sorts it as its decomposition, as Unicode's canonical
      // equivalence requires: `é` as `e` + U+0301. Unless the locale makes
      // it a letter of its own, which then sorts as that letter, as Swedish
      // does `ä`.
      if (base(char, decomposition[0]!) === 0) {
        usesDecomposition.add(char);
      } else {
        ranked.push(char);
      }
    } else if (decomposition !== undefined && base(char, decomposition) === 0) {
      // A ligature: `ﬁ` sorts as `fi`, then after it.
      expansions[char] =
        (accent(char, decomposition) === 0 ? '3' : '2') + decomposition;
    } else if (char.codePointAt(0)! > 0x7f && isLatinLetter(char)) {
      const pair = asciiPairEqualTo(char);
      if (pair === undefined) {
        ranked.push(char);
      } else {
        // `æ` as `ae`, `Æ` as `AE`.
        const parts = char === char.toLowerCase() ? pair : pair.toUpperCase();
        expansions[char] = (accent(char, parts) === 0 ? '3' : '2') + parts;
      }
    } else {
      ranked.push(char);
    }
  }

  // Each primary is a run of characters ICU calls equal at the base level,
  // each secondary a run within it equal at the accent level, and so on.
  // Weights start at 1, since 0 means "none at this level".
  const blockStarts = COLLATION_BLOCKS.map(([first]) =>
    String.fromCodePoint(first),
  );
  ranked.push(...blockStarts);
  ranked.sort(variant);
  const weights = new Map<string, string>();
  let primary = 0;
  let secondary = 0;
  let tertiary = 0;
  ranked.forEach((char, index) => {
    const previous = ranked[index - 1];
    if (previous === undefined || base(previous, char) !== 0) {
      primary++;
      secondary = 1;
      tertiary = 1;
    } else if (accent(previous, char) !== 0) {
      secondary++;
      tertiary = 1;
    } else if (variant(previous, char) !== 0) {
      tertiary++;
    }
    weights.set(char, encodeWeights(primary, secondary, tertiary));
  });
  // The accents, and the characters ICU ignores altogether, which keep a
  // secondary weight of 0.
  ignorable.sort(accent);
  let accentWeight = ACCENT_SECONDARY_BASE - 1;
  ignorable.forEach((char, index) => {
    const previous = ignorable[index - 1];
    if (accent(char, '') === 0) {
      weights.set(char, encodeWeights(0, 0, 0));
      return;
    }
    if (previous === undefined || accent(previous, char) !== 0) {
      accentWeight++;
    }
    weights.set(char, encodeWeights(0, accentWeight, 1));
  });

  let w = '';
  for (const [first, last] of COLLATION_RANGES) {
    for (let cp = first; cp <= last; cp++) {
      const char = String.fromCodePoint(cp);
      const weight = weights.get(char);
      if (weight !== undefined) w += weight;
      else if (usesDecomposition.has(char) || char in expansions) {
        w += DECOMPOSED;
      } else w += UNASSIGNED;
    }
  }
  const c: Record<string, string> = {};
  for (const pair of contractions) c[pair] = weights.get(pair)!;
  const f = new Intl.Collator(locale).resolvedOptions().caseFirst as
    | 'upper'
    | 'lower'
    | 'false';
  const b = blockStarts.map((char) =>
    parseInt(weights.get(char)!.slice(0, 3), 36),
  );
  return { w, x: expansions, c, b, f };
};

/**
 * The collation data for `locales`: one table per distinct ordering, and the
 * table each locale uses.
 */
export const collationData = (locales: readonly string[]): CollationData => {
  const chars = repertoire();
  const d = decompositions(chars);
  const tables: CollationTable[] = [];
  const keys: string[] = [];
  const l: Record<string, number> = {};
  for (const locale of locales) {
    const table = collationTable(locale, chars, d);
    const key = JSON.stringify(table);
    let index = keys.indexOf(key);
    if (index < 0) {
      index = tables.push(table) - 1;
      keys.push(key);
    }
    l[locale] = index;
  }
  return { r: COLLATION_RANGES, k: COLLATION_BLOCKS, d, t: tables, l };
};

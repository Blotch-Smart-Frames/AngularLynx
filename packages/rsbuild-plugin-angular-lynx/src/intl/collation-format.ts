/**
 * The format of the collation data the build writes (collation-data.ts) and
 * our `Intl.Collator` reads (collator.ts). It's its own module so the
 * runtime's bundle doesn't take in the build's code.
 */

/**
 * How {@link CollationTable.w} writes each code point's weights: the primary
 * in three base-36 digits, then the secondary and the tertiary in two each.
 */
export const WEIGHT_WIDTH = 7;

/**
 * In place of a code point's weights: it isn't assigned (or is a surrogate
 * or for private use), so it sorts by code point after the table.
 */
export const UNASSIGNED = '~';

/**
 * In place of a code point's weights: it sorts as its decomposition in
 * {@link CollationData.d} (a letter and its accents).
 */
export const DECOMPOSED = '=';

/**
 * The secondary weight of the accent-like difference ICU gives a letter that
 * sorts as two (`æ` as `ae`, `ß` as `ss`): above every real accent's, after
 * the first of the two, as in the Unicode Collation Algorithm's own table.
 */
export const EXPANSION_SECONDARY = 1295;

/**
 * Added to the tertiary weight of the last of the characters a ligature
 * sorts as (`ﬁ` as `fi`), so it follows them, as in ICU.
 */
export const EXPANSION_TERTIARY_BUMP = 600;

export type CollationTable = {
  /**
   * Each code point of `COLLATION_RANGES` (collation-data.ts), in order: its weights in
   * {@link WEIGHT_WIDTH} characters, or {@link UNASSIGNED} or
   * {@link DECOMPOSED} alone.
   */
  readonly w: string;
  /**
   * Characters that sort as other characters, after them: `æ` as `ae`. The
   * value starts with the level they differ at, `2` (secondary, as `æ` and
   * `ae` do) or `3` (tertiary, as `ﬁ` and `fi`).
   */
  readonly x: Readonly<Record<string, string>>;
  /**
   * Strings of two characters that sort as one, such as Czech `ch`, and
   * their weights, written as in {@link w}.
   */
  readonly c: Readonly<Record<string, string>>;
  /**
   * The primary weight of each of `COLLATION_BLOCKS` (collation-data.ts)' first
   * characters. The block's other characters come after it, by code point,
   * and before the next weight.
   */
  readonly b: readonly number[];
  /**
   * The locale's `caseFirst`: Danish, for one, sorts uppercase first.
   */
  readonly f: 'upper' | 'lower' | 'false';
};

export type CollationData = {
  readonly r: readonly (readonly [number, number])[];
  /** `COLLATION_BLOCKS` (collation-data.ts). */
  readonly k: readonly (readonly [number, number])[];
  /** Each character's canonical decomposition, where it has one. */
  readonly d: Readonly<Record<string, string>>;
  /** One table per distinct ordering: locales that sort alike share it. */
  readonly t: readonly CollationTable[];
  /** Each locale's table, by index into {@link t}. */
  readonly l: Readonly<Record<string, number>>;
};

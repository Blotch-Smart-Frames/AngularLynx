import { beforeAll, describe, expect, it } from 'vitest';
import { collationData, encodeWeights } from './collation-data';
import type { CollationData } from './collation-format';
import { createCollator, createLocaleCompare } from './collator';

/**
 * Node has ICU's collator, which ours imitates from the tables the build
 * takes from it. So most tests sort the same words with both and expect the
 * same order.
 */
const LOCALES = [
  'en-US',
  'en-GB',
  'sv',
  'cs',
  'da',
  'es',
  'de',
  'tr',
  'fr',
  'pl',
];

// Words in many languages, which the spelling check doesn't know.
// cspell:disable
// prettier-ignore
const WORDS = [
  'apple', 'Apple', 'APPLE', 'Äpfel', 'äpfel', 'zebra', 'Zoë', 'Émile', 'eagle', 'école',
  'ecole', 'Ecole', 'côte', 'coté', 'cote', 'côté', 'Chloé', 'chata', 'hrad', 'czar',
  'cizí', 'ångström', 'Åse', 'aase', 'øre', 'ole', 'Æble', 'aeble', 'straße', 'strasse',
  'Strasse', 'ñandú', 'nube', 'ozono', 'ıspanak', 'iğne', 'İzmir', 'Istanbul', 'şeker',
  'sekiz', 'çay', 'cay', 'ﬁle', 'file', 'ﬂow', 'item 10', 'item 2', 'item 1', 'item 01',
  'a-b', 'a b', 'ab', 'a_b', '#tag', '1st', '10th', '2nd', 'Ωmega', 'omega', 'Ж', 'жук',
  'Яблоко', 'яблоко', 'łódź', 'lodz', 'Łódź', 'ü', 'u', 'ue', 'über', 'uber', 'ç', 'ő',
  'ö', 'o', 'z', 'Z', 'ź', 'ż', 'ž', 'zz', 'œuf', 'oeuf', 'Œuvre', 'dž', 'dz', 'Ǆ', 'ǆ',
  '東京', 'ひらがな', 'カタカナ', '한국', '가나', '😀', '→', '∑', '中文', '!', '?', '€5',
  '$5', '½', '1/2', 'école', '', ' ', 'a­b', 'Côte d’Ivoire', 'Costa Rica',
  // Unassigned in the tables' ranges, and outside them and their blocks.
  '\u0378', '\u{10400}',
];
// cspell:enable

const OPTIONS: Intl.CollatorOptions[] = [
  {},
  { sensitivity: 'base' },
  { sensitivity: 'accent' },
  { sensitivity: 'case' },
  { numeric: true },
  { caseFirst: 'upper' },
  { caseFirst: 'lower' },
  { ignorePunctuation: true },
];

let data: CollationData;
let Collator: typeof Intl.Collator;

beforeAll(() => {
  data = collationData(LOCALES);
  Collator = createCollator({
    data,
    defaultLocale: () => 'en-US',
    canonicalize: (locales) =>
      locales === undefined ? [] : Intl.getCanonicalLocales(locales as string),
  });
});

/**
 * The pairs ICU and ours order differently.
 */
const disagreements = (locale: string, options: Intl.CollatorOptions) => {
  const icu = new Intl.Collator(locale, options);
  const ours = new Collator(locale, options);
  const pairs: string[] = [];
  for (const a of WORDS) {
    for (const b of WORDS) {
      if (Math.sign(icu.compare(a, b)) !== ours.compare(a, b)) {
        pairs.push(`${a} | ${b}`);
      }
    }
  }
  return pairs;
};

describe('Intl.Collator', () => {
  for (const locale of LOCALES) {
    for (const options of OPTIONS) {
      const name = `${locale} ${JSON.stringify(options)}`;
      it(`orders words as ICU does: ${name}`, () => {
        expect(disagreements(locale, options)).toEqual([]);
      });
    }
  }

  it('sorts with each locale’s own letters', () => {
    const sort = (locale: string, words: string[]) =>
      [...words].sort(new Collator(locale).compare).join(' ');
    expect(sort('sv', ['z', 'ä', 'a', 'å', 'ö', 'o'])).toBe('a o z å ä ö');
    expect(sort('de', ['z', 'ä', 'a', 'b'])).toBe('a ä b z');
    expect(sort('es', ['o', 'ñ', 'n'])).toBe('n ñ o');
    expect(sort('cs', ['i', 'ch', 'h', 'c'])).toBe('c h ch i');
  });

  it('compares numbers by value with numeric', () => {
    const compare = new Collator('en', { numeric: true }).compare;
    expect(compare('item 2', 'item 10')).toBe(-1);
    expect(compare('item 01', 'item 1')).toBe(0);
    expect(compare('0', '00')).toBe(0);
    expect(compare('a10', 'a9b')).toBe(1);
  });

  it('works without new, and returns -1, 0 or 1', () => {
    const collator = (Collator as unknown as (l: string) => Intl.Collator)(
      'fr',
    );
    expect(collator).toBeInstanceOf(Collator);
    expect(collator.compare('é', 'z')).toBe(-1);
    expect(collator.compare('z', 'é')).toBe(1);
    expect(collator.compare('a', 'a')).toBe(0);
  });

  it('has a bound compare that converts its arguments to strings', () => {
    const collator = new Collator('en', { numeric: true });
    const { compare } = collator;
    expect(collator.compare).toBe(compare);
    expect([10, 9, 100].sort(compare as never)).toEqual([9, 10, 100]);
  });

  it('remembers at most 1000 strings’ keys', () => {
    const compare = new Collator('en').compare;
    const words = Array.from({ length: 1500 }, (_, i) => `w${i}`);
    expect([...words].sort(compare)).toEqual(
      [...words].sort(new Intl.Collator('en').compare),
    );
  });

  it('resolves its options as ICU does', () => {
    expect(new Collator('de').resolvedOptions()).toEqual({
      locale: 'de',
      usage: 'sort',
      sensitivity: 'variant',
      ignorePunctuation: false,
      collation: 'default',
      numeric: false,
      caseFirst: 'false',
    });
    expect(new Collator('da').resolvedOptions().caseFirst).toBe('upper');
    expect(
      new Collator('fr', {
        usage: 'search',
        sensitivity: 'base',
        ignorePunctuation: true,
        numeric: 1 as never,
        caseFirst: 'lower',
        localeMatcher: 'lookup',
      }).resolvedOptions(),
    ).toEqual({
      locale: 'fr',
      usage: 'search',
      sensitivity: 'base',
      ignorePunctuation: true,
      collation: 'default',
      numeric: true,
      caseFirst: 'lower',
    });
  });

  it('reads kn and kf from the locale, unless the options set them', () => {
    expect(new Collator('de-u-kn').resolvedOptions()).toMatchObject({
      locale: 'de-u-kn',
      numeric: true,
    });
    expect(
      new Collator('de-u-kn-false-kf-upper').resolvedOptions(),
    ).toMatchObject({
      locale: 'de-u-kn-false-kf-upper',
      numeric: false,
      caseFirst: 'upper',
    });
    expect(
      new Collator('de-u-kn-kf-upper', {
        numeric: false,
        caseFirst: 'lower',
      }).resolvedOptions(),
    ).toMatchObject({ locale: 'de', numeric: false, caseFirst: 'lower' });
    // An unknown keyword or value is left out.
    expect(
      new Collator('de-u-co-phonebk-kf-sideways').resolvedOptions(),
    ).toMatchObject({ locale: 'de', caseFirst: 'false' });
    expect(
      new Collator('de-u-ca-buddhist-x-private').resolvedOptions().locale,
    ).toBe('de');
    // An attribute before the keywords, and a value of two parts.
    expect(
      new Collator('de-u-attr-ca-islamic-civil-kn').resolvedOptions(),
    ).toMatchObject({ locale: 'de-u-kn', numeric: true });
  });

  it('finds a locale by its shorter forms, or falls back to the default', () => {
    expect(new Collator('sv-FI').resolvedOptions().locale).toBe('sv');
    expect(new Collator('en').resolvedOptions().locale).toBe('en');
    expect(new Collator(['tlh', 'cs-CZ']).resolvedOptions().locale).toBe('cs');
    expect(new Collator('tlh').resolvedOptions().locale).toBe('en-US');
    expect(new Collator().resolvedOptions().locale).toBe('en-US');
  });

  it('lists the locales it supports', () => {
    expect(Collator.supportedLocalesOf(['sv-SE', 'tlh', 'de-u-kn'])).toEqual([
      'sv-SE',
      'de-u-kn',
    ]);
    expect(Collator.supportedLocalesOf(undefined as never)).toEqual([]);
  });

  it('rejects options out of range', () => {
    expect(() => new Collator('en', { sensitivity: 'loose' as never })).toThrow(
      new RangeError(
        'Value loose out of range for Intl.Collator options property sensitivity',
      ),
    );
    expect(() => new Collator('en', { usage: 'filter' as never })).toThrow(
      RangeError,
    );
  });

  it('refuses a receiver that is no collator', () => {
    const { get } = Object.getOwnPropertyDescriptor(
      Collator.prototype,
      'compare',
    )!;
    expect(() => get!.call({})).toThrow(
      'Method Intl.Collator.prototype.compare called on incompatible receiver [object Object]',
    );
    expect(() =>
      Collator.prototype.resolvedOptions.call(null as never),
    ).toThrow(TypeError);
  });

  it('takes no arguments by its length, as the built-in', () => {
    expect(Collator.length).toBe(0);
  });

  it('is tagged as Intl.Collator', () => {
    expect(Object.prototype.toString.call(new Collator())).toBe(
      '[object Intl.Collator]',
    );
  });
});

describe('encodeWeights', () => {
  it('writes the three weights in base 36, and refuses one too big', () => {
    expect(encodeWeights(1, 2, 35)).toBe('00102' + '0z');
    expect(() => encodeWeights(36 ** 3, 1, 1)).toThrow(
      "Collation weight 46656 doesn't fit in 3 digits",
    );
  });
});

describe('localeCompare', () => {
  it('compares with a collator for the locales and options, kept for reuse', () => {
    const localeCompare = createLocaleCompare(Collator);
    expect(localeCompare.call('ä', 'z', 'sv')).toBe(1);
    expect(localeCompare.call('ä', 'z', 'de')).toBe(-1);
    expect(localeCompare.call('a', 'A')).toBe(-1);
    expect(localeCompare.call(2 as never, '10', 'en', { numeric: true })).toBe(
      -1,
    );
    expect(localeCompare.call('ä', 'z', 'sv')).toBe(1);
    // A sort with many option objects keeps no more than 50 collators.
    for (let i = 0; i < 60; i++) {
      expect(
        localeCompare.call('a', 'b', 'en', { [`x${i}`]: 1 } as never),
      ).toBe(-1);
    }
  });

  it('has the length and errors of the built-in', () => {
    const localeCompare = createLocaleCompare(Collator);
    expect(localeCompare.length).toBe(1);
    expect(localeCompare.name).toBe('localeCompare');
    expect(() => localeCompare.call(undefined, 'a')).toThrow(
      'String.prototype.localeCompare called on null or undefined',
    );
  });
});

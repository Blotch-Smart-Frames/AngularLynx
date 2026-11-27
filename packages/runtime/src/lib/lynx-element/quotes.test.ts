import { afterEach, describe, expect, it } from 'vitest';
import {
  getDocumentLanguage,
  parseQuotes,
  quotePairFor,
  quotesFor,
  setDocumentLanguage,
} from './quotes';

describe('quotesFor', () => {
  it("gives a language's outer and inner marks, as CLDR has them", () => {
    expect(quotesFor('fr')).toBe('«»«»');
    expect(quotesFor('de')).toBe('„“‚‘');
    expect(quotesFor('ja')).toBe('「」『』');
    expect(quotesFor('en')).toBe('“”‘’');
  });

  it('matches without case, and takes `_` as `-`', () => {
    expect(quotesFor('FR-ca')).toBe('«»”“');
    expect(quotesFor('fr_CA')).toBe('«»”“');
  });

  it('falls back to the tag with fewer parts, then to English', () => {
    // de-AT has no entry of its own: it draws German's.
    expect(quotesFor('de-AT')).toBe('„“‚‘');
    expect(quotesFor('zh-Hant-TW')).toBe('「」『』');
    // Taiwan's Chinese is Traditional, as ICU finds by adding the script.
    expect(quotesFor('zh-TW')).toBe('「」『』');
    expect(quotesFor('zh-CN')).toBe('“”‘’');
    expect(quotesFor('xx')).toBe('“”‘’');
    // HTML's lang="": an unknown language.
    expect(quotesFor('')).toBe('“”‘’');
  });
});

describe('the document language', () => {
  afterEach(() => setDocumentLanguage(''));

  it('is empty until the renderer sets it', () => {
    expect(getDocumentLanguage()).toBe('');
    setDocumentLanguage('fr');
    expect(getDocumentLanguage()).toBe('fr');
  });
});

describe('parseQuotes', () => {
  it.each([
    ['none', []],
    [' NONE ', []],
    ['auto', 'auto'],
    ['initial', 'auto'],
    ['inherit', 'inherit'],
    ['unset', 'inherit'],
    ['revert', 'inherit'],
    ['revert-layer', 'inherit'],
    [`'«' '»'`, ['«', '»']],
    [`"«" "»" '‹' '›'`, ['«', '»', '‹', '›']],
    // Strings need no space between them.
    [`"a""b"`, ['a', 'b']],
    // An escape: hex digits, with one space after them, or the character.
    [String.raw`"\201C" '\201D x'`, ['“', '”x']],
    [String.raw`"\"" '\''`, ['"', "'"]],
    [String.raw`"\0" "\110000"`, ['\ufffd', '\ufffd']],
    // A surrogate isn't a character of its own.
    [String.raw`"\D800" "a"`, ['\ufffd', 'a']],
    // An escaped newline is no character.
    ['"a\\\nb" "c"', ['ab', 'c']],
    [`'<' '>' !important`, ['<', '>']],
    ['none ! IMPORTANT', []],
  ])('reads %s', (value, quotes) => {
    expect(parseQuotes(value)).toEqual(quotes);
  });

  it.each([
    ["'«'"],
    ["'«' '»' '‹'"],
    [''],
    ['12px'],
    ['var(--q)'],
    ["'«' x '»'"],
    ["'unclosed"],
    ['"a\nb" "c"'],
    ['"a\\'],
    // An escape at the end, in a string that doesn't close.
    [String.raw`"\41`],
  ])('drops %j, as a browser does', (value) => {
    expect(parseQuotes(value)).toBeUndefined();
  });
});

describe('quotePairFor', () => {
  it("gives the language's outer pair, then its inner one", () => {
    expect(quotePairFor('auto', 0, 'fr')).toEqual(['«', '»']);
    expect(quotePairFor('auto', 1, 'de')).toEqual(['‚', '‘']);
    expect(quotePairFor('auto', 3, 'en')).toEqual(['‘', '’']);
  });

  it('gives the pair for the depth, or the last one past them', () => {
    const quotes = ['1', '2', '3', '4'];
    expect(quotePairFor(quotes, 0, 'fr')).toEqual(['1', '2']);
    expect(quotePairFor(quotes, 1, 'fr')).toEqual(['3', '4']);
    expect(quotePairFor(quotes, 5, 'fr')).toEqual(['3', '4']);
  });

  it('gives no marks for none', () => {
    expect(quotePairFor([], 0, 'fr')).toEqual(['', '']);
  });
});

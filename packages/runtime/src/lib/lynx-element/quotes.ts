/**
 * The quotation marks a `<q>` draws for each language (see
 * LynxElement.#setQuoteDepth): the four marks are the outer pair's opening
 * and closing marks, then the inner pair's, which a `<q>` inside another
 * draws. A browser's `quotes: auto` takes them from the element's language,
 * and Chromium reads them from ICU, which has CLDR's `delimiters` data. Lynx's
 * JavaScript engine has no Intl or ICU to ask, so the table is CLDR 49's,
 * left out where a language draws English quotes (“ ” and ‘ ’), and where a
 * regional variant draws its language's.
 *
 * Grouped by the marks, as most languages share theirs with others: a group
 * is smaller than a key per language.
 */
// The language tags aren't words cspell knows.
// cspell:disable
const QUOTE_GROUPS: readonly (readonly [marks: string, languages: string])[] = [
  ['«»‘’', 'ady dua el-polyton kbd ksf nb nn no rw'],
  ['„”‚’', 'agq ff'],
  ['«»‹›', 'am az-cyrl fa fr-ch gsw jgo kkj mzn rm wae'],
  ['”“’‘', 'ar lld syr ur'],
  [
    '«»“”',
    'ast blo bm br ca cv dyo el es-us eu ewo ie it kab kk lij mg mua nnh pms pt-ao pt-ch pt-cv pt-gq pt-gw pt-lu pt-mo pt-mz pt-pt pt-st pt-tl sc sg ti',
  ],
  ['«»„“', 'bas be bua ky os ru sah tyv uk'],
  ['„“„“', 'bg lt prg'],
  ['„”‘’', 'bs'],
  ['„“‚‘', 'bs-cyrl cs de dsb et hr hsb is ksh lb luy mk nds sk sl'],
  ['“”«»', 'eo'],
  ['“”‘’', 'ff-adlm uz-arab uz-cyrl'],
  ['””’’', 'fi he lag rn se sn sv yi'],
  ['«»«»', 'fr hy oc yav'],
  ['«»”“', 'fr-ca'],
  ['‘’“”', 'fur ia ti-er'],
  ['„”»«', 'hu szl'],
  // zh-TW, zh-HK and zh-MO are written in Traditional Chinese, which ICU
  // finds by adding the script (zh-Hant-TW); this table has no such step.
  ['「」『』', 'ja yue zh-hant zh-hk zh-mo zh-tw'],
  ['„“«»', 'ka'],
  ['»«›‹', 'kk-arab ug'],
  ['‘’‘’', 'nl'],
  ['„”«»', 'nmg pl ro'],
  ['«»„”', 'shi zgh'],
  ['„”’’', 'sr'],
  ['“’“”', 'st'],
  ['“”“”', 'tk tn'],
  ['“”’‘', 'uz'],
];
// cspell:enable

/** English quotes, which a language the table leaves out draws. */
const ENGLISH_QUOTES = '“”‘’';

let quotesByLanguage: Map<string, string> | undefined;

/**
 * The four quotation marks for `language`, a BCP 47 tag such as `fr`, `de-CH`
 * or `zh-Hant-TW`, matched without case: its own entry if the table has one,
 * or the nearest with fewer parts (`de-CH` draws `de`'s), or English. An
 * empty tag, which HTML's `lang=""` is (an unknown language), draws English
 * too, as a browser does.
 */
export const quotesFor = (language: string): string => {
  if (!quotesByLanguage) {
    quotesByLanguage = new Map();
    for (const [marks, languages] of QUOTE_GROUPS) {
      for (const tag of languages.split(' ')) quotesByLanguage.set(tag, marks);
    }
  }
  // Locale ids sometimes use `_` (`fr_CA`), as Android's and ICU's do.
  let tag = language.trim().toLowerCase().replace(/_/g, '-');
  while (tag) {
    const marks = quotesByLanguage.get(tag);
    if (marks) return marks;
    const end = tag.lastIndexOf('-');
    tag = end < 0 ? '' : tag.slice(0, end);
  }
  return ENGLISH_QUOTES;
};

/**
 * The language of an element no `lang` attribute is on or above: the app's
 * `LOCALE_ID` (see LynxRendererFactory2). A browser takes it from
 * `<html lang>`, which Angular's localized builds set to the locale; a Lynx
 * app has no `<html>`.
 */
let documentLanguage = '';

/** @internal The language of an element no `lang` is on or above. */
export const getDocumentLanguage = (): string => documentLanguage;

/** @internal Sets the language of an element no `lang` is on or above. */
export const setDocumentLanguage = (language: string): void => {
  documentLanguage = language;
};

/**
 * The marks a `quotes` value gives a `<q>`: its pairs of strings, outer
 * first (an empty list for `none`, which draws no marks), or `auto` for its
 * language's (see quotesFor), which is what `initial` is too.
 */
export type QuoteMarks = readonly string[] | 'auto';

/**
 * CSS's whitespace: a space, tab, newline, carriage return or form feed.
 * JavaScript's `\s` takes a no-break space too, which CSS reads as part of
 * a word.
 */
const CSS_SPACE = /[ \t\n\r\f]/;

/**
 * Reads a CSS `quotes` value, as a stylesheet's rule or an inline style
 * has it: `none`, `auto`, or pairs of strings (`'«' '»' '‹' '›'`), whose
 * escapes (`'\201C'`) it decodes. `inherit` for a value that takes the
 * parent's (`inherit`, `unset`, `revert`, `revert-layer`: `quotes` is an
 * inherited property, and the browser's own stylesheet doesn't set it), and
 * undefined for one a browser drops: an odd number of strings, or anything
 * else, such as a `var()`, which the runtime can't resolve (it can't read a
 * custom property's value off Lynx's stylesheet). A trailing `!important`
 * (or `! important`, as CSS allows) is passed over: #ownQuotes reads it.
 */
export const parseQuotes = (
  value: string,
): QuoteMarks | 'inherit' | undefined => {
  // CSS's whitespace only (see CSS_SPACE): `\s` takes a no-break space too.
  const text = value
    .replace(/[ \t\n\r\f]*![ \t\n\r\f]*important[ \t\n\r\f]*$/i, '')
    .replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '');
  const keyword = text.toLowerCase();
  if (keyword === 'none') return [];
  if (keyword === 'auto' || keyword === 'initial') return 'auto';
  if (
    keyword === 'inherit' ||
    keyword === 'unset' ||
    keyword === 'revert' ||
    keyword === 'revert-layer'
  ) {
    return 'inherit';
  }
  const marks: string[] = [];
  let at = 0;
  while (at < text.length) {
    const quote = text[at];
    if (quote !== '"' && quote !== "'") return undefined;
    let mark = '';
    at++;
    for (;;) {
      const char = text[at];
      // An unclosed string, or a newline in one, makes the value invalid.
      if (char === undefined || char === '\n') return undefined;
      at++;
      if (char === quote) break;
      if (char !== '\\') {
        mark += char;
        continue;
      }
      // An escape: up to six hex digits and one whitespace after them, or
      // the next character as it is (an escaped newline is no character).
      const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(at))?.[0];
      if (hex) {
        at += hex.length;
        if (CSS_SPACE.test(text[at] ?? '')) at++;
        const code = parseInt(hex, 16);
        mark += String.fromCodePoint(
          code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
            ? 0xfffd
            : code,
        );
      } else if (text[at] === '\n') at++;
      else if (text[at] !== undefined) mark += text[at++];
    }
    marks.push(mark);
    const space = /^[ \t\n\r\f]*/.exec(text.slice(at))![0].length;
    // Strings are separated by whitespace, or nothing, as CSS allows.
    at += space;
  }
  if (!marks.length || marks.length % 2) return undefined;
  return marks;
};

/**
 * The opening and closing mark of a `<q>` `depth` `<q>`s deep, for its
 * `quotes` and its language: the pair for its depth, or the last pair past
 * them, as a browser takes it, and nothing for `none`.
 */
export const quotePairFor = (
  quotes: QuoteMarks,
  depth: number,
  language: string,
): [open: string, close: string] => {
  if (quotes === 'auto') {
    // A language's inner pair repeats below it (see #setQuoteDepth).
    const marks = quotesFor(language);
    const pair = depth === 0 ? 0 : 2;
    return [marks[pair]!, marks[pair + 1]!];
  }
  if (!quotes.length) return ['', ''];
  const pair = Math.min(depth, quotes.length / 2 - 1) * 2;
  return [quotes[pair]!, quotes[pair + 1]!];
};

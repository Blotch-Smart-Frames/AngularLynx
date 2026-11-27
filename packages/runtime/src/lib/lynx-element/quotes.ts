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

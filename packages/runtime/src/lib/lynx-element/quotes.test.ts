import { afterEach, describe, expect, it } from 'vitest';
import { getDocumentLanguage, quotesFor, setDocumentLanguage } from './quotes';

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

import { describe, expect, it } from 'vitest';
import { appLocales, dataLocaleCandidates, findDataLocale } from './locales';

describe('appLocales', () => {
  it('puts the source locale first, canonicalized, without repeats', () => {
    expect(appLocales('en-us', ['fr', 'EN-US', 'zh-hant-tw'])).toEqual([
      'en-US',
      'fr',
      'zh-Hant-TW',
    ]);
  });

  it('names a locale that is no locale', () => {
    expect(() => appLocales('en-US', ['not a locale'])).toThrow(
      'angular.json\'s i18n lists "not a locale", which isn\'t a locale.',
    );
  });
});

describe('dataLocaleCandidates', () => {
  it("tries the script a tag implies before the tag's shorter forms", () => {
    expect(dataLocaleCandidates('zh-TW')).toEqual([
      'zh-TW',
      'zh-Hant-TW',
      'zh-Hant',
      'zh',
    ]);
    expect(dataLocaleCandidates('en-US')).toEqual([
      'en-US',
      'en-Latn-US',
      'en-Latn',
      'en',
    ]);
  });

  it('leaves out Unicode extensions', () => {
    expect(dataLocaleCandidates('de-DE-u-co-phonebk')[0]).toBe('de-DE');
  });
});

describe('findDataLocale', () => {
  const files = new Set(['en', 'en-GB', 'zh', 'zh-Hant', 'pt', 'pt-PT']);
  const has = (tag: string) => files.has(tag);

  it('finds the data that serves a tag', () => {
    expect(findDataLocale('en-US', has)).toBe('en');
    expect(findDataLocale('en-GB', has)).toBe('en-GB');
    expect(findDataLocale('zh-TW', has)).toBe('zh-Hant');
    expect(findDataLocale('zh-CN', has)).toBe('zh');
    expect(findDataLocale('pt-BR', has)).toBe('pt');
    expect(findDataLocale('pt-PT', has)).toBe('pt-PT');
  });

  it("is undefined when there's none", () => {
    expect(findDataLocale('tlh', has)).toBeUndefined();
  });
});

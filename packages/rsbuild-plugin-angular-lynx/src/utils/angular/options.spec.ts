import { describe, expect, it } from 'vitest';
import {
  normalizeI18nOptions,
  normalizeOptimization,
  normalizeSourceMaps,
} from './options';

describe('normalizeSourceMaps', () => {
  it('boolean true expands to scripts and styles true', () => {
    const result = normalizeSourceMaps(true);

    expect(result).toEqual({
      scripts: true,
      styles: true,
      hidden: false,
      vendor: false,
    });
  });

  it('boolean false expands to scripts and styles false', () => {
    const result = normalizeSourceMaps(false);

    expect(result).toEqual({
      scripts: false,
      styles: false,
      hidden: false,
      vendor: false,
    });
  });

  it('object with individual values preserves them', () => {
    const result = normalizeSourceMaps({ scripts: true, styles: false });

    expect(result.scripts).toBe(true);
    expect(result.styles).toBe(false);
    expect(result.hidden).toBe(false);
    expect(result.vendor).toBe(false);
  });

  it('object with hidden true propagates', () => {
    const result = normalizeSourceMaps({ scripts: true, hidden: true });

    expect(result.hidden).toBe(true);
  });

  it('object with vendor true propagates', () => {
    const result = normalizeSourceMaps({ scripts: false, vendor: true });

    expect(result.vendor).toBe(true);
  });
});

describe('normalizeOptimization', () => {
  it('true enables all optimizations', () => {
    const result = normalizeOptimization(true);

    expect(result.scripts).toBe(true);
    expect(result.styles.minify).toBe(true);
    expect(result.styles.inlineCritical).toBe(true);
    expect(result.fonts.inline).toBe(true);
  });

  it('false disables all optimizations', () => {
    const result = normalizeOptimization(false);

    expect(result.scripts).toBe(false);
    expect(result.styles.minify).toBe(false);
    expect(result.styles.inlineCritical).toBe(false);
    expect(result.fonts.inline).toBe(false);
  });

  it('undefined defaults to true (all enabled)', () => {
    const result = normalizeOptimization();

    expect(result.scripts).toBe(true);
    expect(result.styles.minify).toBe(true);
    expect(result.fonts.inline).toBe(true);
  });

  it('object { scripts: true, styles: false } normalizes correctly', () => {
    const result = normalizeOptimization({ scripts: true, styles: false });

    expect(result.scripts).toBe(true);
    expect(result.styles.minify).toBe(false);
  });

  it('object with styles as object passes through', () => {
    const result = normalizeOptimization({
      styles: { minify: true, inlineCritical: false },
    });

    expect(result.styles).toEqual({ minify: true, inlineCritical: false });
  });

  it('object with fonts as object passes through', () => {
    const result = normalizeOptimization({ fonts: { inline: true } });

    expect(result.fonts).toEqual({ inline: true });
  });

  it('object with fonts false normalizes to fonts.inline false', () => {
    const result = normalizeOptimization({ fonts: false });

    expect(result.fonts.inline).toBe(false);
  });
});

describe('normalizeI18nOptions', () => {
  it('returns defaults when input is undefined', () => {
    const result = normalizeI18nOptions(undefined);

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('returns defaults when input is null', () => {
    const result = normalizeI18nOptions(null);

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('parses sourceLocale as a string', () => {
    const result = normalizeI18nOptions({ sourceLocale: 'fr' });

    expect(result).toEqual({
      sourceLocale: 'fr',
      hasDefinedSourceLocale: true,
    });
  });

  it('parses sourceLocale as an object with code property', () => {
    const result = normalizeI18nOptions({
      sourceLocale: { code: 'de-AT' },
    });

    expect(result).toEqual({
      sourceLocale: 'de-AT',
      hasDefinedSourceLocale: true,
    });
  });

  it('returns defaults when sourceLocale is not provided', () => {
    const result = normalizeI18nOptions({ locales: { fr: 'messages.fr.xlf' } });

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('returns defaults for non-object input', () => {
    const result = normalizeI18nOptions('invalid');

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });
});

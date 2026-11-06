import { describe, expect, it } from 'vitest';
import {
  INTL_APIS,
  intlApiPackages,
  parseIntlOption,
  resolveIntlApis,
} from './apis';

describe('parseIntlOption', () => {
  it('is empty when the option is unset', () => {
    expect(parseIntlOption(undefined, 'angular.json')).toEqual([]);
    expect(parseIntlOption(null, 'angular.json')).toEqual([]);
  });

  it('takes a list of the APIs, or one alone', () => {
    expect(parseIntlOption(['NumberFormat', 'Collator'], 'x')).toEqual([
      'NumberFormat',
      'Collator',
    ]);
    expect(parseIntlOption('DisplayNames', 'x')).toEqual(['DisplayNames']);
    expect(parseIntlOption([...INTL_APIS], 'x')).toEqual([...INTL_APIS]);
  });

  it('names the ones it has no polyfill for, and where they were written', () => {
    expect(() =>
      parseIntlOption(['Segmenter', 'NumberFormat', 1], 'pluginAngularLynx()'),
    ).toThrow(
      'pluginAngularLynx(): `intl` lists "Segmenter", 1, which the build can\'t add. It takes any of Collator, DateTimeFormat, DisplayNames, ListFormat, NumberFormat, PluralRules, RelativeTimeFormat.',
    );
  });
});

describe('resolveIntlApis', () => {
  it('adds the APIs each polyfill calls, in the order they load', () => {
    expect(resolveIntlApis(['DateTimeFormat'])).toEqual([
      'PluralRules',
      'NumberFormat',
      'DateTimeFormat',
    ]);
    expect(resolveIntlApis(['RelativeTimeFormat'])).toEqual([
      'PluralRules',
      'NumberFormat',
      'RelativeTimeFormat',
    ]);
    expect(resolveIntlApis(['Collator', 'DisplayNames'])).toEqual([
      'DisplayNames',
      'Collator',
    ]);
    expect(resolveIntlApis(['NumberFormat', 'NumberFormat'])).toEqual([
      'PluralRules',
      'NumberFormat',
    ]);
  });
});

describe('intlApiPackages', () => {
  it("lists FormatJS's package for each API but the Collator, which is ours", () => {
    expect(
      intlApiPackages(
        resolveIntlApis(['ListFormat', 'Collator', 'NumberFormat']),
      ),
    ).toEqual([
      {
        api: 'PluralRules',
        package: '@formatjs/intl-pluralrules',
        perLanguage: true,
      },
      {
        api: 'NumberFormat',
        package: '@formatjs/intl-numberformat',
        perLanguage: false,
      },
      {
        api: 'ListFormat',
        package: '@formatjs/intl-listformat',
        perLanguage: false,
      },
    ]);
  });
});

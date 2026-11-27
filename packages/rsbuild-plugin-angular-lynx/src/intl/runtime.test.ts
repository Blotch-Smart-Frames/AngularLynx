import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CollationData } from './collation-format';
import { collationData } from './collation-data';
import {
  HOST_DEFAULT_LOCALE,
  localZoneTransitions,
  pickLocale,
  setUpIntl,
  UNKNOWN_TIME_ZONE,
  useAppLocaleAsHostDefault,
} from './runtime';

/**
 * Node has `Intl`, which the tests can't take away from their own realm. So
 * they give `setUpIntl` an `Intl` of FormatJS's own constructors (their
 * ponyfills, which don't install themselves), as Lynx has after the
 * polyfills load, and load locale data into it the way the data files do:
 * through `Intl.<constructor>.__addLocaleData`.
 *
 * FormatJS takes a host's default locale and time zone from the global
 * `Intl`, once, as its modules load, and Lynx has none of its own. So each
 * load hides Node's while FormatJS's modules load afresh (vitest.config.ts
 * inlines them, for vi.resetModules()), after `useAppLocaleAsHostDefault()`
 * has run for the phone the test sets up, as the generated module runs it
 * before the polyfills.
 */
const require = createRequire(import.meta.url);

type IntlLike = Record<PropertyKey, any>;

const loadData = (intl: IntlLike, file: string): void => {
  const source = readFileSync(require.resolve(file), 'utf8');
  new Function('Intl', 'globalThis', source)(intl, {});
};

const setGlobalProps = (props: Record<string, unknown> | undefined) => {
  (globalThis as any).lynx = props && { __globalProps: props };
};

/**
 * FormatJS, set up for an `en-US` app with `en`, `fr` and `de` data, on a
 * phone that sends `props`.
 */
const loadFormatJs = async (
  props: Record<string, unknown> | undefined,
  {
    collation,
    strings = {},
  }: { collation?: CollationData; strings?: object } = {},
) => {
  setGlobalProps(props);
  const host = globalThis.Intl;
  const intl: IntlLike = { getCanonicalLocales: host.getCanonicalLocales };
  vi.resetModules();
  let modules;
  try {
    (globalThis as any).Intl = intl;
    useAppLocaleAsHostDefault();
    modules = await Promise.all([
      import('@formatjs/intl-datetimeformat'),
      import('@formatjs/intl-listformat'),
      import('@formatjs/intl-numberformat'),
      import('@formatjs/intl-pluralrules'),
    ]);
  } finally {
    (globalThis as any).Intl = host;
  }
  const [
    { DateTimeFormat },
    { default: ListFormat },
    { NumberFormat },
    { PluralRules },
  ] = modules;
  // Not enumerable, as FormatJS's polyfills define them.
  for (const [name, value] of Object.entries({
    DateTimeFormat,
    ListFormat,
    NumberFormat,
    PluralRules,
  })) {
    Object.defineProperty(intl, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  for (const locale of ['en', 'fr', 'de']) {
    for (const api of [
      'pluralrules',
      'numberformat',
      'datetimeformat',
      'listformat',
    ]) {
      loadData(intl, `@formatjs/intl-${api}/locale-data/${locale}.js`);
    }
  }
  setUpIntl({ sourceLocale: 'en-US', collation }, { intl, strings });
  return { intl, DateTimeFormat: DateTimeFormat as any };
};

/**
 * FormatJS's data and Node's ICU differ in which spaces they use.
 */
const spaces = (text: string) => text.replace(/[\u202f\u00a0]/g, ' ');

let intl: IntlLike;
let DateTimeFormat: any;
let strings: { localeCompare?: (...args: any[]) => number };
// The zones FormatJS had before the tests changed them, and its default.
let zones: Record<string, unknown>;

beforeAll(async () => {
  strings = {};
  ({ intl, DateTimeFormat } = await loadFormatJs(undefined, {
    collation: collationData(['en-US', 'de']),
    strings,
  }));
  zones = DateTimeFormat.tzData;
});

afterEach(() => {
  delete (globalThis as any).lynx;
  delete process.env['TZ'];
  (DateTimeFormat as any).tzData = zones;
});

describe('pickLocale', () => {
  const canonicalize = (tag: string) => Intl.getCanonicalLocales(tag)[0]!;
  const available = ['en', 'en-US', 'fr', 'de'];

  it('picks the first candidate, or its shortest form, that has data', () => {
    expect(pickLocale(available, ['fr-CA', 'en'], canonicalize)).toBe('fr');
    expect(pickLocale(available, [undefined, 'en-us'], canonicalize)).toBe(
      'en-US',
    );
    expect(pickLocale(available, ['ja', 'de-AT'], canonicalize)).toBe('de');
  });

  it("skips what isn't a locale, and falls back to the first with data", () => {
    expect(pickLocale(available, ['not a locale', 'ja'], canonicalize)).toBe(
      'en',
    );
    expect(pickLocale([], ['ja'], canonicalize)).toBe('en');
  });
});

describe('the default locale', () => {
  it("is the phone's language when the app has data for it", async () => {
    const { intl } = await loadFormatJs({ appLocale: 'fr-FR' });
    // FormatJS takes `fr` data to serve `fr-FR` too.
    expect(new intl['NumberFormat']().resolvedOptions().locale).toBe('fr-FR');
    expect(new intl['NumberFormat']().format(1234.5)).toBe('1\u202f234,5');
    expect(new intl['PluralRules']().resolvedOptions().locale).toBe('fr-FR');
    // ListFormat has no default of its own to set, only the host's.
    expect(new intl['ListFormat']().format(['a', 'b'])).toBe('a et b');
  });

  it('is the source locale otherwise, or without a host app', async () => {
    for (const props of [
      { appLocale: 'ja-JP' },
      { appLocale: '' },
      { appLocale: 'not a locale' },
      undefined,
    ]) {
      const { intl } = await loadFormatJs(props);
      expect(new intl['NumberFormat']().resolvedOptions().locale).toBe('en-US');
      expect(new intl['ListFormat']().format(['a', 'b'])).toBe('a and b');
    }
  });

  it("isn't changed by more locale data loading", () => {
    intl['NumberFormat'].__defaultLocale = 'de';
    expect(new intl['NumberFormat']().resolvedOptions().locale).toBe('en-US');
    expect(intl['NumberFormat'].__defaultLocale).toBe('en-US');
  });

  it('is read from __defaultLocale on every call by earlier FormatJS releases', () => {
    // As FormatJS before NumberFormat 10.1 and DateTimeFormat 8.2 kept it.
    const NumberFormat = {
      availableLocales: new Set(['en', 'en-US', 'fr']),
      __defaultLocale: 'en',
    };
    setUpIntl(
      { sourceLocale: 'en-US' },
      {
        intl: { getCanonicalLocales: Intl.getCanonicalLocales, NumberFormat },
        strings: {},
      },
    );
    expect(NumberFormat.__defaultLocale).toBe('en-US');
    setGlobalProps({ appLocale: 'fr-CA' });
    expect(NumberFormat.__defaultLocale).toBe('fr');
  });

  it("is the Collator's too", () => {
    setGlobalProps({ appLocale: 'de-CH' });
    expect(new intl['Collator']().resolvedOptions().locale).toBe('de');
    setGlobalProps(undefined);
    expect(new intl['Collator']().resolvedOptions().locale).toBe('en-US');
  });
});

describe('the default time zone', () => {
  // A summer and a winter date, in a zone that changes its clocks between.
  const winter = new Date(Date.UTC(2026, 0, 15, 13, 5));
  const summer = new Date(Date.UTC(2026, 6, 15, 13, 5));
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  };

  it("is the device's, named as the host app sends it", () => {
    process.env['TZ'] = 'America/New_York';
    setGlobalProps({ appTimeZone: 'America/New_York' });
    const formatJs = new intl['DateTimeFormat']('en', options);
    expect(formatJs.resolvedOptions().timeZone).toBe('America/New_York');
    for (const date of [winter, summer]) {
      expect(spaces(formatJs.format(date))).toBe(
        spaces(
          new Intl.DateTimeFormat('en', {
            ...options,
            timeZone: 'America/New_York',
          }).format(date),
        ),
      );
    }
    // The zone's name comes from the locale data.
    expect(
      spaces(
        new intl['DateTimeFormat']('en', { timeZoneName: 'long' }).format(
          summer,
        ),
      ),
    ).toBe(
      spaces(
        new Intl.DateTimeFormat('en', {
          timeZoneName: 'long',
          timeZone: 'America/New_York',
        }).format(summer),
      ),
    );
    expect(
      new intl['DateTimeFormat']('en', { timeZoneName: 'long' }).format(summer),
    ).toContain('Eastern Daylight Time');
  });

  it("goes by CLDR's unknown zone when the host sends no name", () => {
    process.env['TZ'] = 'Australia/Sydney';
    const formatJs = new intl['DateTimeFormat']('en', options);
    expect(formatJs.resolvedOptions().timeZone).toBe(UNKNOWN_TIME_ZONE);
    expect(spaces(formatJs.format(summer))).toBe('Jul 15, 2026, 11:05 PM');
    expect(spaces(formatJs.format(winter))).toBe('Jan 16, 2026, 12:05 AM');
    // Named explicitly, it's the same zone.
    expect(
      spaces(
        new intl['DateTimeFormat']('en', {
          ...options,
          timeZone: UNKNOWN_TIME_ZONE,
        }).format(winter),
      ),
    ).toBe('Jan 16, 2026, 12:05 AM');
  });

  it("survives the app loading FormatJS's zones, and uses theirs when they have it", () => {
    process.env['TZ'] = 'Europe/Berlin';
    setGlobalProps({ appTimeZone: 'Europe/Berlin' });
    DateTimeFormat.__addTZData({
      zones: ['Europe/Paris|,0,0,0'],
      abbrvs: 'CET',
      offsets: '0',
    });
    // Berlin isn't in that data, so it's still the device's.
    expect(
      spaces(new intl['DateTimeFormat']('en', options).format(summer)),
    ).toBe('Jul 15, 2026, 3:05 PM');
    DateTimeFormat.__addTZData({
      zones: ['Europe/Berlin|,0,0,0'],
      abbrvs: 'CET',
      offsets: '0',
    });
    // Now it is, with (made-up) data that says UTC all year.
    expect(
      spaces(new intl['DateTimeFormat']('en', options).format(summer)),
    ).toBe('Jul 15, 2026, 1:05 PM');
  });

  it('can still be set to another zone', () => {
    DateTimeFormat.__setDefaultTimeZone('UTC');
    expect(new intl['DateTimeFormat']().resolvedOptions().timeZone).toBe('UTC');
  });
});

describe('useAppLocaleAsHostDefault', () => {
  const hostDefault = (props: Record<string, unknown> | undefined) => {
    setGlobalProps(props);
    const bare: IntlLike = { getCanonicalLocales: Intl.getCanonicalLocales };
    useAppLocaleAsHostDefault(bare);
    return bare[HOST_DEFAULT_LOCALE];
  };

  it("is the phone's language, canonical and without its extensions", () => {
    expect(hostDefault({ appLocale: 'fr-fr' })).toBe('fr-FR');
    // Android 14 sends the user's regional preferences with it.
    expect(hostDefault({ appLocale: 'en-GB-u-mu-celsius' })).toBe('en-GB');
  });

  it("is left to FormatJS without a host app's locale", () => {
    expect(hostDefault(undefined)).toBeUndefined();
    expect(hostDefault({ appLocale: 'not a locale' })).toBeUndefined();
  });
});

describe('localZoneTransitions', () => {
  it('finds each change of offset to the second', () => {
    /**
     * A made-up zone: an hour ahead from 1 April to 1 October, 02:00 UTC.
     */
    const offsetAt = (ms: number): number => {
      const date = new Date(ms);
      const year = date.getUTCFullYear();
      return ms >= Date.UTC(year, 3, 1, 2) && ms < Date.UTC(year, 9, 1, 2)
        ? 3600
        : 0;
    };
    const transitions = localZoneTransitions(offsetAt);
    expect(transitions[0]).toEqual([-Infinity, '', 0, false]);
    expect(transitions.slice(1, 3)).toEqual([
      [Date.UTC(1900, 3, 1, 2) / 1000, '', 3600, true],
      [Date.UTC(1900, 9, 1, 2) / 1000, '', 0, false],
    ]);
    expect(transitions).toHaveLength(1 + 2 * 200);
  });

  it("reads the engine's local time by default", () => {
    process.env['TZ'] = 'Asia/Kolkata';
    expect(localZoneTransitions().slice(-1)[0]![2]).toBe(19800);
  });
});

describe('localeCompare', () => {
  it('compares with the Collator', () => {
    expect(strings.localeCompare!.call('ä', 'b', 'de')).toBe(-1);
    expect(strings.localeCompare!.call('é', 'z')).toBe(-1);
  });
});

describe('setUpIntl', () => {
  it('leaves the Collator and localeCompare alone without the Collator data', () => {
    const bare: IntlLike = { getCanonicalLocales: Intl.getCanonicalLocales };
    const prototype = {};
    setUpIntl({ sourceLocale: 'en' }, { intl: bare, strings: prototype });
    expect(bare['Collator']).toBeUndefined();
    expect(prototype).toEqual({});
  });

  it("leaves an engine's own Intl alone", () => {
    const native: IntlLike = {
      getCanonicalLocales: Intl.getCanonicalLocales,
      Collator: Intl.Collator,
      DateTimeFormat: Intl.DateTimeFormat,
      NumberFormat: Intl.NumberFormat,
    };
    const prototype = {};
    setUpIntl(
      { sourceLocale: 'en', collation: collationData(['en']) },
      { intl: native, strings: prototype },
    );
    expect(native['Collator']).toBe(Intl.Collator);
    expect(prototype).toEqual({});
    expect(
      Object.getOwnPropertyDescriptor(Intl.DateTimeFormat, '__defaultTimeZone'),
    ).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(Intl.NumberFormat, '__defaultLocale'),
    ).toBeUndefined();
  });

  it('changes the global Intl and String.prototype by default', () => {
    const { Intl: realIntl } = globalThis;
    const localeCompare = Object.getOwnPropertyDescriptor(
      String.prototype,
      'localeCompare',
    )!;
    const fake: IntlLike = { getCanonicalLocales: Intl.getCanonicalLocales };
    const collation = collationData(['en']);
    try {
      (globalThis as any).Intl = fake;
      setUpIntl({ sourceLocale: 'en', collation });
      expect(fake['Collator']).toBeTypeOf('function');
      expect(String.prototype.localeCompare).not.toBe(localeCompare.value);
    } finally {
      (globalThis as any).Intl = realIntl;
      Object.defineProperty(String.prototype, 'localeCompare', localeCompare);
    }
  });
});

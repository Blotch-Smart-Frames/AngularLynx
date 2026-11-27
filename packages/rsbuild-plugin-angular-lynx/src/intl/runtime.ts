import type { CollationData } from './collation-format.js';
import { createCollator, createLocaleCompare } from './collator.js';

/**
 * What the build's generated `Intl` module (intl-module.ts) runs on both
 * threads of the Lynx bundle, after FormatJS's polyfills and their locale
 * data: it makes them behave like a browser's `Intl` where FormatJS leaves
 * that to the host, and installs our `Intl.Collator`.
 */

declare const lynx: { __globalProps?: Record<string, unknown> } | undefined;

/**
 * A global prop the host app sent, such as `appLocale`. The generated iOS and
 * Android apps send `appLocale` and `appTimeZone`; Lynx Explorer sends
 * neither.
 */
const globalProp = (name: string): string | undefined => {
  const props = typeof lynx === 'undefined' ? undefined : lynx?.__globalProps;
  const value = props?.[name];
  return typeof value === 'string' && value ? value : undefined;
};

/**
 * The first of `candidates`, or its shortest form, that `available` has
 * (ECMA-402's BestAvailableLocale), or else the first locale `available`
 * has, which is the app's source locale: the build loads its data first.
 */
export const pickLocale = (
  available: Iterable<string>,
  candidates: readonly (string | undefined)[],
  canonicalize: (tag: string) => string,
): string => {
  const tags = new Set(available);
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    let tag: string;
    try {
      tag = canonicalize(candidate);
    } catch {
      // Not a locale; the host app sent something else.
      continue;
    }
    const parts = tag.split('-');
    while (parts.length > 0) {
      const prefix = parts.join('-');
      if (tags.has(prefix)) return prefix;
      parts.pop();
    }
  }
  return tags.values().next().value ?? 'en';
};

/**
 * Where FormatJS's locale matcher looks for the host's default locale, on
 * `Intl`, before it asks a host `Intl` of the engine's own. It reads it once,
 * as its module loads. The matcher has done so since 0.10.3, which every
 * polyfill since DateTimeFormat 8.2 and NumberFormat 10.1 uses.
 */
export const HOST_DEFAULT_LOCALE = Symbol.for(
  '@formatjs/intlHostDefaultLocale',
);

/**
 * FormatJS formats in the first locale whose data loaded when it's given
 * none (`new Intl.NumberFormat()`, `n.toLocaleString()`), where a browser
 * uses the user's language. Given a host's default, FormatJS uses that when
 * the app has data for it, and the first locale otherwise. So this makes the
 * phone's language (`appLocale`) the host's default, and the app's source
 * locale, whose data the build loads first, stays the fallback, as
 * `provideLocale()` picks Angular's `LOCALE_ID`.
 *
 * The polyfills that use the key keep their default in their own module, set
 * only from the first data they load: ListFormat, DisplayNames and
 * RelativeTimeFormat have no way to change it at all. So this runs from the
 * generated module's first import, once `Intl.getCanonicalLocales` is there
 * and before any polyfill loads the matcher. Earlier releases ignore the key,
 * and {@link useAppLocaleByDefault} sets theirs.
 *
 * @param intl - The global `Intl`, unless a test passes its own.
 */
export const useAppLocaleAsHostDefault = (
  intl: Record<PropertyKey, unknown> = (
    globalThis as unknown as { Intl: Record<PropertyKey, unknown> }
  ).Intl,
): void => {
  const appLocale = globalProp('appLocale');
  if (appLocale === undefined) return;
  let tag: string;
  try {
    tag = (intl['getCanonicalLocales'] as (locale: string) => string[])(
      appLocale,
    )[0]!;
  } catch {
    // Not a locale; the host app sent something else.
    return;
  }
  // Without its extensions, as FormatJS reads a host's own default:
  // Android 14 adds the user's regional preferences, such as `-u-mu-celsius`,
  // and a default with them would be a locale with no data of its own.
  // An extension starts at its one-letter singleton, such as the `u`.
  const parts = tag.split('-');
  const extension = parts.findIndex((part) => part.length === 1);
  Object.defineProperty(intl, HOST_DEFAULT_LOCALE, {
    configurable: true,
    value: (extension < 0 ? parts : parts.slice(0, extension)).join('-'),
  });
};

/** A FormatJS constructor, with the statics it keeps its locales in. */
type FormatJsConstructor = {
  availableLocales?: Set<string>;
  __defaultLocale?: string;
};

/**
 * The default locale of the FormatJS releases from before
 * {@link HOST_DEFAULT_LOCALE}: each constructor reads it from
 * `__defaultLocale` on every call, so a getter there makes it the phone's
 * language (`appLocale`) when the app has data for it, and the source locale
 * otherwise. Apps may still have those releases: the plugin's peer ranges
 * take them.
 */
const useAppLocaleByDefault = (
  intl: Record<string, unknown>,
  sourceLocale: string,
  canonicalize: (tag: string) => string,
): void => {
  // FormatJS defines its constructors on `Intl` as built-ins are, not
  // enumerable, so `Object.values()` doesn't see them.
  for (const name of Object.getOwnPropertyNames(intl)) {
    const constructor = intl[name] as FormatJsConstructor | undefined;
    if (!(constructor?.availableLocales instanceof Set)) continue;
    const available = constructor.availableLocales;
    const pick = (): string =>
      pickLocale(
        available,
        [globalProp('appLocale'), sourceLocale],
        canonicalize,
      );
    // Later releases of NumberFormat, DateTimeFormat and PluralRules keep
    // the default in their module, which only their own setter reaches.
    // It's what they fall back to when the app has no data for the host's
    // default, and would be the first locale whose data loaded: `en` for an
    // `en-US` app, where a browser says `en-US`.
    Object.getOwnPropertyDescriptor(constructor, '__defaultLocale')?.set?.call(
      constructor,
      pick(),
    );
    Object.defineProperty(constructor, '__defaultLocale', {
      configurable: true,
      get: pick,
      // FormatJS sets it to the first locale it gets data for.
      set: () => {},
    });
  }
};

/** A zone in FormatJS's unpacked time zone data. */
type ZoneTransitions = [
  seconds: number,
  abbreviation: string,
  offsetSeconds: number,
  dst: boolean,
][];

type FormatJsDateTimeFormat = {
  availableLocales: Set<string>;
  tzData: Record<string, ZoneTransitions>;
  __defaultTimeZone?: string;
  __addTZData: (data: unknown) => void;
};

/** The years {@link localZoneTransitions} reads the engine's offsets for. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2100;
/** Short enough that no offset lasts less (Morocco's Ramadan breaks last weeks). */
const STEP = 7 * 24 * 3600 * 1000;

/**
 * The device's time zone as FormatJS's data describes one: every change of
 * UTC offset from 1900 to 2100, read from the engine's `Date`, which applies
 * the device's time zone rules. Each change is found to the second by a
 * binary search between weekly samples.
 */
export const localZoneTransitions = (
  offsetAt: (ms: number) => number = (ms) =>
    -new Date(ms).getTimezoneOffset() * 60,
): ZoneTransitions => {
  const start = Date.UTC(FIRST_YEAR, 0, 1);
  const end = Date.UTC(LAST_YEAR, 0, 1);
  /**
   * Summer time is whichever offset of the year is ahead of the other, in
   * either hemisphere.
   */
  const isDst = (ms: number, offset: number): boolean => {
    const year = new Date(ms).getUTCFullYear();
    const standard = Math.min(
      offsetAt(Date.UTC(year, 0, 1)),
      offsetAt(Date.UTC(year, 6, 1)),
    );
    return offset > standard;
  };
  let offset = offsetAt(start);
  const transitions: ZoneTransitions = [
    [-Infinity, '', offset, isDst(start, offset)],
  ];
  for (let ms = start + STEP; ms <= end; ms += STEP) {
    const next = offsetAt(ms);
    if (next === offset) continue;
    // The change happened after ms - STEP and at or before ms.
    let low = ms - STEP;
    let high = ms;
    while (high - low > 1000) {
      const middle = low + Math.floor((high - low) / 2000) * 1000;
      if (offsetAt(middle) === offset) low = middle;
      else high = middle;
    }
    transitions.push([high / 1000, '', next, isDst(high, next)]);
    offset = next;
  }
  return transitions;
};

/**
 * The name the device's zone goes by when the host app doesn't send one, as
 * Lynx Explorer doesn't: CLDR's identifier for an unknown zone.
 */
export const UNKNOWN_TIME_ZONE = 'Etc/Unknown';

/**
 * FormatJS formats dates in UTC unless it's told a zone, where a browser
 * uses the device's, and knows no zones until the app loads its data
 * (`add-golden-tz.js`, 800 kB). The device's zone is only known by the
 * engine's local time, so it's added to FormatJS's zones as the offsets
 * `Date` gives, under the IANA name the host app sends as `appTimeZone`, and
 * made the default. Named that way, `resolvedOptions().timeZone` is right, and
 * so are the zone's names (`timeZoneName: 'long'`), from the locale data.
 * If the app loads FormatJS's zones and they include the device's, those
 * are used as they are.
 */
const useDeviceTimeZoneByDefault = (
  DateTimeFormat: FormatJsDateTimeFormat,
): void => {
  // Read once per zone, when a date is first formatted in it.
  const transitions = new Map<string, ZoneTransitions>();
  const zone = (): string => globalProp('appTimeZone') ?? UNKNOWN_TIME_ZONE;
  /**
   * Adds the device's zone to the zones, unless they have it already.
   */
  const addDeviceZone = (): string => {
    const name = zone();
    const zones = DateTimeFormat.tzData;
    if (!Object.prototype.hasOwnProperty.call(zones, name)) {
      Object.defineProperty(zones, name, {
        configurable: true,
        enumerable: true,
        get: () => {
          let zoneTransitions = transitions.get(name);
          if (!zoneTransitions) {
            zoneTransitions = localZoneTransitions();
            transitions.set(name, zoneTransitions);
          }
          return zoneTransitions;
        },
      });
    }
    return name;
  };
  /**
   * The zone this last made the default. Once the default is another, the
   * app picked it with `__setDefaultTimeZone()`, and it stays.
   */
  let deviceZone: string | undefined;
  const useDeviceZone = (): void => {
    if (
      deviceZone !== undefined &&
      DateTimeFormat.__defaultTimeZone !== deviceZone
    ) {
      return;
    }
    deviceZone = addDeviceZone();
    // A value, not a getter: since 8.2, DateTimeFormat takes a default only
    // when it's a plain value naming a zone it has, and uses the host's zone
    // or UTC otherwise.
    Object.defineProperty(DateTimeFormat, '__defaultTimeZone', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: deviceZone,
    });
  };
  // Every `new Intl.DateTimeFormat()`, and so every `toLocaleString()` on a
  // date, reads `availableLocales` before it takes the default zone. So the
  // default is the zone the host app last sent, each time one is made.
  const available = DateTimeFormat.availableLocales;
  Object.defineProperty(DateTimeFormat, 'availableLocales', {
    configurable: true,
    get: () => {
      useDeviceZone();
      return available;
    },
  });
  // Loading FormatJS's zones replaces the whole map.
  const addTZData = DateTimeFormat.__addTZData;
  DateTimeFormat.__addTZData = (data: unknown) => {
    addTZData.call(DateTimeFormat, data);
    addDeviceZone();
  };
  useDeviceZone();
};

export type IntlSetupOptions = {
  /** angular.json's `i18n.sourceLocale`. */
  readonly sourceLocale: string;
  /** The collation tables, when the app asked for `Collator`. */
  readonly collation?: CollationData;
};

/**
 * Runs once on each thread, after FormatJS's polyfills and data.
 *
 * @param target - What it changes: the global `Intl` and
 *   `String.prototype`, unless a test passes its own.
 */
export const setUpIntl = (
  { sourceLocale, collation }: IntlSetupOptions,
  {
    intl = (globalThis as unknown as { Intl: Record<string, unknown> }).Intl,
    strings = String.prototype,
  }: { intl?: Record<string, unknown>; strings?: object } = {},
): void => {
  const getCanonicalLocales = intl['getCanonicalLocales'] as (
    locales: unknown,
  ) => string[];
  const canonicalize = (tag: string): string => getCanonicalLocales(tag)[0]!;
  useAppLocaleByDefault(intl, sourceLocale, canonicalize);
  // Only FormatJS's: an engine with its own `Intl`, where the polyfills
  // install nothing, already does all this. iOS once ran the background
  // thread on JavaScriptCore, which has one.
  const DateTimeFormat = intl['DateTimeFormat'] as
    | FormatJsDateTimeFormat
    | undefined;
  if (DateTimeFormat?.tzData) useDeviceTimeZoneByDefault(DateTimeFormat);
  if (collation && typeof intl['Collator'] !== 'function') {
    const Collator = createCollator({
      data: collation,
      defaultLocale: (available) =>
        pickLocale(
          available,
          [globalProp('appLocale'), sourceLocale],
          canonicalize,
        ),
      canonicalize: (locales) =>
        locales === undefined ? [] : getCanonicalLocales(locales),
    });
    Object.defineProperty(intl, 'Collator', {
      configurable: true,
      writable: true,
      value: Collator,
    });
    Object.defineProperty(strings, 'localeCompare', {
      configurable: true,
      writable: true,
      value: createLocaleCompare(Collator),
    });
  }
};

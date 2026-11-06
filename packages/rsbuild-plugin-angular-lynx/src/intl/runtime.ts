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

/** A FormatJS constructor, with the statics it keeps its locales in. */
type FormatJsConstructor = {
  availableLocales?: Set<string>;
  __defaultLocale?: string;
};

/**
 * FormatJS formats in the first locale whose data loaded when it's given
 * none (`new Intl.NumberFormat()`, `n.toLocaleString()`), where a browser
 * uses the user's language. Each constructor reads its default from
 * `__defaultLocale` on every call, so a getter there makes it the phone's
 * language (`appLocale`) when the app has data for it, and the source locale
 * otherwise, as `provideLocale()` picks Angular's `LOCALE_ID`.
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
    Object.defineProperty(constructor, '__defaultLocale', {
      configurable: true,
      get: () =>
        pickLocale(
          available,
          [globalProp('appLocale'), sourceLocale],
          canonicalize,
        ),
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
   * Called before FormatJS reads the zones, so the device's is there.
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
  Object.defineProperty(DateTimeFormat, '__defaultTimeZone', {
    configurable: true,
    get: addDeviceZone,
    // `__setDefaultTimeZone()` still picks another zone.
    set: (value: string) => {
      Object.defineProperty(DateTimeFormat, '__defaultTimeZone', {
        configurable: true,
        writable: true,
        value,
      });
    },
  });
  // Loading FormatJS's zones replaces the whole map.
  const addTZData = DateTimeFormat.__addTZData;
  DateTimeFormat.__addTZData = (data: unknown) => {
    addTZData.call(DateTimeFormat, data);
    addDeviceZone();
  };
  addDeviceZone();
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

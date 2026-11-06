/**
 * The `Intl` APIs the build can add to the Lynx bundle, which PrimJS doesn't
 * have on either thread (see investigations/lynx-vs-web-differences.md).
 * Every one but `Collator` is FormatJS's polyfill; FormatJS has no Collator,
 * so that one is ours (`collator.ts`).
 */
export const INTL_APIS = [
  'Collator',
  'DateTimeFormat',
  'DisplayNames',
  'ListFormat',
  'NumberFormat',
  'PluralRules',
  'RelativeTimeFormat',
] as const;

export type IntlApi = (typeof INTL_APIS)[number];

type ApiInfo = {
  /** The FormatJS package, or none for our own Collator. */
  readonly package?: string;
  /**
   * The APIs this one's polyfill calls: FormatJS's NumberFormat formats its
   * plural forms with `Intl.PluralRules`, and its DateTimeFormat and
   * RelativeTimeFormat format their numbers with `Intl.NumberFormat`.
   */
  readonly needs: readonly IntlApi[];
  /**
   * Whether the package has one data file per language only, as PluralRules
   * does (`pt-PT` is its one exception), rather than one per locale.
   */
  readonly perLanguage?: boolean;
};

const API_INFO: Readonly<Record<IntlApi, ApiInfo>> = {
  Collator: { needs: [] },
  DateTimeFormat: {
    package: '@formatjs/intl-datetimeformat',
    needs: ['NumberFormat'],
  },
  DisplayNames: { package: '@formatjs/intl-displaynames', needs: [] },
  ListFormat: { package: '@formatjs/intl-listformat', needs: [] },
  NumberFormat: {
    package: '@formatjs/intl-numberformat',
    needs: ['PluralRules'],
  },
  PluralRules: {
    package: '@formatjs/intl-pluralrules',
    needs: [],
    perLanguage: true,
  },
  RelativeTimeFormat: {
    package: '@formatjs/intl-relativetimeformat',
    needs: ['NumberFormat'],
  },
};

/**
 * Every FormatJS polyfill reads locales with these two, so they come first.
 * They have no locale data.
 */
export const BASE_PACKAGES = [
  '@formatjs/intl-getcanonicallocales',
  '@formatjs/intl-locale',
] as const;

/**
 * The order the polyfills load in: each after the ones it calls. They only
 * call each other when formatting, but loading them in this order keeps that
 * true even if one starts to at load time.
 */
const LOAD_ORDER: readonly IntlApi[] = [
  'PluralRules',
  'NumberFormat',
  'DateTimeFormat',
  'RelativeTimeFormat',
  'ListFormat',
  'DisplayNames',
  'Collator',
];

export type IntlApiPackage = {
  readonly api: IntlApi;
  readonly package: string;
  readonly perLanguage: boolean;
};

/**
 * Checks the `intl` option, from angular.json or the plugin's options.
 *
 * @param value - The option as written.
 * @param where - Where it was written, for the error message.
 * @returns The APIs it names, or none when it's unset.
 */
export const parseIntlOption = (value: unknown, where: string): IntlApi[] => {
  if (value === undefined || value === null) {
    return [];
  }
  const names = Array.isArray(value) ? value : [value];
  const unknown = names.filter(
    (name) => !(INTL_APIS as readonly unknown[]).includes(name),
  );
  if (unknown.length > 0) {
    throw new Error(
      `${where}: \`intl\` lists ${unknown.map((name) => JSON.stringify(name)).join(', ')}, which the build can't add. It takes any of ${INTL_APIS.join(', ')}.`,
    );
  }
  return names as IntlApi[];
};

/**
 * The APIs to add for `requested`: those, and the ones their polyfills call,
 * in the order they load.
 */
export const resolveIntlApis = (requested: readonly IntlApi[]): IntlApi[] => {
  const apis = new Set<IntlApi>();
  const add = (api: IntlApi): void => {
    if (apis.has(api)) return;
    apis.add(api);
    API_INFO[api].needs.forEach(add);
  };
  requested.forEach(add);
  return LOAD_ORDER.filter((api) => apis.has(api));
};

/** The FormatJS packages `apis` (as {@link resolveIntlApis} gives them) load. */
export const intlApiPackages = (apis: readonly IntlApi[]): IntlApiPackage[] =>
  apis.flatMap((api) => {
    const info = API_INFO[api];
    return info.package
      ? [{ api, package: info.package, perLanguage: !!info.perLanguage }]
      : [];
  });

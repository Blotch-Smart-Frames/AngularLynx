/**
 * The locales an app is built for: angular.json's `i18n.sourceLocale` first,
 * then each of `i18n.locales`, canonicalized (`en-us` becomes `en-US`) and
 * without repeats. The source locale comes first because it's the fallback
 * when the phone's language isn't one of them.
 */
export const appLocales = (
  sourceLocale: string,
  locales: readonly string[],
): string[] => {
  const tags = [sourceLocale, ...locales].map((tag) => {
    try {
      return Intl.getCanonicalLocales(tag)[0]!;
    } catch {
      throw new Error(
        `angular.json's i18n lists ${JSON.stringify(tag)}, which isn't a locale. Use a BCP 47 tag such as "fr" or "pt-BR".`,
      );
    }
  });
  return [...new Set(tags)];
};

/**
 * The tags whose data could serve `tag`, most specific first. FormatJS has
 * data for `en` but not `en-US`, for `zh-Hant` but not `zh-TW`, and for `pt`
 * (Brazilian) and `pt-PT`, so the tag alone isn't enough: `zh-TW` has to find
 * `zh-Hant` before it falls back to `zh`, whose data is Simplified Chinese.
 * So the script that the tag implies (its likely subtags) comes before the
 * tag's own shorter forms.
 */
export const dataLocaleCandidates = (tag: string): string[] => {
  const locale = new Intl.Locale(tag);
  const max = locale.maximize();
  const truncations = (name: string): string[] => {
    const parts = name.split('-');
    return parts.map((_, end) => parts.slice(0, parts.length - end).join('-'));
  };
  const candidates = [
    locale.baseName,
    `${max.language}-${max.script}-${max.region}`,
    `${max.language}-${max.script}`,
    ...truncations(locale.baseName),
  ];
  return [...new Set(candidates)];
};

/**
 * The tag of the data that serves `tag`, as {@link dataLocaleCandidates}
 * orders them, or `undefined` when there's none.
 *
 * @param has - Whether there's data for a tag.
 */
export const findDataLocale = (
  tag: string,
  has: (candidate: string) => boolean,
): string | undefined => dataLocaleCandidates(tag).find(has);

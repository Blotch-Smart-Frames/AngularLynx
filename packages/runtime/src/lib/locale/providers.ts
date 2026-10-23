import { getLocaleId } from '@angular/common';
import {
  type EnvironmentProviders,
  inject,
  LOCALE_ID,
  makeEnvironmentProviders,
} from '@angular/core';
import { getSourceLocale, LynxLocale } from './lynx-locale';

/**
 * Whether Angular has locale data for `locale`, or for its language (`fr`
 * for `fr-CA`). Its pipes and plural rules throw without it.
 */
const hasLocaleData = (locale: string): boolean => {
  try {
    // Throws NG0701 when there's none. Deprecated in favor of Intl, which
    // Lynx's JavaScript engine doesn't have; Angular's pipes still use it.
    getLocaleId(locale);
    return true;
  } catch {
    return false;
  }
};

/**
 * Provides Angular's `LOCALE_ID` token from the Lynx runtime locale.
 *
 * Add this to your application's providers to automatically configure
 * Angular's locale-aware features (pipes, i18n) with the locale from
 * `lynx.__globalProps.appLocale`.
 *
 * The apps that `ng build --platform` makes send the phone's language, which
 * the app may not support. When Angular has no locale data for it (see
 * `registerLocaleData()`), `LOCALE_ID` is the app's source locale instead, as
 * a native app shows its own language on a phone set to one it lacks.
 * Otherwise Angular's date and number pipes would throw.
 *
 * @usageNotes
 * ```typescript
 * bootstrapApplication(App, {
 *   providers: [provideRenderer(), provideLocale()],
 * });
 * ```
 */
export const provideLocale = (): EnvironmentProviders => {
  return makeEnvironmentProviders([
    {
      provide: LOCALE_ID,
      useFactory: () => {
        const locale = inject(LynxLocale).locale();
        const source = getSourceLocale();
        if (locale === source || hasLocaleData(locale)) {
          return locale;
        }
        console.warn(
          `provideLocale(): Angular has no locale data for "${locale}", so LOCALE_ID is "${source}". Register it with registerLocaleData() to format dates and numbers for it.`,
        );
        return source;
      },
    },
  ]);
};

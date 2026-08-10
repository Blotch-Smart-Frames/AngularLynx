import {
  type EnvironmentProviders,
  inject,
  LOCALE_ID,
  makeEnvironmentProviders,
} from '@angular/core';
import { LynxLocale } from './lynx-locale';

/**
 * Provides Angular's `LOCALE_ID` token from the Lynx runtime locale.
 *
 * Add this to your application's providers to automatically configure
 * Angular's locale-aware features (pipes, i18n) with the locale from
 * `lynx.__globalProps.appLocale`.
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
      useFactory: () => inject(LynxLocale).locale(),
    },
  ]);
};

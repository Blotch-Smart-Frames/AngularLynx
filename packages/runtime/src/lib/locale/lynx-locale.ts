import { computed, inject, Injectable } from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';

/**
 * Pulls a validated `appLocale` string out of a Lynx global-props bag.
 * Shared by `getLynxAppLocale()` and `LynxLocale` so both agree on what
 * counts as "the host set a locale" (a non-empty string).
 */
const extractAppLocale = (
  globalProps: Record<string, unknown> | undefined,
): string | undefined => {
  const value = globalProps?.['appLocale'];
  return typeof value === 'string' && value ? value : undefined;
};

/**
 * Reads `lynx.__globalProps.appLocale` directly, without Angular DI.
 *
 * Use this before `bootstrapApplication()` runs — e.g. to conditionally call
 * `loadTranslations()` — since no injector exists yet at that point. Once the
 * app is bootstrapped, prefer injecting `LynxLocale` for reactive access.
 *
 * Returns `undefined` outside a Lynx environment or when the host hasn't set
 * a locale; callers decide their own fallback.
 *
 * @usageNotes
 * ```typescript
 * if (getLynxAppLocale() === 'fr') {
 *   loadTranslations({ 'app.greeting': 'Bonjour le monde !' });
 * }
 *
 * bootstrapApplication(App, appConfig);
 * ```
 */
export const getLynxAppLocale = (): string | undefined => {
  if (typeof lynx === 'undefined') {
    return undefined;
  }
  return extractAppLocale(lynx.__globalProps as Record<string, unknown>);
};

/**
 * Provides reactive access to the current locale on Lynx.
 *
 * Reads `lynx.__globalProps.appLocale` (set by the native host). Falls back to
 * the `sourceLocale` from angular.json (injected as `__LYNX_SOURCE_LOCALE__`
 * at build time), then to `'en-US'`.
 *
 * @usageNotes
 * ```typescript
 * const locale = inject(LynxLocale);
 *
 * // Reactive in templates
 * template: `<text>Current locale: {{ locale.locale() }}</text>`
 *
 * // For LOCALE_ID integration, add provideLocale() to your app config
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxLocale {
  readonly #globalData = inject(LynxGlobalData);

  /**
   * The current locale. Reactive — updates when global props change.
   */
  readonly locale = computed(() => {
    const value = extractAppLocale(
      this.#globalData.globalData() as Record<string, unknown>,
    );
    if (value) {
      return value;
    }
    // Fall back to the compile-time source locale from angular.json
    return typeof __LYNX_SOURCE_LOCALE__ !== 'undefined'
      ? __LYNX_SOURCE_LOCALE__
      : 'en-US';
  });
}

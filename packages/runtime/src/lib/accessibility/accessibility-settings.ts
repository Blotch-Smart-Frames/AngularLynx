import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { LynxGlobalData } from '../data-flow/global-data';

/**
 * Each setting, by the name of the global prop a host app sends it as, with
 * the media query a browser reports it through.
 */
const MEDIA_QUERIES = {
  reduceMotion: '(prefers-reduced-motion: reduce)',
  reduceTransparency: '(prefers-reduced-transparency: reduce)',
  increaseContrast: '(prefers-contrast: more)',
} as const;

type Setting = keyof typeof MEDIA_QUERIES;

/**
 * Whether the host app turned a setting on: `true`, or `'true'`, the string
 * Lynx Explorer passes for a query parameter of the bundle URL
 * (`?reduceMotion=true`), which makes the settings easy to try out there.
 */
const isOn = (data: Record<string, unknown>, setting: Setting): boolean =>
  data[setting] === true || data[setting] === 'true';

/**
 * The window the page is drawn in, on Lynx for Web: its main thread runs in an
 * iframe while its elements belong to the page, so the user's preferences
 * have to come from the page element's window, not this realm's. Native Lynx
 * has no media queries at all.
 */
const pageWindow = (): Window | undefined => {
  if (!__WEB__ || typeof __GetPageElement !== 'function') return undefined;
  const page = __GetPageElement() as unknown as
    | { ownerDocument?: Document }
    | undefined;
  return page?.ownerDocument?.defaultView ?? undefined;
};

/**
 * The text scale the host app sent as `textScale`: a positive number, or the
 * string Lynx Explorer passes for a query parameter of the bundle URL
 * (`?textScale=1.5`). Anything else, or nothing, is the system default, 1.
 */
const textScaleOf = (data: Record<string, unknown>): number => {
  const value = data['textScale'];
  const scale =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

/**
 * One signal per setting that follows the page's media query on the web, and
 * stays `false` elsewhere.
 */
const watchMediaQueries = (
  destroyRef: DestroyRef,
): Record<Setting, Signal<boolean>> => {
  const win = pageWindow();
  const signals = {} as Record<Setting, Signal<boolean>>;
  for (const setting of Object.keys(MEDIA_QUERIES) as Setting[]) {
    const query =
      typeof win?.matchMedia === 'function'
        ? win.matchMedia(MEDIA_QUERIES[setting])
        : undefined;
    const matches = signal(query?.matches ?? false);
    if (query) {
      const update = () => matches.set(query.matches);
      query.addEventListener('change', update);
      destroyRef.onDestroy(() => query.removeEventListener('change', update));
    }
    signals[setting] = matches.asReadonly();
  }
  return signals;
};

/**
 * The user's accessibility display settings, as signals: Reduce Motion,
 * Reduce Transparency, Increase Contrast and the text size.
 *
 * Lynx has no API for them on any platform, so they come from the host app,
 * in its global props, like the theme does: `reduceMotion`,
 * `reduceTransparency` and `increaseContrast`, each `true` when on. The apps
 * `ng build --platform` makes send them, and send them again when the user
 * changes one:
 *
 * - **iOS:** `UIAccessibility.isReduceMotionEnabled`,
 *   `isReduceTransparencyEnabled` and `isDarkerSystemColorsEnabled`
 *   (Increase Contrast).
 * - **Android:** Remove animations (an animator duration scale of 0) for
 *   Reduce Motion, and contrast above standard (Android 14) or high contrast
 *   text (Android 16) for Increase Contrast. Android has no Reduce
 *   Transparency setting.
 *
 * The text size is `textScale`, a number: 1 at the system's default size,
 * from iOS's Dynamic Type and Android's font size (see
 * {@link LynxAccessibilitySettings.textScale}).
 *
 * In the web preview they follow the browser's `prefers-reduced-motion`,
 * `prefers-reduced-transparency` and `prefers-contrast: more` too. Lynx
 * Explorer sends none of them, so they're off there, unless you add them to
 * the bundle URL: `?reduceMotion=true`.
 *
 * iOS 27's Liquid Glass appearance setting (clear or tinted glass) has no
 * public API, so it isn't here. UIKit's glass follows it, and Reduce
 * Transparency and Increase Contrast, by itself.
 *
 * @usageNotes
 * ```typescript
 * const settings = inject(LynxAccessibilitySettings);
 *
 * // Jump instead of sliding when the user asked for less motion.
 * const duration = computed(() => (settings.reduceMotion() ? 0 : 250));
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxAccessibilitySettings {
  readonly #globalData = inject(LynxGlobalData);
  readonly #media = watchMediaQueries(inject(DestroyRef));

  /**
   * The user asked for less motion. Replace movement, such as a slide or a
   * bounce, with a fade or an instant change.
   */
  readonly reduceMotion = this.#setting('reduceMotion');

  /**
   * The user asked for less transparency. Draw blurred and translucent
   * surfaces opaque.
   */
  readonly reduceTransparency = this.#setting('reduceTransparency');

  /**
   * The user asked for more contrast: iOS's Increase Contrast. Strengthen
   * borders and use full-strength text colors.
   */
  readonly increaseContrast = this.#setting('increaseContrast');

  /**
   * How much larger than the system's default the user's text is: 1 at the
   * default size, 1.5 when they chose text half as large again, and below 1
   * for the smaller sizes iOS offers. From iOS's Dynamic Type (Settings >
   * Display & Brightness > Text Size, and the larger accessibility sizes) and
   * Android's font size (Settings > Display > Font size), capped by the
   * native build's `textScaling.max`, and 1 with `"textScaling": false`.
   *
   * The app's text already follows it: the page's root font size grows by it
   * in the apps `ng build --platform` makes, so every size in `rem` grows
   * with it, and a size in `px` doesn't. Read it to change a layout that
   * can't simply grow, such as a row that wraps its label under the icon at
   * a large size.
   *
   * 1 in the web preview and in Lynx Explorer, unless you add it to the
   * bundle URL there: `?textScale=1.5` (which changes this signal, not the
   * page's text).
   */
  readonly textScale: Signal<number> = computed(() =>
    textScaleOf(this.#globalData.globalData() as Record<string, unknown>),
  );

  #setting(setting: Setting): Signal<boolean> {
    return computed(
      () =>
        isOn(
          this.#globalData.globalData() as Record<string, unknown>,
          setting,
        ) || this.#media[setting](),
    );
  }
}

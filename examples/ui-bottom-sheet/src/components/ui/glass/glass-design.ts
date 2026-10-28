import {
  computed,
  inject,
  InjectionToken,
  Injector,
  type Provider,
  type Signal,
} from '@angular/core';
import { LynxSystemInfo } from '@blotch/angular-lynx';

/**
 * The look the glass components take on this platform. One API covers all
 * three, and each component builds its own form of each: the dock is a
 * floating glass capsule with `'glass'`, a tab bar on a blur material with
 * `'frosted'`, and a navigation bar with `'material'`.
 *
 * - `'glass'`: Liquid Glass. iOS 26 and later draw it with UIKit's glass,
 *   the web preview draws it with WebGL, and Android, when the app opts in
 *   with {@link provideGlass}, approximates it with a blur, a tint and a rim.
 * - `'frosted'`: Apple's design before Liquid Glass, for iOS 15 to 25, whose
 *   `blur-view` has no glass: frosted blur materials.
 * - `'material'`: Material 3 Expressive, Android's default, which uses
 *   opaque tonal surfaces instead of glass.
 */
export type GlassDesign = 'glass' | 'frosted' | 'material';

export type GlassOptions = {
  /**
   * What Android gets: `'material'` (the default), or `'glass'` for the same
   * look as iOS. Android's glass is a blur with a tint and a rim over it,
   * without the refraction. Blurring costs more below Android 12, where Lynx
   * can't use `RenderEffect`.
   */
  readonly android?: 'material' | 'glass';
};

/** The app's glass options; see {@link provideGlass}. */
export const UI_GLASS_OPTIONS = new InjectionToken<GlassOptions>(
  'UI_GLASS_OPTIONS',
  { providedIn: 'root', factory: () => ({}) },
);

/**
 * Sets the glass options for the whole app, in `app.config.ts`:
 *
 * ```ts
 * // Liquid Glass on Android too, instead of Material.
 * providers: [provideGlass({ android: 'glass' })]
 * ```
 */
export const provideGlass = (options: GlassOptions): Provider => ({
  provide: UI_GLASS_OPTIONS,
  useValue: options,
});

/** The first iOS whose `blur-view` draws Liquid Glass. */
export const FIRST_GLASS_IOS = 26;

/**
 * The design for a platform, as `SystemInfo` names it, and its OS version.
 *
 * Before iOS 26, Lynx's `blur-view` doesn't know `blur-effect="glass"`: it
 * logs an error and draws a `light` blur that ignores dark mode. So older
 * iOS gets `'frosted'`. An iOS version that isn't known yet (empty) counts as
 * current: on the native main thread it arrives from the background thread
 * after the first frame, unless the host app sends it (see
 * `LynxSystemInfo.osVersion`), and iOS 26 and later is where most phones are.
 * Platforms with no glass, such as HarmonyOS, get `'material'`.
 */
export const glassDesignFor = (
  platform: string | undefined,
  osVersion: string,
  options: GlassOptions,
): GlassDesign => {
  switch (platform) {
    case 'iOS':
      return parseInt(osVersion, 10) < FIRST_GLASS_IOS ? 'frosted' : 'glass';
    case 'Android':
      return options.android ?? 'material';
    case 'web':
      return 'glass';
    default:
      return 'material';
  }
};

/**
 * LynxSystemInfo, or undefined where there's no SystemInfo to read, such as
 * in unit tests, where LynxSystemInfo throws.
 */
const systemInfo = (injector: Injector): LynxSystemInfo | undefined => {
  try {
    return injector.get(LynxSystemInfo);
  } catch {
    return undefined;
  }
};

/**
 * The glass design on this platform, for a component's constructor or field
 * initializers. A signal: on the native main thread, iOS's version can arrive
 * after the first frame.
 */
export const injectGlassDesign = (): Signal<GlassDesign> => {
  const options = inject(UI_GLASS_OPTIONS);
  const info = systemInfo(inject(Injector));
  return computed(() =>
    glassDesignFor(info?.platform, info?.osVersion ?? '', options),
  );
};

/**
 * Whether the system draws the glass and its materials itself: iOS. UIKit
 * adapts them to Reduce Transparency, Increase Contrast and iOS 27's Liquid
 * Glass setting on its own. Elsewhere, Android's approximation and the web
 * preview's drawing can't, so the components adapt what they draw.
 */
export const injectSystemDrawsGlass = (): boolean =>
  systemInfo(inject(Injector))?.platform === 'iOS';

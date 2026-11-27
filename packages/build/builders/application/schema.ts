import type { NativeAppOptions } from '@blotch/angular-lynx-native' with {
  'resolution-mode': 'import',
};

/** The options in schema.json. Keep the two in sync. */
export type ApplicationBuilderOptions = NativeAppOptions & {
  readonly platform?: 'ios' | 'android' | 'all';
  readonly run?: boolean;
  readonly device?: string;
  readonly watch?: boolean;
  readonly config?: string;
  readonly environment?: string[];
  /** The URL path the app is served under: the web bundle's asset prefix. */
  readonly baseHref?: string;
  /**
   * The `Intl` APIs @blotch/rsbuild-plugin-angular-lynx adds to the Lynx
   * bundle, which reads the option from the build options it's passed.
   */
  readonly intl?: readonly string[];
  /**
   * Whether touch events carry every finger (Lynx's `enableMultiTouch` page
   * config), which @blotch/rsbuild-plugin-angular-lynx reads from the build
   * options it's passed.
   */
  readonly multiTouch?: boolean;
  /**
   * Whether the background thread's script drops the app's module-level
   * values nothing there reads, which @blotch/rsbuild-plugin-angular-lynx
   * reads from the build options it's passed.
   */
  readonly backgroundTreeShaking?: 'safe' | 'aggressive';
  /**
   * The Angular compiler options `ng new` puts in the build target (browser,
   * tsConfig, polyfills, styles, optimization, ...).
   * @blotch/rsbuild-plugin-angular-lynx and `ng test` read them;
   * `optimization` also picks rspeedy's mode, and `browser` its entry.
   */
  readonly [angularOption: string]: unknown;
};

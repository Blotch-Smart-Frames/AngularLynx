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
  /**
   * The Angular compiler options `ng new` puts in the build target (browser,
   * tsConfig, polyfills, styles, optimization, ...).
   * @blotch/rsbuild-plugin-angular-lynx and `ng test` read them;
   * `optimization` also picks rspeedy's mode, and `browser` its entry.
   */
  readonly [angularOption: string]: unknown;
};

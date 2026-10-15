import type { NativeAppOptions } from '@blotch/angular-lynx-native' with {
  'resolution-mode': 'import',
};

/** The options in schema.json. Keep the two in sync. */
export type ApplicationBuilderOptions = NativeAppOptions & {
  readonly platform?: 'ios' | 'android' | 'all';
  readonly config?: string;
  readonly mode?: 'production' | 'development';
  readonly environment?: string[];
  /**
   * The Angular compiler options `ng new` puts in the build target (browser,
   * tsConfig, polyfills, styles, ...). This builder doesn't use them itself:
   * @blotch/rsbuild-plugin-angular-lynx and `ng test` read them from
   * angular.json.
   */
  readonly [angularOption: string]: unknown;
};

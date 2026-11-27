import { isAngularLynxPackageModule, THIRD_PARTY } from './layers.js';

/**
 * How much of the files it loads the background thread's script keeps:
 *
 * - `'safe'`, the default: every top-level statement of the app's files the
 *   background thread loads runs there, as the docs promise ("The rest of that
 *   file's top-level code runs on both threads").
 * - `'aggressive'`: the app's own module-level values are dropped from the
 *   background thread's script when nothing there reads them, as AngularLynx's
 *   own packages' always are (see pure-initializers.ts). A declaration whose
 *   value nothing reads, but whose initializer does something on purpose, such
 *   as subscribing to a global event emitter, no longer runs there.
 */
export type BackgroundTreeShaking = 'safe' | 'aggressive';

/** The values `backgroundTreeShaking` takes, for checking angular.json's. */
const MODES: readonly BackgroundTreeShaking[] = ['safe', 'aggressive'];

/**
 * The mode a build uses: the plugin's own option wins, as `multiTouch`'s does,
 * since a plain rspeedy app has no Angular CLI build options to set it in.
 * Otherwise angular.json's `backgroundTreeShaking` build option, which the
 * builder's schema has already checked, and `'safe'` without either.
 *
 * @param option - The plugin's `backgroundTreeShaking` option.
 * @param buildOptions - The Angular CLI's build options, under `ng build` or
 *   `ng serve`.
 * @returns The mode to build with.
 */
export const resolveBackgroundTreeShaking = (
  option: BackgroundTreeShaking | undefined,
  buildOptions: Readonly<Record<string, unknown>> | undefined,
): BackgroundTreeShaking => {
  const value = option ?? buildOptions?.['backgroundTreeShaking'] ?? 'safe';
  if (!MODES.includes(value as BackgroundTreeShaking)) {
    // A plain rspeedy app's lynx.config.ts may be JavaScript, which nothing
    // type-checks. A typo silently building 'safe' would look like the option
    // saved nothing.
    throw new Error(
      `pluginAngularLynx(): backgroundTreeShaking must be 'safe' or 'aggressive', not ${JSON.stringify(value)}.`,
    );
  }
  return value as BackgroundTreeShaking;
};

/**
 * Whether the background layer's copy of `file` gets its module-level values
 * made droppable (wrapPureInitializers). AngularLynx's own packages always do:
 * the background thread uses almost none of the runtime's (issue #710). With
 * `'aggressive'`, so do the app's own files, including the ones it compiles
 * from source, such as dolan's copies of `@blotch/ui`. Other packages never
 * do, as in Angular's own build, which marks top-level calls pure only in
 * `@angular/*` packages (`topLevelSafeMode` in `@angular/build`'s
 * `oxc-transform.js`): a package can't be assumed to keep its side effects out
 * of its variable declarations.
 *
 * @param file - The module's path.
 * @param mode - The build's `backgroundTreeShaking` mode.
 * @returns Whether to wrap the module's initializers.
 */
export const wrapsBackgroundInitializers = (
  file: string,
  mode: BackgroundTreeShaking,
): boolean =>
  isAngularLynxPackageModule(file) ||
  (mode === 'aggressive' && !THIRD_PARTY.test(file));

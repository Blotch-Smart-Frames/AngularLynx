import type { BackgroundTreeShaking } from '../background-tree-shaking.js';
import type { IntlApi } from '../intl/apis.js';

/** The frame rates Lynx's `preferredFps` page config takes. */
export type PreferredFps = 'high' | 'auto' | 'low';

export type PluginAngularLynxOptions = {
  /**
   * How much of the app's own code the background thread's script keeps.
   * `'safe'`, the default, runs every top-level statement of the files the
   * background thread loads (those that define a `backgroundFn()` or a
   * `MainThreadRef`, and their imports). `'aggressive'` drops the app's
   * module-level values that nothing on the background thread reads, which
   * makes that script smaller, but a top-level declaration whose value
   * nothing reads there no longer runs there either, even when it does
   * something on purpose, such as subscribing to a global event emitter. The
   * same as the `backgroundTreeShaking` build option in angular.json, which
   * this replaces when set.
   */
  backgroundTreeShaking?: BackgroundTreeShaking | undefined;
  /**
   * The properties that inherit with `enableCSSInheritance`, in place of
   * Lynx's list. `['font-size']` unless the app turns `enableCSSInheritance`
   * on itself, which then means Lynx's whole list, as it always has.
   */
  customCSSInheritanceList?: string[] | undefined;
  debugInfoOutside?: boolean;
  defaultDisplayLinear?: boolean;
  /**
   * Compile the app's `import()`s on the main thread, such as a lazy
   * route's `loadComponent: () => import('./x')`, as static imports, so
   * rspack can concatenate the modules they share with the rest of the app
   * and the main-thread script is smaller (24 kB of the benchmark app's
   * 635 kB). Off by default, because each module they load then runs when
   * the app starts, as a static import does: its top-level code runs at
   * launch, and an import cycle through the routes file that an `import()`
   * broke can make a top-level read a used-before-defined error. `@defer`
   * blocks' imports stay lazy. Has no effect with
   * `experimental_isLazyBundle`. The same as the `eagerImports` build option
   * in angular.json, which this replaces when set.
   */
  eagerImports?: boolean | undefined;
  /**
   * Make `overflow: visible` the default for every element, as on the web.
   * With `false`, elements clip their children unless they set `overflow`,
   * Lynx's older default.
   */
  defaultOverflowVisible?: boolean;
  enableA11y?: boolean;
  enableAccessibilityElement?: boolean;
  /**
   * Let text properties inherit from the elements around them, as on the
   * web. On by default for `font-size` alone (see customCSSInheritanceList),
   * so a `<text>` with no size of its own takes its parent's. With `false`,
   * nothing inherits, and such a `<text>` takes the page's size.
   */
  enableCSSInheritance?: boolean;
  /**
   * Restyle the elements a combinator selector matches when a class or ID
   * it depends on changes, as a browser does: when `page` gains the `dark`
   * class, every `page.dark .card` restyles. On by default, as in React
   * Lynx. With `false`, Lynx matches combinators only when an element's own
   * classes are set, which saves the work of finding the elements to
   * restyle, and `dark:` classes keep the appearance the screen first
   * rendered in.
   */
  enableCSSInvalidation?: boolean;
  enableCSSSelector?: boolean;
  /**
   * @deprecated Has no effect, and never did: it was never passed to Lynx.
   * Lynx's template plugin and React Lynx dropped it too. Will be removed in
   * a future release.
   */
  enableICU?: boolean;
  enableNewGesture?: boolean;
  /**
   * @deprecated Has no effect, and never did: it was never passed to Lynx.
   * Lynx's template plugin and React Lynx dropped it too. Will be removed in
   * a future release.
   */
  enableParallelElement?: boolean;
  enableRemoveCSSScope?: boolean;
  enableSSR?: boolean;
  /**
   * The `Intl` APIs to add to the Lynx bundle, with data for angular.json's
   * `i18n.sourceLocale` and `i18n.locales`: any of `Collator`,
   * `DateTimeFormat`, `DisplayNames`, `ListFormat`, `NumberFormat`,
   * `PluralRules` and `RelativeTimeFormat`. Lynx has no `Intl`. The same as
   * the `intl` build option in angular.json, which this replaces when set.
   * The FormatJS packages they use must be installed.
   */
  intl?: IntlApi[] | undefined;
  /**
   * Build multiple angular.json projects as separate Lynx pages.
   * Each project's `browser` field becomes a named entry producing its own .lynx.bundle.
   *
   * - `string[]` — list of angular.json project names to build
   * - `'all'` — build all `application`-type projects in the workspace
   *
   * When omitted, uses `source.entry` from lynx.config.ts (single or multi-entry).
   */
  pages?: string[] | 'all' | undefined;
  /**
   * @deprecated Has no effect, and never did: it was never passed to Lynx.
   * Lynx's template plugin and React Lynx dropped it too. Will be removed in
   * a future release.
   */
  pipelineSchedulerConfig?: number;
  /**
   * The frame rate Lynx asks for while it animates (Lynx's `preferredFps`
   * page config). `'high'`, the default, asks a ProMotion iPhone for
   * 120 fps. `'auto'`, Lynx's own default, asks for nothing, which leaves an
   * iPhone at 60. `'low'` animates at 30 fps at most. Android draws at the
   * screen's rate whichever you choose.
   */
  preferredFps?: PreferredFps;
  /**
   * Whether touch events carry every finger on the screen, as a browser's
   * do (Lynx's `enableMultiTouch` page config). Off, Lynx's default, a
   * touch event has one finger, and a second is never reported, so a pinch
   * can't be told from a drag. On, a second finger fires its own
   * `touchstart`, and `touches` lists them all with `pageX`/`pageY`, which
   * is how an app zooms with two fingers (Lynx recognizes no pinch itself).
   * Taps don't fire while more than one finger is down. The same as the
   * `multiTouch` build option in angular.json, which this replaces when set.
   */
  multiTouch?: boolean;
  removeDescendantSelectorScope?: boolean;
  targetSdkVersion?: string;
  // Code splitting for `loadComponent()` routes and `@defer` blocks.
  // When true: asyncChunks stays on, so each dynamic import() becomes a lazy
  // bundle of its own, built for FetchBundle (entry.ts), which the runtime
  // downloads on the main thread when the route or block first needs it
  // (the runtime's chunk-loader.ts). It needs Lynx 3.9 or later.
  // When false (default): all dynamic imports are inlined into the initial
  // bundle (asyncChunks=false), and import() only runs their modules.
  // Note: this flag is NOT passed to LynxTemplatePlugin itself — doing so would
  // change the root app's appType from 'card' to 'DynamicComponent', crashing
  // the runtime.
  experimental_isLazyBundle?: boolean;
};

/**
 * Options the plugin still accepts, so existing `lynx.config.ts` files keep
 * type-checking, but ignores. They were declared and given defaults but never
 * passed to Lynx, and `@lynx-js/template-webpack-plugin` 0.9 removed them
 * (lynx-family/lynx-stack#1705, #1800), so there's nothing to pass them to:
 *
 * - `enableParallelElement` and `pipelineSchedulerConfig` turn on Lynx's
 *   experimental parallel element resolution, which React Lynx turned off for
 *   stability.
 * - `enableICU` binds a host-provided ICU service (`LynxServiceI18nProtocol`
 *   on iOS, `ICURegister` on Android) into the JS context. Lynx Explorer and
 *   the apps `ng build --platform` makes don't provide one.
 */
export const DEPRECATED_OPTIONS = [
  'enableICU',
  'enableParallelElement',
  'pipelineSchedulerConfig',
] as const;

/**
 * The properties that inherit unless the app says otherwise (see
 * normalizeOptions).
 */
export const DEFAULT_CSS_INHERITANCE_LIST: readonly string[] = ['font-size'];

/**
 * Whether Lynx passes `font-size` down with these options: inheritance is on,
 * and the list names it, or there's no list, which is Lynx's own, where
 * `font-size` is.
 */
export const inheritsFontSize = (
  options: Pick<
    NormalizedPluginAngularLynxOptions,
    'enableCSSInheritance' | 'customCSSInheritanceList'
  >,
): boolean =>
  options.enableCSSInheritance &&
  (!options.customCSSInheritanceList?.length ||
    options.customCSSInheritanceList.includes('font-size'));

/**
 * Whether Lynx passes down any property but `font-size` with these options:
 * inheritance is on, with Lynx's own list or one that names another.
 */
export const inheritsMoreThanFontSize = (
  options: Pick<
    NormalizedPluginAngularLynxOptions,
    'enableCSSInheritance' | 'customCSSInheritanceList'
  >,
): boolean =>
  options.enableCSSInheritance &&
  (!options.customCSSInheritanceList?.length ||
    options.customCSSInheritanceList.some((name) => name !== 'font-size'));

type DeprecatedOption = (typeof DEPRECATED_OPTIONS)[number];

export type NormalizedPluginAngularLynxOptions = Required<
  Omit<PluginAngularLynxOptions, DeprecatedOption>
>;

/** The deprecated options `options` sets, to warn about. */
export const deprecatedOptionsIn = (
  options?: Partial<PluginAngularLynxOptions>,
): DeprecatedOption[] =>
  DEPRECATED_OPTIONS.filter((name) => options?.[name] !== undefined);

export const normalizeOptions = (
  options?: Partial<PluginAngularLynxOptions>,
): NormalizedPluginAngularLynxOptions => {
  const defaultOptions: NormalizedPluginAngularLynxOptions = {
    // Undefined so angular.json's `backgroundTreeShaking` build option
    // decides (see background-tree-shaking.ts); 'safe' unless one of them
    // says otherwise.
    //@ts-expect-error
    backgroundTreeShaking: undefined,
    // Set below, from what the app passes.
    //@ts-expect-error
    customCSSInheritanceList: undefined,
    debugInfoOutside: true,
    // Undefined so angular.json's `eagerImports` build option decides (see
    // eager-imports.ts); off unless one of them turns it on.
    //@ts-expect-error
    eagerImports: undefined,
    // True like React Lynx: on Android, Lynx uses real Views for accessibility
    // while TalkBack is on. The cost is that while it's off, Lynx draws the
    // page flat and UiAutomator-based test tools (Maestro, Appium) see no
    // elements. false exposes a virtual node tree to them at all times.
    enableA11y: true,
    enableAccessibilityElement: false,
    // On for `font-size` (see below). Lynx inherits no text style, so a
    // <text> with no size of its own drew at Lynx's 14px inside a 30px
    // <view> or <text>, where a browser draws it at 30px, and a <text> in a
    // <text> didn't grow with the phone's text size (issue #685). Inherited,
    // it takes its parent's computed size, which has the page's scale in it.
    // Only `font-size`: the other text properties reach the HTML text tags
    // through variables (text-inheritance.ts), and a Lynx <text> keeps
    // drawing them at Lynx's defaults, as it always has.
    enableCSSInheritance: true,
    // True like React Lynx. Without it, a descendant selector such as
    // `page.dark .card`, which `dark:` classes compile to (color-scheme.ts),
    // matched only when the element's own classes were set, so the screen
    // didn't follow the phone's appearance until it was rebuilt. Native Lynx
    // looks up only the rules that depend on the changed class, and walks
    // the subtree only when one does.
    enableCSSInvalidation: true,
    enableCSSSelector: true,
    // Default ON, unlike React Lynx (which defaults false). The native engine
    // only processes __SetGestureDetector calls when this page-config flag is
    // true (see radon_node.cc RadonNode::RadonDiffChildren -> GetEnableNewGesture);
    // with it false, every gesture registered via the LynxGestureDetector
    // directive is silently ignored. React Lynx keeps it off to preserve its
    // legacy gesture system, but AngularLynx has no legacy gesture path — the
    // "new gesture" API is the only one we ship, so leaving it off would make
    // the entire (public, exported) gesture API dead on arrival.
    enableNewGesture: true,
    defaultDisplayLinear: true,
    enableRemoveCSSScope: false,
    enableSSR: false,
    //@ts-expect-error
    intl: undefined,
    //@ts-expect-error
    pages: undefined,
    // Lynx's default, 'auto', leaves an iPhone's animations at 60 fps while
    // the rest of a ProMotion iPhone runs at 120, so they looked half as
    // smooth as the system's.
    preferredFps: 'high',
    // Undefined so angular.json's `multiTouch` build option decides (see
    // entry.ts); off unless one of them turns it on.
    //@ts-expect-error
    multiTouch: undefined,
    targetSdkVersion: '3.2',
    // Lynx's own default (lynx_config.yml), and what web developers expect.
    defaultOverflowVisible: true,
    removeDescendantSelectorScope: false,
    experimental_isLazyBundle: false,
  };
  const normalized = Object.assign(defaultOptions, options);
  // An app that turns inheritance on itself, without a list, asked for
  // Lynx's whole list, which an undefined list gives. Otherwise only
  // `font-size` inherits (see enableCSSInheritance above).
  if (options?.customCSSInheritanceList === undefined) {
    normalized.customCSSInheritanceList =
      options?.enableCSSInheritance === true
        ? (undefined as unknown as string[])
        : [...DEFAULT_CSS_INHERITANCE_LIST];
  }
  // Drop the ignored options, so nothing downstream can start relying on
  // them by accident.
  for (const name of DEPRECATED_OPTIONS) {
    delete (normalized as Partial<PluginAngularLynxOptions>)[name];
  }
  return normalized;
};

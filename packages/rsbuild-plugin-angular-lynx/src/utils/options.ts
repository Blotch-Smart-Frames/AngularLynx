export type PluginAngularLynxOptions = {
  customCSSInheritanceList?: string[] | undefined;
  debugInfoOutside?: boolean;
  defaultDisplayLinear?: boolean;
  /**
   * Make `overflow: visible` the default for every element, as on the web.
   * With `false`, elements clip their children unless they set `overflow`,
   * Lynx's older default.
   */
  defaultOverflowVisible?: boolean;
  enableA11y?: boolean;
  enableAccessibilityElement?: boolean;
  enableCSSInheritance?: boolean;
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
  removeDescendantSelectorScope?: boolean;
  targetSdkVersion?: string;
  // Enables true lazy loading for Angular Router's loadComponent() routes.
  // When true: asyncChunks remains enabled so each dynamic import() produces a
  // separate .js file, AMD-wrapped and loadable via Lynx's native
  // requireModuleAsync API at runtime.
  // When false (default): all dynamic imports are inlined into the initial bundle
  // (asyncChunks=false), avoiding the need for native chunk loading entirely.
  // Note: this flag is NOT passed to LynxTemplatePlugin — doing so would change
  // the root app's appType from 'card' to 'DynamicComponent', crashing the runtime.
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
    //@ts-expect-error
    customCSSInheritanceList: undefined,
    debugInfoOutside: true,
    // True like React Lynx: on Android, Lynx uses real Views for accessibility
    // while TalkBack is on. The cost is that while it's off, Lynx draws the
    // page flat and UiAutomator-based test tools (Maestro, Appium) see no
    // elements. false exposes a virtual node tree to them at all times.
    enableA11y: true,
    enableAccessibilityElement: false,
    enableCSSInheritance: false,
    enableCSSInvalidation: false,
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
    pages: undefined,
    targetSdkVersion: '3.2',
    // Lynx's own default (lynx_config.yml), and what web developers expect.
    defaultOverflowVisible: true,
    removeDescendantSelectorScope: false,
    experimental_isLazyBundle: false,
  };
  const normalized = Object.assign(defaultOptions, options);
  // Drop the ignored options, so nothing downstream can start relying on
  // them by accident.
  for (const name of DEPRECATED_OPTIONS) {
    delete (normalized as Partial<PluginAngularLynxOptions>)[name];
  }
  return normalized;
};

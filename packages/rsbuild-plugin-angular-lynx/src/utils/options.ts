export type PluginAngularLynxOptions = {
  customCSSInheritanceList?: string[] | undefined;
  debugInfoOutside?: boolean;
  defaultDisplayLinear?: boolean;
  defaultOverflowVisible?: boolean;
  enableA11y?: boolean;
  enableAccessibilityElement?: boolean;
  enableCSSInheritance?: boolean;
  enableCSSInvalidation?: boolean;
  enableCSSSelector?: boolean;
  enableICU?: boolean;
  enableNewGesture?: boolean;
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

export const normalizeOptions = (
  options?: Partial<PluginAngularLynxOptions>,
): Required<PluginAngularLynxOptions> => {
  const defaultOptions: Required<PluginAngularLynxOptions> = {
    //@ts-expect-error
    customCSSInheritanceList: undefined,
    debugInfoOutside: true,
    enableA11y: true,
    enableAccessibilityElement: false,
    enableCSSInheritance: false,
    enableCSSInvalidation: false,
    enableCSSSelector: true,
    enableICU: false,
    // Default ON, unlike React Lynx (which defaults false). The native engine
    // only processes __SetGestureDetector calls when this page-config flag is
    // true (see radon_node.cc RadonNode::RadonDiffChildren -> GetEnableNewGesture);
    // with it false, every gesture registered via the LynxGestureDetector
    // directive is silently ignored. React Lynx keeps it off to preserve its
    // legacy gesture system, but AngularLynx has no legacy gesture path — the
    // "new gesture" API is the only one we ship, so leaving it off would make
    // the entire (public, exported) gesture API dead on arrival.
    enableNewGesture: true,
    enableParallelElement: true,
    defaultDisplayLinear: true,
    enableRemoveCSSScope: false,
    enableSSR: false,
    //@ts-expect-error
    pages: undefined,
    // 0x00010000 = 65536: Lynx-internal pipeline scheduler flag passed to
    // LynxTemplatePlugin. Enables the async pipeline scheduler mode required
    // for Angular's change detection to interleave correctly with Lynx's
    // native frame rendering pipeline.
    pipelineSchedulerConfig: 0x00010000,
    targetSdkVersion: '3.2',
    defaultOverflowVisible: true,
    removeDescendantSelectorScope: false,
    experimental_isLazyBundle: false,
  };
  return Object.assign(defaultOptions, options);
};

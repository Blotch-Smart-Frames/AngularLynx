/**
 * How `env(safe-area-inset-*)` gets its values in an app the native builder
 * generated (`ng build --platform ios|android`).
 *
 * Those apps draw the page edge to edge, under the status bar and the home
 * indicator, as Safari does for a page with `viewport-fit=cover`, and the
 * page pads itself with `env(safe-area-inset-*)`. Lynx can't give `env()`
 * those insets there:
 *
 * - Its four values are process-wide statics in the C++ core
 *   (`ComputedCSSStyle::SAFE_AREA_INSET_*`). On Android nothing sets them,
 *   and Lynx's native library doesn't export them, so they're always 0.
 * - On iOS `LynxEnv` copies them from the key window when a LynxView is
 *   created, and only from a scene that's already active, which a LynxView
 *   made at launch isn't.
 * - An element resolves `env()` once, when its style is set: Lynx marks
 *   `env()` values with no update flag (`GetValueFlags` in
 *   dynamic_css_styles_manager.cc), so nothing already on screen would follow
 *   a rotation even if the statics changed.
 *
 * So the runtime fills them in from the insets the shell sends as global
 * props (`edgeToEdge` and `safeAreaTop` etc., see {@link setSafeAreaInsets}),
 * two ways:
 *
 * - **Stylesheets**, compiled before the app runs, read CSS variables: the
 *   build plugin writes each `env(safe-area-inset-*)` as
 *   `var(--angular-lynx-safe-area-inset-*, env(safe-area-inset-*))`, and the
 *   page sets the variables ({@link safeAreaInsetsStyle}). A CSS variable that
 *   changes restyles every element that reads it.
 * - **Inline styles** get the inset itself, in px ({@link withSafeAreaInsets}):
 *   Lynx resolves no `var()` inside a `calc()` in an inline style
 *   (`MergeInlineStyles` in fiber_element.cc takes a `calc()` as a length
 *   without looking for one), and inline insets are mostly in a `calc()`,
 *   like the dock's `calc(49px + env(safe-area-inset-bottom))`. Elements keep
 *   the style as written, and LynxElement writes it again when the insets
 *   change.
 *
 * Where the host sends no `edgeToEdge`, as Lynx Explorer and the web preview
 * don't, nothing changes: inline styles keep their `env()`, and the
 * stylesheets' `var()` falls back to it.
 */

/**
 * The CSS variable that carries each inset to the stylesheets. The build
 * plugin keeps its own copy of these names
 * (`packages/rsbuild-plugin-angular-lynx/src/safe-area.ts`), which writes them
 * into stylesheets; a test there keeps the two the same.
 */
export const SAFE_AREA_INSET_VARIABLES: Readonly<Record<string, string>> = {
  top: '--angular-lynx-safe-area-inset-top',
  right: '--angular-lynx-safe-area-inset-right',
  bottom: '--angular-lynx-safe-area-inset-bottom',
  left: '--angular-lynx-safe-area-inset-left',
};

type Side = 'top' | 'right' | 'bottom' | 'left';
type Insets = Readonly<Record<Side, number>>;

/** The global props a generated app's shell sends about the safe area. */
type SafeAreaProps = {
  readonly edgeToEdge?: unknown;
  readonly safeAreaTop?: unknown;
  readonly safeAreaRight?: unknown;
  readonly safeAreaBottom?: unknown;
  readonly safeAreaLeft?: unknown;
};

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * The insets `env(safe-area-inset-*)` stands for, in px, or null where the
 * host leaves them to Lynx's own `env()`. Angular runs only on the main
 * thread, so one copy serves the whole app.
 */
let insets: Insets | null = null;

const px = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Takes the insets from the host's global props, and says whether they
 * changed.
 *
 * The generated shells send `edgeToEdge`, a boolean. When it's true the page
 * fills the screen, and the insets are the `safeAreaTop`/`Right`/`Bottom`/
 * `Left` props, in iOS points and Android dp, which are Lynx's px: the part
 * of the page the system bars, the cutout and the home indicator cover. When
 * it's false (`"edgeToEdge": false` in angular.json) the shell has already laid
 * the page out inside the safe area, so they're 0. No other host sends
 * `edgeToEdge`, and `env()` keeps its own value there.
 */
export const setSafeAreaInsets = (globalProps: object | undefined): boolean => {
  const props = (globalProps ?? {}) as SafeAreaProps;
  const edgeToEdge = props.edgeToEdge;
  const next: Insets | null =
    typeof edgeToEdge === 'boolean'
      ? {
          top: edgeToEdge ? px(props.safeAreaTop) : 0,
          right: edgeToEdge ? px(props.safeAreaRight) : 0,
          bottom: edgeToEdge ? px(props.safeAreaBottom) : 0,
          left: edgeToEdge ? px(props.safeAreaLeft) : 0,
        }
      : null;
  const previous = insets;
  insets = next;
  if (next === null || previous === null) return next !== previous;
  return SIDES.some((side) => next[side] !== previous[side]);
};

/**
 * The inline style that gives the stylesheets the insets: the four
 * {@link SAFE_AREA_INSET_VARIABLES}, which the page sets. Empty where the host
 * leaves the insets to Lynx's `env()`.
 */
export const safeAreaInsetsStyle = (): string => {
  const current = insets;
  if (!current) return '';
  return SIDES.map(
    (side) => `${SAFE_AREA_INSET_VARIABLES[side]}: ${current[side]}px`,
  ).join('; ');
};

/**
 * An `env(safe-area-inset-*)` (its side in group 1), with any fallback, which
 * may hold one level of parentheses (`env(safe-area-inset-top, calc(1px +
 * 2px))`). Global, for replace(); test with {@link readsSafeAreaInsets}.
 */
const SAFE_AREA_ENV =
  /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,(?:[^()]|\([^()]*\))*)?\)/gi;

/** The start of an inset, for a test without the global regex's lastIndex. */
const READS_INSET = /env\(\s*safe-area-inset-(?:top|right|bottom|left)\b/i;

/**
 * Whether an inline style or value reads an inset, so its element has to
 * write it again when the insets change.
 */
export const readsSafeAreaInsets = (value: unknown): boolean =>
  typeof value === 'string' && READS_INSET.test(value);

/**
 * An inline style or value with each `env(safe-area-inset-*)` replaced by the
 * inset the host sent: `calc(49px + env(safe-area-inset-bottom))` becomes
 * `calc(49px + 34px)`. Works on a whole `style="..."` as on one value, custom
 * properties included. Any `env()` fallback goes with it.
 *
 * Returned as it is where the host sends no insets, or for anything that
 * isn't a string or reads none.
 */
export const withSafeAreaInsets = <T>(value: T): T => {
  const current = insets;
  if (!current || !readsSafeAreaInsets(value)) return value;
  return (value as string).replace(
    SAFE_AREA_ENV,
    (_match, side: string) => `${current[side.toLowerCase() as Side]}px`,
  ) as T;
};

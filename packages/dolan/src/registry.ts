export type RegistryEntry = {
  name: string;
  /** Other registry components this one imports. */
  dependencies: string[];
  /**
   * npm packages its code imports, as install specs (`name@range`).
   * Installed into the project when the component is added or updated.
   */
  packages?: string[];
  /**
   * Theme colors the component reads that a theme copied by an older dolan
   * lacks, by variable name without `--` (`glass-foreground`). Without them
   * its classes draw nothing, and `doctor` lists what's missing.
   */
  themeColors?: string[];
};

/**
 * TanStack Charts and the d3 curves the presets draw with. Kept in step with
 * packages/ui/package.json by a test.
 */
const CHART_PACKAGES = ['@tanstack/charts@^1.1.0', 'd3-shape@^3.2.0'];

/**
 * Builds the variant classes of the components that have `variant`/`size`
 * inputs. Kept in step with packages/ui/package.json by the same test.
 */
const CVA_PACKAGES = ['class-variance-authority@^0.7.1'];

/**
 * The Liquid Glass colors, which the theme gained with the glass component.
 */
const GLASS_COLORS = [
  'glass-tint',
  'glass-tint-foreground',
  'glass-foreground',
  'glass-muted-foreground',
  'glass-clear-foreground',
  'glass-dim',
];

export const registry: RegistryEntry[] = [
  // Opened from a control, the action sheet is a popover: glass on iOS 26
  // and a Material menu on Android, whose actions take the glass colors.
  {
    name: 'action-sheet',
    dependencies: ['glass', 'popover'],
    themeColors: ['glass-foreground', 'glass-muted-foreground'],
  },
  { name: 'accordion', dependencies: [] },
  { name: 'alert', dependencies: [], packages: CVA_PACKAGES },
  { name: 'alert-dialog', dependencies: [] },
  // The chart presets are TanStack Charts definitions drawn by <ui-chart>.
  { name: 'area-chart', dependencies: ['chart'] },
  { name: 'aspect-ratio', dependencies: [] },
  { name: 'avatar', dependencies: ['skeleton'] },
  { name: 'badge', dependencies: [], packages: CVA_PACKAGES },
  { name: 'bar-chart', dependencies: ['chart'] },
  // The glass variant draws its sheet on `glass`, in the platform's design.
  { name: 'bottom-sheet', dependencies: ['glass'] },
  // The glass variants draw on `glass`, and projected icons take the label's
  // color through icon's UI_ICON_COLOR.
  {
    name: 'button',
    dependencies: ['spinner', 'glass', 'icon'],
    packages: CVA_PACKAGES,
    themeColors: GLASS_COLORS,
  },
  {
    name: 'button-group',
    dependencies: ['glass', 'icon'],
    packages: CVA_PACKAGES,
    themeColors: GLASS_COLORS,
  },
  { name: 'candlestick-chart', dependencies: ['chart'] },
  { name: 'card', dependencies: [] },
  // Renders any TanStack Charts definition with Lynx elements; the presets
  // below build on it.
  { name: 'chart', dependencies: [], packages: CHART_PACKAGES },
  { name: 'checkbox', dependencies: [] },
  { name: 'collapsible', dependencies: [] },
  // The context menu is a menu that opens on a long press: it shares the
  // menu's items and its overlay.
  { name: 'context-menu', dependencies: ['menu'] },
  { name: 'dialog', dependencies: [] },
  // The dock's bar, button and accessory are glass, and its items draw their
  // icons from icon's set. Its selection capsule and the items on glass take
  // the glass foreground.
  {
    name: 'dock',
    dependencies: ['glass', 'icon'],
    themeColors: ['glass-foreground'],
  },
  { name: 'empty-state', dependencies: ['icon'] },
  // Glass resolves its tint with the icons' copy of the theme, and hands
  // projected icons its foreground.
  { name: 'glass', dependencies: ['icon'], themeColors: GLASS_COLORS },
  { name: 'input', dependencies: [] },
  { name: 'label', dependencies: [] },
  { name: 'line-chart', dependencies: ['chart'] },
  { name: 'list', dependencies: [] },
  // The menu is glass, and its items draw their icons from icon's set.
  {
    name: 'menu',
    dependencies: ['glass', 'icon'],
    themeColors: ['glass-foreground', 'glass-muted-foreground', 'glass-dim'],
  },
  // nav-drawer renders a hamburger trigger via <ui-icon>, so it pulls in `icon`.
  { name: 'nav-drawer', dependencies: ['icon'] },
  // Pagination and the spinner draw SVGs in theme colors with icon-theme.ts.
  { name: 'pagination', dependencies: ['icon'] },
  // The popover is glass, placed by the menu's placement, and its content
  // reads the glass colors.
  {
    name: 'popover',
    dependencies: ['glass', 'menu'],
    themeColors: ['glass-foreground', 'glass-muted-foreground'],
  },
  { name: 'progress', dependencies: [] },
  { name: 'radio-group', dependencies: [] },
  { name: 'scatter-chart', dependencies: ['chart'] },
  { name: 'scroll-area', dependencies: [] },
  { name: 'select', dependencies: ['bottom-sheet'] },
  { name: 'separator', dependencies: [] },
  { name: 'sheet', dependencies: ['bottom-sheet'] },
  { name: 'skeleton', dependencies: [] },
  { name: 'spinner', dependencies: ['icon'] },
  { name: 'switch', dependencies: [] },
  // The tab bar draws its items' icons from icon's set, in theme colors
  // resolved by icon-theme.ts.
  { name: 'tab-bar', dependencies: ['icon'] },
  { name: 'tabs', dependencies: [] },
  { name: 'textarea', dependencies: [] },
  { name: 'toast', dependencies: [] },
  { name: 'toggle', dependencies: [], packages: CVA_PACKAGES },
  { name: 'typography', dependencies: [], packages: CVA_PACKAGES },
  { name: 'icon', dependencies: [] },
];

export const getComponentNames = (): string[] => {
  return registry.map((entry) => entry.name);
};

export const getEntry = (name: string): RegistryEntry | undefined => {
  return registry.find((entry) => entry.name === name);
};

/**
 * Depth-first topological sort: dependencies are added to the Set before
 * the component that depends on them. So if `button` depends on `spinner`,
 * the output is [..., spinner, button] — correct installation order.
 * The Set deduplicates components shared by multiple selections.
 */
/** The npm packages the given components need, deduplicated. */
export const resolvePackages = (names: string[]): string[] => [
  ...new Set(names.flatMap((name) => getEntry(name)?.packages ?? [])),
];

export const resolveDependencies = (names: string[]): string[] => {
  const resolved = new Set<string>();

  const resolve = (name: string) => {
    if (resolved.has(name)) return;
    const entry = getEntry(name);
    if (!entry) return;
    for (const dep of entry.dependencies) {
      resolve(dep);
    }
    resolved.add(name);
  };

  for (const name of names) {
    resolve(name);
  }

  return [...resolved];
};

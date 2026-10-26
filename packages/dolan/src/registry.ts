export type RegistryEntry = {
  name: string;
  /** Other registry components this one imports. */
  dependencies: string[];
  /**
   * npm packages its code imports, as install specs (`name@range`).
   * Installed into the project when the component is added or updated.
   */
  packages?: string[];
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

export const registry: RegistryEntry[] = [
  { name: 'action-sheet', dependencies: [] },
  { name: 'accordion', dependencies: [] },
  { name: 'alert', dependencies: [], packages: CVA_PACKAGES },
  { name: 'alert-dialog', dependencies: [] },
  // The chart presets are TanStack Charts definitions drawn by <ui-chart>.
  { name: 'area-chart', dependencies: ['chart'] },
  { name: 'aspect-ratio', dependencies: [] },
  { name: 'avatar', dependencies: ['skeleton'] },
  { name: 'badge', dependencies: [], packages: CVA_PACKAGES },
  { name: 'bar-chart', dependencies: ['chart'] },
  { name: 'bottom-sheet', dependencies: [] },
  { name: 'button', dependencies: ['spinner'], packages: CVA_PACKAGES },
  { name: 'button-group', dependencies: [], packages: CVA_PACKAGES },
  { name: 'candlestick-chart', dependencies: ['chart'] },
  { name: 'card', dependencies: [] },
  // Renders any TanStack Charts definition with Lynx elements; the presets
  // below build on it.
  { name: 'chart', dependencies: [], packages: CHART_PACKAGES },
  { name: 'checkbox', dependencies: [] },
  { name: 'collapsible', dependencies: [] },
  { name: 'dialog', dependencies: [] },
  { name: 'empty-state', dependencies: ['icon'] },
  { name: 'input', dependencies: [] },
  { name: 'label', dependencies: [] },
  { name: 'line-chart', dependencies: ['chart'] },
  { name: 'list', dependencies: [] },
  // nav-drawer renders a hamburger trigger via <ui-icon>, so it pulls in `icon`.
  { name: 'nav-drawer', dependencies: ['icon'] },
  // Pagination and the spinner draw SVGs in theme colors with icon-theme.ts.
  { name: 'pagination', dependencies: ['icon'] },
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

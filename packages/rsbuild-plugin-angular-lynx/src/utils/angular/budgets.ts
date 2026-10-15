import type { Budget } from './options.js';

/**
 * Checks angular.json `budgets` against a Lynx build's output.
 *
 * The size parsing, the thresholds and the messages are ported from
 * `@angular/build`'s bundle calculator (`src/utils/bundle-calculator.js` and
 * `src/utils/format-bytes.js`), so a Lynx app reports budgets exactly as
 * `ng build` does for a web app: the same units (1 kB = 1000 bytes), the
 * same baseline arithmetic and the same wording. It's copied because those
 * modules are internal to `@angular/build`, not in its package `exports`.
 *
 * What each budget type measures differs from the web, because a Lynx app
 * ships as `.bundle` files rather than separate scripts and stylesheets:
 *
 * - `initial`: each entry's bundle, on its own. A Lynx page loads one bundle,
 *   so a multi-page app's pages are checked separately rather than summed.
 * - `bundle`: the bundle of the entry named by the budget's `name`.
 * - `all` / `any`: every bundle and script the `lynx` environment emits,
 *   together / each. Media and fonts aren't counted, as on the web.
 * - `allScript` / `anyScript`: the same files as `all` / `any`. A Lynx
 *   bundle carries the app's scripts (and its styles, encoded together), so
 *   there is no script-only file to measure.
 * - `anyComponentStyle`: each component stylesheet, compiled.
 */

/** Angular's unit for `kB`, `MB` and `GB`: decimal, not 1024. */
export const BYTES_IN_KILOBYTE = 1000;

export type BudgetSeverity = 'warning' | 'error';

export type BudgetThreshold = {
  readonly limit: number;
  readonly type: 'maximum' | 'minimum';
  readonly severity: BudgetSeverity;
};

export type BudgetFailure = {
  readonly severity: BudgetSeverity;
  readonly label: string;
  readonly message: string;
};

/** A file the `lynx` environment emits that budgets count. */
export type BudgetAsset = {
  readonly name: string;
  readonly size: number;
  /** Set for an entry's own bundle: the entry (page) it was built from. */
  readonly entryName?: string;
};

/** The compiled size of one component stylesheet. */
export type ComponentStyleSize = {
  /** The stylesheet, or for inline styles the component, relative to the workspace. */
  readonly label: string;
  readonly size: number;
};

/**
 * Parses a budget size (`'500kB'`, `'1.5mb'`, `'2048'`, `'10%'`) into bytes.
 * A percentage is of `baseline`; with a baseline, the result is the baseline
 * moved by the value, up (`factor` 1) or down (`factor` -1). Input it
 * can't parse gives NaN, which no size crosses, as in Angular.
 */
export const calculateBytes = (
  input: string,
  baseline?: string,
  factor: 1 | -1 = 1,
): number => {
  const matches = input.trim().match(/^(\d+(?:\.\d+)?)[ \t]*(%|[kmg]?b)?$/i);
  if (!matches) {
    return NaN;
  }
  const baselineBytes = (baseline && calculateBytes(baseline)) || 0;
  let value = Number(matches[1]);
  switch (matches[2]?.toLowerCase()) {
    case '%':
      value = (baselineBytes * value) / 100;
      break;
    case 'kb':
      value *= BYTES_IN_KILOBYTE;
      break;
    case 'mb':
      value *= BYTES_IN_KILOBYTE * BYTES_IN_KILOBYTE;
      break;
    case 'gb':
      value *= BYTES_IN_KILOBYTE * BYTES_IN_KILOBYTE * BYTES_IN_KILOBYTE;
      break;
  }
  if (baselineBytes === 0) {
    return value;
  }
  return baselineBytes + value * factor;
};

/**
 * The limits a budget sets, in the order Angular checks them. `warning` and
 * `error` are relative to the baseline in both directions, so each gives a
 * minimum and a maximum.
 */
export const calculateThresholds = (budget: Budget): BudgetThreshold[] => {
  const thresholds: BudgetThreshold[] = [];
  if (budget.maximumWarning) {
    thresholds.push({
      limit: calculateBytes(budget.maximumWarning, budget.baseline, 1),
      type: 'maximum',
      severity: 'warning',
    });
  }
  if (budget.maximumError) {
    thresholds.push({
      limit: calculateBytes(budget.maximumError, budget.baseline, 1),
      type: 'maximum',
      severity: 'error',
    });
  }
  if (budget.minimumWarning) {
    thresholds.push({
      limit: calculateBytes(budget.minimumWarning, budget.baseline, -1),
      type: 'minimum',
      severity: 'warning',
    });
  }
  if (budget.minimumError) {
    thresholds.push({
      limit: calculateBytes(budget.minimumError, budget.baseline, -1),
      type: 'minimum',
      severity: 'error',
    });
  }
  if (budget.warning) {
    thresholds.push(
      {
        limit: calculateBytes(budget.warning, budget.baseline, -1),
        type: 'minimum',
        severity: 'warning',
      },
      {
        limit: calculateBytes(budget.warning, budget.baseline, 1),
        type: 'maximum',
        severity: 'warning',
      },
    );
  }
  if (budget.error) {
    thresholds.push(
      {
        limit: calculateBytes(budget.error, budget.baseline, -1),
        type: 'minimum',
        severity: 'error',
      },
      {
        limit: calculateBytes(budget.error, budget.baseline, 1),
        type: 'maximum',
        severity: 'error',
      },
    );
  }
  return thresholds;
};

/** Formats a byte count the way `ng build`'s budget messages do: `1.23 kB`. */
export const formatSize = (size: number): string => {
  if (size <= 0) {
    return '0 bytes';
  }
  const abbreviations = ['bytes', 'kB', 'MB', 'GB'];
  const index = Math.floor(Math.log(size) / Math.log(BYTES_IN_KILOBYTE));
  const roundedSize = size / Math.pow(BYTES_IN_KILOBYTE, index);
  // bytes don't have a fraction
  const fractionDigits = index === 0 ? 0 : 2;
  return `${roundedSize.toFixed(fractionDigits)} ${abbreviations[index]}`;
};

/** The failures of one measured size against a budget's thresholds. */
export const checkThresholds = (
  thresholds: readonly BudgetThreshold[],
  size: number,
  label: string,
): BudgetFailure[] =>
  thresholds.flatMap(({ limit, type, severity }): BudgetFailure[] => {
    if (type === 'maximum') {
      return size <= limit
        ? []
        : [
            {
              severity,
              label,
              message: `${label} exceeded maximum budget. Budget ${formatSize(limit)} was not met by ${formatSize(size - limit)} with a total of ${formatSize(size)}.`,
            },
          ];
    }
    return size >= limit
      ? []
      : [
          {
            severity,
            label,
            message: `${label} failed to meet minimum budget. Budget ${formatSize(limit)} was not met by ${formatSize(limit - size)} with a total of ${formatSize(size)}.`,
          },
        ];
  });

const sum = (sizes: readonly { readonly size: number }[]): number =>
  sizes.reduce((total, { size }) => total + size, 0);

/**
 * The sizes a budget measures, each with the label its messages use (the
 * same labels as Angular's: `bundle initial`, `total`, `total scripts`, the
 * bundle name, or the file).
 */
const calculateSizes = (
  budget: Budget,
  assets: readonly BudgetAsset[],
  componentStyles: readonly ComponentStyleSize[],
): { size: number; label: string }[] => {
  switch (budget.type) {
    case 'initial': {
      const bundles = assets.filter((asset) => asset.entryName !== undefined);
      // A single-page app keeps Angular's label; with several pages, each
      // message names the page it is about.
      return bundles.map((asset) => ({
        size: asset.size,
        label:
          bundles.length === 1
            ? 'bundle initial'
            : `bundle initial (${asset.entryName})`,
      }));
    }
    case 'bundle':
      // As in Angular, a bundle budget without a name measures nothing, and
      // one naming an entry that doesn't exist measures 0 bytes.
      return budget.name
        ? [
            {
              size: sum(
                assets.filter((asset) => asset.entryName === budget.name),
              ),
              label: budget.name,
            },
          ]
        : [];
    case 'all':
      return [{ size: sum(assets), label: 'total' }];
    case 'allScript':
      return [{ size: sum(assets), label: 'total scripts' }];
    case 'any':
    case 'anyScript':
      return assets.map((asset) => ({ size: asset.size, label: asset.name }));
    case 'anyComponentStyle':
      return componentStyles.map((style) => ({ ...style }));
    default:
      // Under plain rspeedy nothing validates angular.json, so a misspelled
      // type gets here. Angular's schema would reject it; measuring nothing
      // keeps the build going rather than crashing it.
      return [];
  }
};

/** Checks every budget against a build's output. */
export const checkBudgets = (
  budgets: readonly Budget[],
  output: {
    readonly assets: readonly BudgetAsset[];
    readonly componentStyles: readonly ComponentStyleSize[];
  },
): BudgetFailure[] =>
  budgets.flatMap((budget) =>
    calculateSizes(budget, output.assets, output.componentStyles).flatMap(
      ({ size, label }) =>
        checkThresholds(calculateThresholds(budget), size, label),
    ),
  );

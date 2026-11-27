import { definePolyfillOverride } from './shared.js';

// PrimJS has no `Intl`, so its `Number.prototype.toLocaleString` is just
// `String(n)`: `21.232271760105846`, `1234567` with no separators. Libraries
// use it as the default display format (TanStack Charts' tooltips do), so on
// Lynx those values come out raw. Without Intl, format the way browsers do for
// the default en-US locale: thousands separators, at most three fraction
// digits, plus the common `minimumFractionDigits` / `maximumFractionDigits` /
// `useGrouping` options. Other locales get the same format; apps that need
// real localization should load an Intl polyfill, which this then defers to.
// Without NumberFormat, not only without Intl: the `intl` build option makes
// an `Intl` for its other APIs (`['Collator']`) before the app's modules, so
// before this module, which loads with the first one that formats a number.
if (typeof Intl === 'undefined' || typeof Intl.NumberFormat !== 'function') {
  definePolyfillOverride(
    Number.prototype,
    'toLocaleString',
    function (_locales, options) {
      const value = Number(this);
      if (Number.isNaN(value)) return 'NaN';
      if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
      const opts = options || {};
      const min = opts.minimumFractionDigits ?? 0;
      const max = Math.max(min, opts.maximumFractionDigits ?? Math.max(min, 3));
      const fixed = Math.abs(value).toFixed(max);
      const dot = fixed.indexOf('.');
      let integer = dot < 0 ? fixed : fixed.slice(0, dot);
      let fraction = dot < 0 ? '' : fixed.slice(dot + 1).replace(/0+$/, '');
      while (fraction.length < min) fraction += '0';
      if (opts.useGrouping !== false) {
        integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
      // A value that rounds to zero is shown unsigned, as browsers do.
      const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
      return sign + integer + (fraction ? `.${fraction}` : '');
    },
  );
}

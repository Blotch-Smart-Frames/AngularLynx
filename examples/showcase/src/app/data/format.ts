/**
 * Number formatting without `Intl`: Lynx's main thread, where Angular runs,
 * has no `Intl`, so `toLocaleString()` there is plain `String(n)`.
 */
export const formatNumber = (value: number, decimals = 0): string => {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (value < 0 ? '−' : '') + grouped + (fraction ? `.${fraction}` : '');
};

export const formatMoney = (value: number): string =>
  `$${formatNumber(Math.round(value))}`;

export const formatCarat = (carats: number): string =>
  `${formatNumber(carats, 2)} ct`;

/** `+12.4%` / `−3.1%`, for a change over a period. */
export const formatChange = (ratio: number): string =>
  `${ratio >= 0 ? '+' : '−'}${formatNumber(Math.abs(ratio) * 100, 1)}%`;

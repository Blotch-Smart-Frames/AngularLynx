// The app's own date and number formatting: `Intl` isn't on every Lynx
// thread, and the orrery speaks one language.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** "Thursday 12 November 2026", in the phone's own time zone. */
export const longDate = (time: number): string => {
  const date = new Date(time);
  const year = date.getFullYear();
  const shown = year < 1 ? `${1 - year} BC` : `${year}`;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${shown}`;
};

/** How far the dial is from today, in words: "today", "in 3 years". */
export const fromToday = (days: number): string => {
  if (days === 0) return 'Today';
  const ahead = days > 0;
  const n = Math.abs(days);
  const amount =
    n < 60
      ? plural(n, 'day')
      : n < 730
        ? plural(Math.round(n / 30.44), 'month')
        : plural(Math.round(n / 365.25), 'year');
  return ahead ? `In ${amount}` : `${amount} ago`;
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** 142984 → "142,984". */
export const grouped = (value: number): string =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A figure with a fixed number of decimals. */
export const fixed = (value: number, digits: number): string =>
  value.toFixed(digits);

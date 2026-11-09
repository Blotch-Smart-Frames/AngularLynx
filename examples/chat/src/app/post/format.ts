/*
 * Times as a postmark prints them. Written out rather than with Intl, so
 * they read the same on every platform: Lynx's main thread doesn't have
 * every Intl format a browser does.
 */

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
const DAY = 24 * 60 * 60 * 1000;

const clock = (at: number): string => {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** The day, as a postmark's middle line: "9 NOV". */
export const postmarkDay = (at: number): string => {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
};

/** Today's letters by the time, older ones by the day. */
export const postmarkTime = (at: number, now = Date.now()): string =>
  new Date(at).toDateString() === new Date(now).toDateString()
    ? clock(at)
    : postmarkDay(at);

/** A day separator's line in a thread: "TODAY", "YESTERDAY" or the date. */
export const dayHeading = (at: number, now = Date.now()): string => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round(
    (today.getTime() - new Date(at).setHours(0, 0, 0, 0)) / DAY,
  );
  if (days === 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  return postmarkDay(at);
};

/** The time under a letter. */
export const letterTime = clock;

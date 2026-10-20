/**
 * Screen pixels per CSS pixel that `element` is drawn at: below 1 when a
 * transform on it or an ancestor scales it down, as the docs' previews do to
 * fit a phone-sized page in their pane. getBoundingClientRect() measures in
 * screen pixels, but layout and every CSS length are in CSS pixels, so the
 * glass code divides boxes by this to keep to CSS pixels.
 */
export const drawnScale = (element: HTMLElement): number => {
  const drawn = element.getBoundingClientRect().width;
  // A transform doesn't change offsetWidth.
  const laidOut = element.offsetWidth;
  // offsetWidth is rounded to a whole pixel, so a difference of less than one
  // is rounding, not scale.
  if (!laidOut || Math.abs(drawn - laidOut) < 1) return 1;
  return drawn / laidOut;
};

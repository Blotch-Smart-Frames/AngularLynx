import type { ElementRef } from '../../types/lynx';

/**
 * The `<view>` for a tag Lynx has no element for.
 *
 * Most of these are expected, and get no warning. Angular creates every
 * component's host element (`<app-card>`) and every element directive's host
 * (`<router-outlet>`) by its selector, and a `<view>` is the right element for
 * each. Those names have a hyphen, as custom-element names do and as Angular's
 * style guide has component selectors do (`app-` and the like), and so do the
 * tags angular-three's renderer asks for (`ngt-mesh`) before deciding they're
 * three.js objects that never reach the page. Warning for every one of them
 * flooded the console with a line per component instance (#352).
 *
 * A tag without a hyphen is more likely a misspelled Lynx or HTML element
 * (a `<view>` or `<button>` with a letter missing), which renders as an
 * unexpected `<view>`, so it still warns. (The HTML tags that are meant to become a `<view>` are mapped before
 * this, in web-tags.ts.)
 */
export const createDefaultElement = (
  tag: string,
  pageId: number,
): ElementRef => {
  if (!tag.includes('-')) {
    console.warn(`Unknown element tag "${tag}". Falling back to view element.`);
  }
  return __CreateView(pageId);
};

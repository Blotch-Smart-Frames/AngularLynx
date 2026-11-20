import type { ElementRef } from '../types/lynx';
import { LynxElement } from '../lynx-element';

/**
 * The element a touch on a static block's element is to the app: the
 * nearest one above it that has a LynxElement, the block's root or one of
 * the root's ancestors. A static element has no wrapper (see
 * static-block.ts), so the touch's target, which Lynx names by unique id,
 * isn't one LynxElement.byUniqueId knows.
 *
 * Native Lynx finds an element by its id with `__GetElementByUniqueID`. The
 * web preview's element API doesn't have it: there the touch's target stays
 * the page, as it was for any element without a wrapper.
 */
export const staticBlockOwner = (uniqueId: number): LynxElement | undefined => {
  if (typeof __GetElementByUniqueID !== 'function') return undefined;
  // Each step is a native read, and a block is a few elements deep.
  let element: ElementRef | null = __GetElementByUniqueID(uniqueId) ?? null;
  while (element) {
    element = __GetParent(element);
    if (!element) return undefined;
    const owner = LynxElement.byUniqueId(__GetElementUniqueID(element));
    if (owner) return owner;
  }
  return undefined;
};

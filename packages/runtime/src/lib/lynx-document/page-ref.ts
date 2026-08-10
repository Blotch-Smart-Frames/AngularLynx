import type { ElementRef } from '../types/lynx';

/**
 * Exposed for SSR encode — ssrEncode() needs the raw page ElementRef to walk
 * the native tree. Only set on the main thread after createRootElement().
 *
 * Lives in its own file to avoid a circular import between lynx-element.ts
 * (which reads this) and lynx-document.ts (which writes this and imports
 * LynxElement). Direct mutation via setPageElementRef() keeps the ESM live
 * binding intact for all importers.
 */
export let __pageElementRef: ElementRef | null = null;

export const setPageElementRef = (ref: ElementRef | null): void => {
  __pageElementRef = ref;
};

/**
 * Unique ID of the root page element — the parent ID every `__Create*` call
 * needs. `LynxElement.#recreateSubtree()` uses this to build a fresh native ref
 * for a remounted element without holding a reference to `LynxDocument` (which
 * would form an import cycle: lynx-document imports LynxElement). Returns 0 if
 * called before the root exists, which never happens during change detection.
 */
export const getPageId = (): number =>
  __pageElementRef ? __GetElementUniqueID(__pageElementRef) : 0;

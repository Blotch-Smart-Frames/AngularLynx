/**
 * A count that moves whenever the native element tree may have changed shape
 * in a way the element wrappers didn't see coming: an element moved or
 * removed, and every flush, when native applies a list's updates (items
 * leave a `<list>` natively, through update-list-info, with no
 * `__RemoveElement`).
 *
 * `LynxElement` keeps answers it read from the native tree (an element's
 * parent, an element's ancestors) under the version they were read at, and
 * reads them again once it has moved: building a screen asks the same
 * questions thousands of times (Angular asks for the parent of a `@for`'s
 * anchor for every row it adds), and each native read is a call out of
 * JavaScript (#444).
 *
 * Inserting a new element, one that has never been in the tree, doesn't move
 * it: nothing already in the tree gets a new parent or ancestor. That's what a
 * screen being built does almost every time, so it keeps the answers.
 *
 * Its own module so that the list's and the document's native calls can move
 * it without importing `LynxElement`.
 */
let version = 0;

/** The current version (see above). */
export const nativeTreeVersion = (): number => version;

/**
 * Says the native tree may have changed shape: answers read from it before
 * are read again.
 */
export const noteNativeTreeChanged = (): void => {
  version++;
};

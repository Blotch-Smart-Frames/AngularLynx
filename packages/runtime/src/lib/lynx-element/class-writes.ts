/**
 * Writes to native the classes LynxElement keeps back during change
 * detection, which reach native at the end of the cycle (see its
 * #pendingClasses), so that code reading native's classes, or having native
 * resolve the tree, before then sees them: a main-thread script's
 * MainThreadElement reads, an element animation (`__ElementAnimate` has
 * native resolve and lay out the tree at once), and the getComputedStyle
 * wrapper. A hook rather than an import, as for layout.ts's setMeasureFlush:
 * those modules have no need of the element module, which installs it with
 * its first element. Before then no element has classes waiting.
 */
let writer: () => void = () => {};

/**
 * Sets what writePendingClasses calls: LynxElement.commitPendingClasses.
 */
export const setPendingClassWriter = (write: () => void): void => {
  writer = write;
};

/**
 * Writes the classes waiting for the end of the cycle (see the module doc).
 */
export const writePendingClasses = (): void => {
  writer();
};

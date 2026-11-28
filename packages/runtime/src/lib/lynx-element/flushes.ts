/**
 * How many times the runtime has flushed the element tree, or got ready to:
 * each `__FlushElementTree()` it makes counts, and so does the end of every
 * change detection cycle (`LynxElement.commitPendingClasses()`, which every
 * path to a flush runs first, including the first render's, which native
 * makes after `renderPage()`). An element made since the count last moved
 * has never been flushed, so it has no painting node and nothing on the
 * screen yet: moving it costs native nothing it wouldn't pay anyway (see
 * LynxElement's #appendsBeforeTail). Counting more than the flushes is safe,
 * as it only makes fewer elements count as new.
 */
let flushes = 0;

/** The count as it stands (see {@link noteFlush}). */
export const flushCount = (): number => flushes;

/**
 * @internal Counts a flush of the element tree, or of a part of it, that the
 * runtime is about to make (see {@link flushes}). Called right before each
 * `__FlushElementTree()`.
 */
export const noteFlush = (): void => {
  flushes++;
};

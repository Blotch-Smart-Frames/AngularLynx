/**
 * The canvas contexts with calls recorded and not sent yet. A 2D or WebGL2
 * context sends its calls at the end of the task (see their `#send`), but an
 * ImageBitmap's pixels can leave the shell sooner: `close()` frees them, and
 * `transferFromImageBitmap()` hands them to a canvas, at once. A
 * `drawImage()` or `texImage2D()` of the bitmap recorded earlier in the task
 * would then find no pixels by the time it ran, where the web draws the
 * bitmap as it was at the call. So the bitmap sends every context's recorded
 * calls first (see image.ts).
 */
const pending = new Set<() => unknown>();

/**
 * A context recorded a call it will send later: `send` sends what it has.
 */
export const markBatchPending = (send: () => unknown): void => {
  pending.add(send);
};

/** A context sent its calls, or has none left to send. */
export const markBatchSent = (send: () => unknown): void => {
  pending.delete(send);
};

/**
 * Sends every context's recorded calls now, so the calls that read an
 * image run while the shell still has its pixels.
 */
export const sendPendingBatches = (): void => {
  // A copy: each send takes itself out of the set.
  for (const send of Array.from(pending)) send();
};

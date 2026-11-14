/**
 * How long after a frame's callback a turn it schedules may start, in ms,
 * for the thread to count as idle: nothing else ran in between.
 */
const IDLE_TURN = 4;

/**
 * How many frames afterFrame waits for the thread to be idle, at most,
 * before it runs its callback anyway.
 */
const IDLE_FRAMES = 4;

/**
 * Runs `callback` once the screen has drawn what's been flushed so far, and
 * the thread has nothing else to do: on the turn after a frame, if that turn
 * comes straight after the frame, or else after a later frame, up to four of
 * them. Returns what cancels it.
 *
 * Start a CSS transition that the platform runs (an element with
 * `enable-new-animator="false"`) from it. On iOS, Core Animation begins the
 * transition at the time of the last frame the thread saw, and gets it once
 * the thread is next idle. A turn that builds a screen and lays it out holds
 * both back, so a transition started on the turn after it had begun that
 * long before it was first drawn, and its first frame came a quarter of the
 * way in, or further. After a frame, with nothing else waiting, it begins
 * with that frame and is drawn with the next. The frame's callback itself is
 * too early: the clock Lynx reads may not have seen the frame yet.
 *
 * In the web preview, the frame draws the elements where they start, which a
 * browser needs to transition them. Without `requestAnimationFrame`, it runs
 * on the next turn.
 *
 * ```ts
 * afterFrame(() => this.open.set(true));
 * ```
 */
export const afterFrame = (callback: () => void): (() => void) => {
  if (typeof requestAnimationFrame !== 'function') {
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
  }
  let canceled = false;
  let frames = 0;
  const frame = (): void => {
    const drawn = Date.now();
    frames++;
    setTimeout(() => {
      if (canceled) return;
      if (Date.now() - drawn <= IDLE_TURN || frames >= IDLE_FRAMES) {
        callback();
      } else {
        requestAnimationFrame(frame);
      }
    }, 0);
  };
  requestAnimationFrame(frame);
  return () => {
    canceled = true;
  };
};

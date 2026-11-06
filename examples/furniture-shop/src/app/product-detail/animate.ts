export type AnimateOptions = {
  from: number;
  to: number;
  /** Milliseconds. */
  duration: number;
  /** Maps elapsed time (0 to 1) to progress (0 to 1). */
  easing: (t: number) => number;
  onUpdate: (value: number) => void;
};

/**
 * Moves a number from `from` to `to`, one requestAnimationFrame at a time,
 * and returns a function that stops it. It runs where it's called: in this
 * app that's the main thread, next to the elements it moves.
 */
export const animate = ({
  from,
  to,
  duration,
  easing,
  onUpdate,
}: AnimateOptions): (() => void) => {
  let frame = 0;
  let started = 0;
  const step = (timestamp: number) => {
    const now = typeof timestamp === 'number' ? timestamp : Date.now();
    if (!started) started = now;
    const progress = duration > 0 ? Math.min((now - started) / duration, 1) : 1;
    onUpdate(from + (to - from) * easing(progress));
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
};

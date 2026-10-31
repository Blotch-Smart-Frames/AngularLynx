import { ORIGIN, type Point } from './touch-point';

/**
 * Below this speed (px/s) in an axis, a release doesn't fling in it; Lynx's
 * kLynxMinVelocity.
 */
const MIN_VELOCITY = 50;

/**
 * Releases faster than this (px/s) fling as fast as this; kLynxMaxVelocity.
 */
const MAX_VELOCITY = 10000;

/**
 * How much speed a fling keeps each millisecond, as on iOS.
 */
const DECELERATION_RATE = 0.998;

const COEFFICIENT = 1000 * Math.log(DECELERATION_RATE);

/**
 * What the trigger needs from the page's window: its frames and clock.
 */
export type FlingFrames = Pick<
  Window,
  'requestAnimationFrame' | 'cancelAnimationFrame' | 'devicePixelRatio'
> & { readonly performance: Pick<Performance, 'now'> };

export type FlingTriggerState = 'start' | 'update' | 'end';

/**
 * Distance traveled after `seconds` of a fling that lasts `duration`.
 */
const distanceAt = (
  seconds: number,
  duration: number,
  velocity: number,
): number => {
  const progress = Math.min(1, seconds / duration);
  return (
    ((DECELERATION_RATE ** (1000 * progress * duration) - 1) / COEFFICIENT) *
    velocity
  );
};

/**
 * The momentum after a touch: LynxGestureFlingTrigger.m. Started with the
 * release's velocity, it decelerates as a UIScrollView does and reports each
 * frame (`onFrame`) until it moves less than half a device pixel a frame.
 * The arena hands each frame's step to the fling gestures.
 */
export class FlingTrigger {
  state: FlingTriggerState = 'end';
  /**
   * How far the fling has gone, and had gone at the frame before.
   */
  distance = ORIGIN;
  lastDistance = ORIGIN;

  readonly #onFrame: (trigger: FlingTrigger) => void;
  #frames: FlingFrames | null = null;
  #frame: number | undefined;
  #running = false;
  #begin = 0;
  #velocity = ORIGIN;
  #flingX = false;
  #flingY = false;
  #durationX = 0;
  #durationY = 0;

  constructor(onFrame: (trigger: FlingTrigger) => void) {
    this.#onFrame = onFrame;
  }

  /**
   * Flings at `velocity` (px/s), unless it's too slow in both axes. Returns
   * whether it did.
   */
  start(velocity: Point, frames: FlingFrames): boolean {
    const clamp = (v: number) =>
      Math.max(Math.min(MAX_VELOCITY, v), -MAX_VELOCITY);
    const v = { x: clamp(velocity.x), y: clamp(velocity.y) };
    const flingX = Math.abs(v.x) >= MIN_VELOCITY;
    const flingY = Math.abs(v.y) >= MIN_VELOCITY;
    if (!flingX && !flingY) return false;
    this.stop();
    // The fling stops once a frame would move it less than half a device
    // pixel: Lynx's threshold, 0.5 / UIScreen.scale.
    const threshold = 0.5 / (frames.devicePixelRatio || 1);
    const duration = (speed: number) =>
      Math.log((-COEFFICIENT * threshold) / Math.abs(speed)) / COEFFICIENT;
    this.#frames = frames;
    this.#velocity = v;
    this.#flingX = flingX;
    this.#flingY = flingY;
    this.#durationX = duration(v.x);
    this.#durationY = duration(v.y);
    this.#begin = frames.performance.now();
    this.distance = ORIGIN;
    this.lastDistance = ORIGIN;
    this.state = 'start';
    this.#running = true;
    this.#frame = frames.requestAnimationFrame(this.#tick);
    return true;
  }

  stop(): void {
    this.#running = false;
    if (this.#frame !== undefined) {
      this.#frames?.cancelAnimationFrame(this.#frame);
    }
    this.#frame = undefined;
  }

  reset(): void {
    this.stop();
    this.distance = ORIGIN;
    this.lastDistance = ORIGIN;
    this.state = 'end';
  }

  isFinished(): boolean {
    return !this.#running;
  }

  // A frame's handlers can stop the fling, so it checks after each call.
  readonly #tick = (now: number): void => {
    this.#frame = undefined;
    if (this.state === 'start') {
      this.#onFrame(this);
      if (!this.#running) return;
      this.state = 'update';
    }
    // iOS steps a fixed frame length each tick, at the display's rate; a
    // browser's frame rate varies, so this goes by the clock.
    const seconds = Math.max(0, now - this.#begin) / 1000;
    const done = (fling: boolean, duration: number) =>
      !fling || seconds >= duration;
    const willEnd =
      done(this.#flingX, this.#durationX) &&
      done(this.#flingY, this.#durationY);
    this.distance = {
      x: this.#flingX
        ? distanceAt(seconds, this.#durationX, this.#velocity.x)
        : this.lastDistance.x,
      y: this.#flingY
        ? distanceAt(seconds, this.#durationY, this.#velocity.y)
        : this.lastDistance.y,
    };
    this.#onFrame(this);
    if (!this.#running) return;
    this.lastDistance = this.distance;
    if (willEnd) {
      this.state = 'end';
      this.#onFrame(this);
      this.stop();
      return;
    }
    this.#frame = this.#frames!.requestAnimationFrame(this.#tick);
  };
}

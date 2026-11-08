/**
 * How `<lynx-stack-outlet>` moves its pages: `'ios'` (UIKit's navigation
 * controller), `'material'` (Android's activity transition, and its
 * predictive back while a finger drags a page), or `'none'`, which swaps
 * pages at once and turns the swipe off.
 */
export type StackAnimation = 'ios' | 'material' | 'none';

/**
 * Where a page is and how it looks at one end of a transition. `x` is a
 * share of the outlet's width, so the same motion fits any screen.
 */
export type PageLook = {
  readonly x: number;
  readonly scale: number;
  readonly opacity: number;
};

/**
 * One platform's page transition.
 *
 * A push brings the new page in from `offscreen` to rest while the page under
 * it goes to `covered`, and a pop runs the same transition backwards. A finger
 * dragging the top page away moves it through `dragged()`, the page under it
 * from `covered` to rest, and letting go either sends the top page to
 * `dismissed` or brings it back to rest.
 */
export type StackMotion = {
  /** How long a push or a pop takes, in ms. */
  readonly duration: number;
  /** The timing function of a push or a pop. */
  readonly easing: string;
  /** Where the page under the top one waits. */
  readonly covered: PageLook;
  /** Where a pushed page comes in from, and a popped one leaves to. */
  readonly offscreen: PageLook;
  /** The top page as a finger drags it, `progress` (0 to 1) of the way across. */
  readonly dragged: (progress: number) => PageLook;
  /** Where the top page goes when a drag lets it go. */
  readonly dismissed: PageLook;
  /**
   * How dark the scrim over the covered page gets: the opacity of black over
   * it, which lifts as it comes back.
   */
  readonly dim: number;
  /** The moving page's corner radius, in px, or 0 for square corners. */
  readonly radius: number;
  /** Whether a push or a pop rounds the page too, or only a drag. */
  readonly roundsAnimated: boolean;
  /** The moving page's shadow, as a `box-shadow`, or null for none. */
  readonly shadow: string | null;
};

/** A page at rest: where it is when nothing moves. */
export const AT_REST: PageLook = { x: 0, scale: 1, opacity: 1 };

/**
 * The corner radius of the display the page fills: the iPhone 16 Pro's and
 * later (62pt, measured on the iOS 27 Simulator's iPhone 18 Pro). Lynx can't
 * read a phone's own, and earlier iPhones round less, so on those a moving
 * page rounds a little more than the screen does.
 */
const IOS_DISPLAY_RADIUS = 62;

/**
 * UIKit's navigation controller, as iOS 27 draws it (measured frame by frame
 * from a screen recording of the Settings app on the iOS 27 Simulator):
 *
 * - The pushed page comes in from the right edge with the display's rounded
 *   corners and a faint shadow, and the page under it slides a third of the
 *   way left (UIKit's 30% parallax) under black at 6%.
 * - It moves as a critically damped spring of about 26 rad/s: three quarters
 *   of the way in 0.1s, settled by 0.35s. The cubic-bezier is fitted to that
 *   spring over 350ms (within 1.5% of it all the way).
 * - A drag moves the page with the finger, one to one.
 */
export const IOS_MOTION: StackMotion = {
  duration: 350,
  easing: 'cubic-bezier(0.32, 0.68, 0.12, 1)',
  covered: { x: -0.3, scale: 1, opacity: 1 },
  offscreen: { x: 1, scale: 1, opacity: 1 },
  dragged: (progress) => ({ x: progress, scale: 1, opacity: 1 }),
  dismissed: { x: 1, scale: 1, opacity: 1 },
  dim: 0.06,
  radius: IOS_DISPLAY_RADIUS,
  roundsAnimated: true,
  shadow: '0 0 24px rgba(0, 0, 0, 0.12)',
};

/**
 * Android's own transitions, from Android's source:
 *
 * - A push or a pop is the activity transition of Android 13 and later
 *   (`activity_open_enter.xml` and its kin): the new page slides in from a
 *   tenth of the way right and fades in, the page under it slides a tenth
 *   left, over 450ms with `fast_out_extra_slow_in`, Material 3's emphasized
 *   easing, whose cubic-bezier approximation this is. Android fades over the
 *   first 133ms; here the fade follows the same easing, which is 70% of the
 *   way by then.
 * - A drag is Material 3's predictive back for a full screen: the page
 *   shrinks to 90% and edges toward the side the finger moves to, with
 *   rounded corners, over the page under it, and letting it go fades it out.
 */
export const MATERIAL_MOTION: StackMotion = {
  duration: 450,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  covered: { x: -0.1, scale: 1, opacity: 1 },
  offscreen: { x: 0.1, scale: 1, opacity: 0 },
  dragged: (progress) => ({
    x: progress * 0.05,
    scale: 1 - progress * 0.1,
    opacity: 1,
  }),
  dismissed: { x: 0.1, scale: 0.9, opacity: 0 },
  dim: 0.1,
  // Material 3's large-increased shape, which predictive back rounds a full
  // screen to as it shrinks.
  radius: 28,
  roundsAnimated: false,
  shadow: null,
};

/**
 * The cross-fade that replaces a push or a pop's slide while Reduce Motion is
 * on, as UIKit's navigation controller does. A drag still moves the page: the
 * finger moves it.
 */
export const FADE_MOTION: StackMotion = {
  ...IOS_MOTION,
  duration: 250,
  easing: 'ease-in-out',
  covered: AT_REST,
  offscreen: { x: 0, scale: 1, opacity: 0 },
  dim: 0,
  roundsAnimated: false,
  shadow: null,
};

/** Interpolates between two looks, `t` (0 to 1) of the way from `a` to `b`. */
export const mixLooks = (a: PageLook, b: PageLook, t: number): PageLook => ({
  x: a.x + (b.x - a.x) * t,
  scale: a.scale + (b.scale - a.scale) * t,
  opacity: a.opacity + (b.opacity - a.opacity) * t,
});

/**
 * A look as inline styles, for a page `width` px wide. Without a width yet
 * (the outlet hasn't been laid out), the offset is a percentage of the page's
 * own width, which is the same thing for a page filling the outlet.
 */
export const lookStyles = (
  look: PageLook,
  width: number,
): { transform: string; opacity: string } => {
  const x =
    width > 0 ? `${round(look.x * width)}px` : `${round(look.x * 100)}%`;
  const scale = look.scale === 1 ? '' : ` scale(${round(look.scale, 4)})`;
  return {
    transform: `translateX(${x})${scale}`,
    opacity: String(round(look.opacity, 4)),
  };
};

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

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
  /**
   * The moving page's corner radius, in px, or 0 for square corners: the
   * screen's own. Only the corners in a corner of the screen round (see
   * screenCorners).
   */
  readonly radius: number;
  /** Whether a push or a pop rounds the page too, or only a drag. */
  readonly roundsAnimated: boolean;
  /**
   * Whether a drag rounds the page's square corners too, as it shrinks the
   * page away from the outlet's edges: from square at the start to `radius`
   * at the end (see shrunkCorners).
   */
  readonly roundsShrinking: boolean;
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
  roundsShrinking: false,
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
  // screen to as it shrinks. Android starts from the display's own radius,
  // which Lynx can't read either, so the screen's corners are this from the
  // start.
  radius: 28,
  roundsAnimated: false,
  roundsShrinking: true,
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

/**
 * The radius of each corner of a page, in px, in the order `border-radius`
 * lists them: top left, top right, bottom right, bottom left.
 */
export type Corners = readonly [number, number, number, number];

/** Square corners all round. */
export const SQUARE: Corners = [0, 0, 0, 0];

/** A box on the screen, such as the outlet's, relative to the LynxView, in px. */
export type ScreenBox = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** The screen's size, in px: the LynxView's (`innerWidth`, `innerHeight`). */
export type ScreenSize = { readonly width: number; readonly height: number };

/**
 * How far from the screen's edge a box's edge can be and still be on it, in
 * px: Lynx lays out in fractions of a pixel.
 */
const ON_EDGE = 0.5;

/**
 * The corners of a page at rest in an outlet whose box is `box`: `radius` at
 * each of the outlet's corners that's a corner of the screen, and square at
 * the others.
 *
 * A moving page rounds its corners to look like the screen it fills, whose
 * own corners are round. Where the outlet's corner isn't the screen's, as
 * under an app bar or over a tab bar, the outlet's corner is square and
 * clips the page there, so a round corner on the page only shows the page
 * under it through the gap. Both platforms round on that rule. Material's
 * predictive back gives a corner the display's radius only where it's at the
 * screen's corner, and 0 elsewhere (MaterialMainContainerBackHelper in
 * Material Components for Android). iOS 26 makes a view's corners concentric
 * with its container's, and a container away from the screen's corners has
 * square ones.
 *
 * The LynxView counts as the screen, as it does for `innerWidth`: an app
 * fills the screen with it. An outlet that isn't laid out yet, or a screen
 * of no size, gets square corners: where the outlet is isn't known.
 */
export const screenCorners = (
  box: ScreenBox,
  screen: ScreenSize,
  radius: number,
): Corners => {
  if (
    radius <= 0 ||
    box.width <= 0 ||
    box.height <= 0 ||
    screen.width <= 0 ||
    screen.height <= 0
  ) {
    return SQUARE;
  }
  const left = box.left <= ON_EDGE;
  const top = box.top <= ON_EDGE;
  const right = box.left + box.width >= screen.width - ON_EDGE;
  const bottom = box.top + box.height >= screen.height - ON_EDGE;
  const radiusIf = (inCorner: boolean): number => (inCorner ? radius : 0);
  return [
    radiusIf(top && left),
    radiusIf(top && right),
    radiusIf(bottom && right),
    radiusIf(bottom && left),
  ];
};

/**
 * The corners of a page a drag has shrunk `progress` (0 to 1) of the way:
 * the square ones round toward `radius` as the page leaves the outlet's
 * edges, which Material's predictive back interpolates the same way.
 */
export const shrunkCorners = (
  corners: Corners,
  radius: number,
  progress: number,
): Corners =>
  corners.map((corner) => corner + (radius - corner) * progress) as [
    number,
    number,
    number,
    number,
  ];

/**
 * Corners as a `border-radius`, or null for square ones.
 */
export const cornerStyle = (corners: Corners): string | null => {
  if (corners.every((corner) => corner <= 0)) return null;
  if (corners.every((corner) => corner === corners[0])) {
    return `${round(corners[0])}px`;
  }
  return corners.map((corner) => `${round(corner)}px`).join(' ');
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

/**
 * Shared animation utility for @blotch/ui components.
 *
 * Centralizes all motion constants (durations, easing curves, scale factors)
 * and provides reusable animation helpers that wrap the Lynx element.animate() API.
 * This ensures a consistent, cohesive motion language across the entire component library.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Duration constants in milliseconds
 */
export const DURATION = {
  /**
   * Micro-interactions: checkbox tick, radio dot
   */
  instant: 100,
  /**
   * Press/release, thumb slide
   */
  fast: 150,
  /**
   * Overlays, content transitions
   */
  normal: 250,
  /**
   * Sheet/drawer slide, accordion expand
   */
  slow: 350,
} as const;

/**
 * Easing curves for different animation contexts
 */
export const EASING = {
  /**
   * Entering elements — fast start, gentle stop
   */
  decelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
  /**
   * Exiting elements — gentle start, fast stop
   */
  accelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  /**
   * General purpose movement
   */
  standard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
  /**
   * Bouncy overshoot — playful, energetic entrance
   */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  /**
   * Gentle overshoot — refined entrance
   */
  springSubtle: 'cubic-bezier(0.22, 1.2, 0.36, 1)',
  /**
   * iOS-style sheet/drawer slide
   */
  sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

/**
 * Scale factors for transform animations
 */
export const SCALE = {
  /**
   * Button/toggle press
   */
  pressDown: 0.97,
  /**
   * List item / card press (lighter)
   */
  pressDownLight: 0.985,
  /**
   * Small elements popping in (check, radio dot)
   */
  popFrom: 0.6,
  /**
   * Dialog entrance starting scale
   */
  dialogFrom: 0.9,
  /**
   * Dialog exit ending scale
   */
  dialogTo: 0.95,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options shared by most animation helpers
 */
export type AnimateOptions = {
  duration?: number;
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
};

/**
 * A cancelable animation handle returned by Lynx element.animate()
 */
export type AnimationHandle = {
  cancel(): void;
};

// ---------------------------------------------------------------------------
// Primitive Helpers
// ---------------------------------------------------------------------------

/**
 * Fades an element in (opacity 0 → 1).
 * Used for backdrops, content reveals, and soft entrances.
 */
export const fadeIn = (
  el: any,
  options?: AnimateOptions,
): AnimationHandle | undefined => {
  if (!el) return undefined;
  return el.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: options?.duration ?? DURATION.normal,
    easing: options?.easing ?? EASING.decelerate,
    fill: options?.fill ?? 'forwards',
  });
};

/**
 * Fades an element out (opacity 1 → 0).
 * Used for backdrops, content dismissals, and soft exits.
 */
export const fadeOut = (
  el: any,
  options?: AnimateOptions,
): AnimationHandle | undefined => {
  if (!el) return undefined;
  return el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: options?.duration ?? DURATION.fast,
    easing: options?.easing ?? EASING.accelerate,
    fill: options?.fill ?? 'forwards',
  });
};

/**
 * Scales and fades an element in — used for overlay panels (dialog, alert-dialog).
 * Animates from a smaller scale + offset to full size.
 */
export const scaleIn = (
  el: any,
  options?: AnimateOptions & { fromScale?: number; fromY?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const fromScale = options?.fromScale ?? SCALE.dialogFrom;
  const fromY = options?.fromY ?? 10;
  return el.animate(
    [
      { transform: `scale(${fromScale}) translateY(${fromY}px)`, opacity: 0 },
      { transform: 'scale(1) translateY(0px)', opacity: 1 },
    ],
    {
      duration: options?.duration ?? DURATION.slow,
      easing: options?.easing ?? EASING.springSubtle,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Scales and fades an element out — used for overlay panel exit.
 */
export const scaleOut = (
  el: any,
  options?: AnimateOptions & { toScale?: number; toY?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const toScale = options?.toScale ?? SCALE.dialogTo;
  const toY = options?.toY ?? 10;
  return el.animate(
    [
      { transform: 'scale(1) translateY(0px)', opacity: 1 },
      { transform: `scale(${toScale}) translateY(${toY}px)`, opacity: 0 },
    ],
    {
      duration: options?.duration ?? DURATION.fast,
      easing: options?.easing ?? EASING.accelerate,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Slides an element in from a direction.
 * Used for sheets (bottom), nav-drawers (left/right), toasts (bottom).
 */
export const slideIn = (
  el: any,
  direction: 'up' | 'down' | 'left' | 'right',
  options?: AnimateOptions,
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const translate = {
    up: ['translateY(100%)', 'translateY(0%)'],
    down: ['translateY(-100%)', 'translateY(0%)'],
    left: ['translateX(-100%)', 'translateX(0%)'],
    right: ['translateX(100%)', 'translateX(0%)'],
  }[direction];
  return el.animate(
    [
      { transform: translate[0], opacity: 0.8 },
      { transform: translate[1], opacity: 1 },
    ],
    {
      duration: options?.duration ?? DURATION.slow,
      easing: options?.easing ?? EASING.sheet,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Slides an element out to a direction.
 */
export const slideOut = (
  el: any,
  direction: 'up' | 'down' | 'left' | 'right',
  options?: AnimateOptions,
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const translate = {
    up: ['translateY(0%)', 'translateY(-100%)'],
    down: ['translateY(0%)', 'translateY(100%)'],
    left: ['translateX(0%)', 'translateX(-100%)'],
    right: ['translateX(0%)', 'translateX(100%)'],
  }[direction];
  return el.animate(
    [
      { transform: translate[0], opacity: 1 },
      { transform: translate[1], opacity: 0.8 },
    ],
    {
      duration: options?.duration ?? DURATION.normal,
      easing: options?.easing ?? EASING.accelerate,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Pops a small element in with spring physics.
 * Used for checkbox marks, radio dots, badges.
 */
export const popIn = (
  el: any,
  options?: AnimateOptions & { fromScale?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const from = options?.fromScale ?? SCALE.popFrom;
  return el.animate(
    [
      { transform: `scale(${from})`, opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    {
      duration: options?.duration ?? DURATION.fast,
      easing: options?.easing ?? EASING.spring,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Pops a small element out (reverse of popIn).
 */
export const popOut = (
  el: any,
  options?: AnimateOptions & { toScale?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const to = options?.toScale ?? 0.8;
  return el.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${to})`, opacity: 0 },
    ],
    {
      duration: options?.duration ?? DURATION.instant,
      easing: options?.easing ?? EASING.accelerate,
      fill: options?.fill ?? 'forwards',
    },
  );
};

// ---------------------------------------------------------------------------
// Press Feedback Helpers
// ---------------------------------------------------------------------------

/**
 * Drives a press-feedback transform with an inline CSS transition instead of
 * the imperative `element.animate()` (Web Animations) API.
 *
 * WHY NOT `el.animate()`: it plays on iOS/Android (native runs the renderer on
 * the main thread, where `__ElementAnimate` maps to a real native animation)
 * but is a DEAD no-op on Lynx web. On web the app runs inside `@lynx-js/web-core`'s
 * worker against an OFFSCREEN document; `element.animate()` there creates a live
 * Web-Animation on the offscreen node that is never serialized to the real DOM,
 * so the on-screen element never moves. (Verified in a headless browser: the
 * press handlers fire and `el.element.animate()` runs without error, yet the
 * rendered node's computed transform stays `none`.) Inline STYLE mutations, by
 * contrast, ARE serialized offscreen→real — that is how every `[style.*]`
 * binding renders on web — so a `transition` + `transform` written via
 * `setStyle` animates identically on native and web.
 *
 * The "from" state is always the element's current transform, so setting the
 * `transition` and the new `transform` together reliably triggers the
 * transition on both platforms (no from-state reflow needed, unlike an
 * entrance animation would require).
 */
const transitionTransform = (
  el: any,
  transform: string,
  duration: number,
  easing: string,
): AnimationHandle | undefined => {
  if (!el?.setStyle) return undefined;
  el.setStyle('transition', `transform ${duration}ms ${easing}`);
  el.setStyle('transform', transform);
  // CSS transitions have no imperative handle to stop; re-pressing simply
  // re-transitions from the current value. cancel() is a no-op kept for API
  // parity with callers that store and cancel the previous handle.
  return { cancel() {} };
};

/**
 * Animates an element being pressed down (scale shrink).
 *
 * Wire this to BOTH the touch and mouse press-start events —
 * `(bindtouchstart)` and `(bindmousedown)`. Native (iOS/Android) only ever
 * fires touch events; Lynx web runs in the browser, where a mouse press fires
 * `mousedown` and NEVER `touchstart`. Mouse events are inert on touch devices,
 * so binding both yields identical press-and-hold feedback across platforms.
 * See `transitionTransform` for why this uses a CSS transition, not
 * `el.animate()`.
 */
export const pressDown = (
  el: any,
  scale: number = SCALE.pressDown,
): AnimationHandle | undefined =>
  transitionTransform(el, `scale(${scale})`, DURATION.instant, EASING.standard);

/**
 * Animates an element releasing from a press (scale back with spring).
 *
 * Wire this to the touch AND mouse release events — `(bindtouchend)` +
 * `(bindtouchcancel)` and `(bindmouseup)` + `(bindmouseleave)`. See `pressDown`
 * for why the mouse bindings are required on Lynx web. `mouseleave` is the
 * `touchcancel` analogue: it restores the scale if the cursor leaves the
 * element while still pressed.
 */
export const pressRelease = (el: any): AnimationHandle | undefined =>
  transitionTransform(el, 'scale(1)', DURATION.fast, EASING.spring);

// ---------------------------------------------------------------------------
// Composite Helpers
// ---------------------------------------------------------------------------

/**
 * Orchestrates opening an overlay (backdrop + panel entrance).
 * Provides staggered timing — backdrop fades first, then panel enters.
 */
export const overlayOpen = (
  backdrop: any,
  panel: any,
  type: 'center' | 'bottom' | 'left' | 'right',
): { backdrop?: AnimationHandle; panel?: AnimationHandle } => {
  // Backdrop fades in immediately
  const backdropAnim = fadeIn(backdrop, { duration: DURATION.normal });

  // Panel enters with a 30ms stagger after backdrop
  let panelAnim: AnimationHandle | undefined;
  setTimeout(() => {
    if (type === 'center') {
      panelAnim = scaleIn(panel);
    } else if (type === 'bottom') {
      panelAnim = slideIn(panel, 'up');
    } else if (type === 'left') {
      panelAnim = slideIn(panel, 'left');
    } else {
      panelAnim = slideIn(panel, 'right');
    }
  }, 30);

  return { backdrop: backdropAnim, panel: panelAnim };
};

/**
 * Orchestrates closing an overlay (panel exits, then backdrop fades).
 * Returns total animation duration for cleanup scheduling.
 */
export const overlayClose = (
  backdrop: any,
  panel: any,
  type: 'center' | 'bottom' | 'left' | 'right',
): number => {
  // Panel exits immediately
  if (type === 'center') {
    scaleOut(panel, { duration: 180 });
  } else if (type === 'bottom') {
    slideOut(panel, 'down', { duration: DURATION.normal });
  } else if (type === 'left') {
    slideOut(panel, 'left', { duration: DURATION.normal });
  } else {
    slideOut(panel, 'right', { duration: DURATION.normal });
  }

  // Backdrop fades out in parallel
  fadeOut(backdrop, { duration: DURATION.normal });

  // Return the longest duration for setTimeout cleanup
  return type === 'center' ? 180 : DURATION.normal;
};

// ---------------------------------------------------------------------------
// Continuous Animation Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a continuous pulse animation (for skeleton loading states).
 * Oscillates opacity between 1 and 0.5 indefinitely.
 */
export const pulse = (
  el: any,
  options?: { duration?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  return el.animate([{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], {
    duration: options?.duration ?? 1500,
    easing: 'ease-in-out',
    iterations: Infinity,
  });
};

/**
 * Creates a horizontal shake animation (for error states on inputs).
 * Shakes ±4px then ±2px before settling.
 */
export const shake = (
  el: any,
  options?: AnimateOptions,
): AnimationHandle | undefined => {
  if (!el) return undefined;
  return el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-2px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    {
      duration: options?.duration ?? DURATION.slow,
      easing: options?.easing ?? EASING.standard,
      fill: 'forwards',
    },
  );
};

/**
 * Animates a spring-based translation between two X positions.
 * Used for switch thumbs with a squish effect at midpoint.
 */
export const springTranslateX = (
  el: any,
  fromX: number,
  toX: number,
  options?: AnimateOptions,
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const midX = (fromX + toX) / 2;
  return el.animate(
    [
      { transform: `translateX(${fromX}px) scale(1)` },
      { transform: `translateX(${midX}px) scale(1.1)` },
      { transform: `translateX(${toX}px) scale(1)` },
    ],
    {
      duration: options?.duration ?? 200,
      easing: options?.easing ?? EASING.spring,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Content reveal animation — fade in with upward slide.
 * Used for accordion content, tab content, alerts, etc.
 */
export const revealIn = (
  el: any,
  options?: AnimateOptions & { fromY?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const fromY = options?.fromY ?? 8;
  return el.animate(
    [
      { transform: `translateY(${fromY}px)`, opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    {
      duration: options?.duration ?? DURATION.normal,
      easing: options?.easing ?? EASING.decelerate,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/**
 * Direction-aware slide + fade for tab content transitions.
 * Slides from left or right based on navigation direction, creating
 * a spatial relationship between tab panels.
 */
export const directionalSlideIn = (
  el: any,
  direction: 1 | -1,
  options?: AnimateOptions & { distance?: number },
): AnimationHandle | undefined => {
  if (!el) return undefined;
  const distance = options?.distance ?? 24;
  const fromX = direction * distance;
  return el.animate(
    [
      { transform: `translateX(${fromX}px)`, opacity: 0 },
      { transform: 'translateX(0px)', opacity: 1 },
    ],
    {
      duration: options?.duration ?? DURATION.slow,
      easing: options?.easing ?? EASING.springSubtle,
      fill: options?.fill ?? 'forwards',
    },
  );
};

/** How far an interactive glass shape is pressed, and where. */
export type PressState = {
  /** 1 while a pointer is down on the shape, else 0. */
  target: number;
  /** Eased from 0 (at rest) to 1 (fully pressed). */
  value: number;
  /** The pointer, in viewport (client) coordinates. */
  x: number;
  y: number;
};

const presses = new WeakMap<Element, PressState>();

// Time constants of the ease, in milliseconds: iOS's glass swells quickly
// under a finger and settles back more slowly.
const PRESS_IN_MS = 70;
const PRESS_OUT_MS = 180;

/**
 * Follows pointer presses on a `<blur-view>`, for `glass-interactive`. The
 * listeners are passive and never stop propagation, so the element's own
 * Lynx touch and tap handlers still run. The attribute is checked when a press
 * starts, since it can be bound and change at any time.
 */
export const trackPress = (element: HTMLElement): void => {
  const state: PressState = { target: 0, value: 0, x: 0, y: 0 };
  presses.set(element, state);
  const follow = (event: PointerEvent) => {
    state.x = event.clientX;
    state.y = event.clientY;
  };
  const release = () => {
    state.target = 0;
  };
  const options = { passive: true };
  element.addEventListener(
    'pointerdown',
    (event) => {
      if (!element.hasAttribute('glass-interactive')) return;
      state.target = 1;
      follow(event);
    },
    options,
  );
  element.addEventListener(
    'pointermove',
    (event) => {
      if (state.target) follow(event);
    },
    options,
  );
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    element.addEventListener(type, release, options);
  }
};

export const pressOf = (element: Element): PressState | undefined =>
  presses.get(element);

/**
 * Eases a press toward its target over `elapsed` milliseconds. Returns the
 * new value, snapping to the target once it's indistinguishable.
 */
export const stepPress = (state: PressState, elapsed: number): number => {
  const time = state.target ? PRESS_IN_MS : PRESS_OUT_MS;
  const next =
    state.target + (state.value - state.target) * Math.exp(-elapsed / time);
  state.value = Math.abs(next - state.target) < 0.001 ? state.target : next;
  return state.value;
};

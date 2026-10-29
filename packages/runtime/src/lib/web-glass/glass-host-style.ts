/** How a `<blur-view>` on web is styled while the glass code looks after it. */
export type HostStyleState = {
  /** It's a glass shape that WebGL isn't drawing (yet): show frosted CSS. */
  fallback: boolean;
  /** WebGL draws this shape, so web-elements' own backdrop blur must go. */
  rendered: boolean;
  /** It holds a group's canvas, which must stack under its children. */
  hostsCanvas: boolean;
  /**
   * It casts its shadow with CSS: a lone glass shape, whose canvas is its own
   * box, and any glass shape in the fallback. A container draws its shapes'
   * shadow on its canvas.
   */
  shadow: boolean;
  /** How much it's drawn scaled: above 1 while a lone shape swells. */
  scale: number;
};

const styles = new WeakMap<Element, HTMLStyleElement>();

const DEFAULT_FALLBACK_BLUR = 12;

/**
 * The frosted look a glass shape has before WebGL takes over, or without it:
 * a backdrop blur with a bright inner rim, roughly the pre-iOS-26 material.
 * Author styles on the element itself still win, since a `:host` rule loses to
 * them, so a background set in the template is kept. Its rims are in
 * FALLBACK_EDGES, since the shadow shares its `box-shadow`.
 */
export const fallbackGlassCss = (element: Element): string => {
  const clear = element.getAttribute('glass-style') === 'clear';
  const radius =
    parseFloat(element.getAttribute('blur-radius') ?? '') ||
    (clear ? DEFAULT_FALLBACK_BLUR / 3 : DEFAULT_FALLBACK_BLUR);
  const filter = `blur(${radius}px) saturate(${clear ? 140 : 180}%)`;
  const background =
    element.getAttribute('glass-tint-color') ||
    `rgba(255, 255, 255, ${clear ? 0.04 : 0.18})`;
  return (
    `:host{backdrop-filter:${filter};-webkit-backdrop-filter:${filter};` +
    `background-color:${background}}`
  );
};

/**
 * The fallback's rims, as the WebGL glass draws them: a gray hairline on the
 * outermost pixel, which is all that outlines the glass over white, and a
 * bright rim inside it, lit from the top, which shows over dark content.
 */
export const FALLBACK_EDGES =
  'inset 0 0 0 1px rgba(0, 0, 0, 0.08), inset 0 2px 0 rgba(255, 255, 255, 0.5), ' +
  'inset 0 0 0 2px rgba(255, 255, 255, 0.25)';

// The shorter side, in px, of the smallest and the largest glass shadows: a
// 44pt bar button's, and a menu's or an action sheet's.
const SMALL_SHADOW_SIDE = 44;
const LARGE_SHADOW_SIDE = 160;

/**
 * The shadow under a glass shape the WebGL glass gives none (see
 * HostStyleState's `shadow`). UIKit's grows with the glass: faint under a
 * bar button, and wide and soft under a menu or an action sheet, where it's
 * 6% dark at the bottom edge and along the sides and fades out about 30pt
 * below. So it's scaled by the shape's shorter side, in tenths of the way
 * from one to the other, so a menu growing open rewrites its style a few
 * times rather than every frame. An element's own `overflow` doesn't clip
 * its box-shadow, so it shows around a menu panel that clips its content.
 */
export const glassShadow = (element: HTMLElement): string => {
  const side = Math.min(element.offsetWidth, element.offsetHeight);
  const reach =
    (side - SMALL_SHADOW_SIDE) / (LARGE_SHADOW_SIDE - SMALL_SHADOW_SIDE);
  const t = Math.round(Math.min(Math.max(reach, 0), 1) * 10) / 10;
  const mix = (small: number, large: number) =>
    Math.round((small + (large - small) * t) * 1000) / 1000;
  const shadow = `0 ${mix(2, 8)}px ${mix(10, 32)}px rgba(0, 0, 0, ${mix(0.06, 0.08)})`;
  // A large shape also sits on a tighter shadow where it meets the content.
  return t ? `${shadow}, 0 1px 4px rgba(0, 0, 0, ${mix(0, 0.04)})` : shadow;
};

/**
 * The UIKit blur material a non-glass `<blur-view>` gets on iOS, which
 * `blur-effect` picks (`light` by default). Besides blurring, each material
 * shifts what's behind it, while web-elements' `<x-blur-view>` only blurs. So
 * these approximate them, fitted to the iOS simulator's pixels in the
 * element-blur-view example: `light` brightens the backdrop by about a third,
 * `extra-light` washes it with white, and `dark` with black. Like on iOS, a
 * blur view with no blur radius shows no material. The `light` rule repeats
 * the blur because it replaces web-elements' own `backdrop-filter`.
 */
export const materialCss = (element: Element): string => {
  const effect = element.getAttribute('blur-effect') ?? 'light';
  const radius = parseFloat(element.getAttribute('blur-radius') ?? '');
  if (!radius || effect === 'glass' || effect === 'glass-container') {
    return '';
  }
  if (effect === 'extra-light') {
    return ':host{background-color:rgba(255, 255, 255, 0.75)}';
  }
  if (effect === 'dark') {
    return ':host{background-color:rgba(0, 0, 0, 0.6)}';
  }
  const filter = `blur(${radius}px) brightness(1.35)`;
  return `:host{backdrop-filter:${filter};-webkit-backdrop-filter:${filter}}`;
};

export const hostStyleCss = (
  element: HTMLElement,
  state: HostStyleState,
): string => {
  const shadows = [
    state.shadow ? glassShadow(element) : '',
    state.fallback ? FALLBACK_EDGES : '',
  ].filter(Boolean);
  return [
    materialCss(element),
    // A container's canvas reaches past its box, for the shadow and the
    // swell of its shapes (see glass-group.ts), and so do its shapes' CSS
    // shadows in the fallback. web-elements clips every `<x-blur-view>`, and
    // its rule comes from outside the shadow tree, so only an important
    // `:host` rule beats it. A container draws nothing but its shapes.
    element.getAttribute('blur-effect') === 'glass-container'
      ? ':host{overflow:visible!important}'
      : '',
    state.hostsCanvas ? ':host{isolation:isolate}' : '',
    state.rendered
      ? ':host{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'
      : '',
    state.fallback ? fallbackGlassCss(element) : '',
    shadows.length ? `:host{box-shadow:${shadows.join(', ')}}` : '',
    // The `scale` property rather than `transform`, which composes with a
    // transform the element has of its own, such as a popover arrow's turn.
    state.scale !== 1
      ? `:host{scale:${Math.round(state.scale * 1000) / 1000}}`
      : '',
  ].join('');
};

/**
 * Applies `state` through a `<style>` in the element's shadow root, written
 * only when it changes. The rules stay inside the element: Lynx owns its
 * `class` and `style` attributes, and an attribute of our own would show up in
 * the backdrop's mutation observer as a change to capture.
 */
export const applyHostStyle = (
  element: HTMLElement,
  state: HostStyleState,
): void => {
  const root = element.shadowRoot;
  if (!root) return;
  const css = hostStyleCss(element, state);
  let style = styles.get(element);
  if (!style) {
    if (!css) return;
    style = element.ownerDocument.createElement('style');
    styles.set(element, style);
  }
  // Appended (again) last, so it follows web-elements' own dynamic style.
  if (style.parentNode !== root) root.appendChild(style);
  if (style.textContent !== css) style.textContent = css;
};

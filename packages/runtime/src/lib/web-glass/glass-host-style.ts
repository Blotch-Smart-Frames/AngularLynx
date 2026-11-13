/** How a `<blur-view>` on web is styled while the glass code looks after it. */
export type HostStyleState = {
  /** It's a glass shape that WebGL isn't drawing (yet): show frosted CSS. */
  fallback: boolean;
  /** WebGL draws this shape, so web-elements' own backdrop blur must go. */
  rendered: boolean;
  /** It holds a group's canvas, which must stack under its children. */
  hostsCanvas: boolean;
  /**
   * Its CSS draws what falls outside it, the shadow and the lines at its
   * edge: a lone glass shape, whose canvas is its own box, and any glass
   * shape in the fallback. A container draws its shapes' on its canvas.
   */
  shadow: boolean;
  /** How much it's drawn scaled: above 1 while a pressed shape swells. */
  scale: number;
  /** How far it's pressed, from 0 to 1: a pressed shape washes out. */
  press: number;
  /** It draws the dark material. */
  dark: boolean;
  /** How bright what's behind the glass is, from 0 to 1. */
  luminance: number;
};

const styles = new WeakMap<Element, HTMLStyleElement>();

// How white a fully pressed shape turns, glass and content alike: UIKit lays
// the light of a touch over both, so a black label reads gray meanwhile.
// It's fainter over the dark material.
const PRESS_WASH = 0.4;
const DARK_PRESS_WASH = 0.25;

const DEFAULT_FALLBACK_BLUR = 12;

const isClear = (element: Element) =>
  element.getAttribute('glass-style') === 'clear';

/**
 * The frosted look a glass shape has before WebGL takes over, or without it:
 * a backdrop blur under a wash, which is roughly what each material does to
 * a color (see glass-shaders.ts). The light regular material lifts it half
 * way to white, the dark one pulls it toward a dark gray, and clear glass
 * barely changes it. Author styles on the element itself still win, since a
 * `:host` rule loses to them, so a background set in the template is kept.
 * Its bright rim is in FALLBACK_EDGES, since the shadow shares its
 * `box-shadow`.
 */
export const fallbackGlassCss = (element: Element, dark = false): string => {
  const clear = isClear(element);
  const radius =
    parseFloat(element.getAttribute('blur-radius') ?? '') ||
    (clear ? DEFAULT_FALLBACK_BLUR / 3 : DEFAULT_FALLBACK_BLUR);
  const saturation = clear ? 112 : dark ? 140 : 190;
  const filter = `blur(${radius}px) saturate(${saturation}%)`;
  const wash = clear
    ? 'rgba(255, 255, 255, 0.1)'
    : dark
      ? 'rgba(52, 52, 52, 0.4)'
      : 'rgba(250, 250, 250, 0.53)';
  const background = element.getAttribute('glass-tint-color') || wash;
  return (
    `:host{backdrop-filter:${filter};-webkit-backdrop-filter:${filter};` +
    `background-color:${background}}`
  );
};

/**
 * The fallback's rim, as the WebGL glass draws it: a bright line along the
 * top and the bottom, two thirds of a pixel wide.
 */
export const FALLBACK_EDGES =
  'inset 0 0.67px 0 rgba(255, 255, 255, 0.35), ' +
  'inset 0 -0.67px 0 rgba(255, 255, 255, 0.35)';

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The lines UIKit's glass has just outside its shape (see glass-shaders.ts,
 * which draws the same for a container's shapes): a dark one down the sides,
 * two thirds of a pixel wide where the edge is upright and gone by 60 degrees
 * from it, and, on the light regular material, a fainter one along the top
 * and the bottom. A tint fills the whole band with its color instead.
 *
 * A shadow with no blur draws each line: the shape moved by twice the line's
 * width and shrunk by the width shows as a crescent that thins out the same
 * way. The lines are darker over a dark backdrop.
 */
export const glassEdges = (
  element: Element,
  dark: boolean,
  luminance: number,
): string => {
  const side = `rgba(0, 0, 0, ${round(0.67 - 0.44 * luminance)})`;
  const lines = [`1.33px 0 0 -0.67px ${side}`, `-1.33px 0 0 -0.67px ${side}`];
  if (!dark && !isClear(element)) {
    const tint = element.getAttribute('glass-tint-color');
    if (tint) {
      lines.push(`0 0 0 0.67px color-mix(in srgb, ${tint} 80%, transparent)`);
    } else {
      const end = `rgba(0, 0, 0, ${round(0.215 - 0.14 * luminance)})`;
      lines.push(`0 1.33px 0 -0.67px ${end}`, `0 -1.33px 0 -0.67px ${end}`);
    }
  }
  return lines.join(', ');
};

// The shorter side, in px, up to which glass casts a control's shadow, and
// from which it casts a panel's.
const SMALL_SHADOW_SIDE = 60;
const LARGE_SHADOW_SIDE = 150;

/**
 * The shadow under a glass shape the WebGL glass gives none (see
 * HostStyleState's `shadow`). UIKit's grows with the glass: under a control
 * it's barely there, 1% dark and only below it, and under a menu or an
 * action sheet it's wide and soft, 10% dark, more under the dark material.
 * Clear glass has none. So it's scaled by the shape's shorter side, in
 * tenths of the way from one to the other, so a menu growing open rewrites
 * its style a few times rather than every frame. An element's own `overflow`
 * doesn't clip its box-shadow, so it shows around a menu panel that clips
 * its content.
 */
export const glassShadow = (element: HTMLElement, dark = false): string => {
  if (isClear(element)) return '';
  const side = Math.min(element.offsetWidth, element.offsetHeight);
  const reach =
    (side - SMALL_SHADOW_SIDE) / (LARGE_SHADOW_SIDE - SMALL_SHADOW_SIDE);
  const t = Math.round(Math.min(Math.max(reach, 0), 1) * 10) / 10;
  const mix = (small: number, large: number) =>
    round(small + (large - small) * t);
  const strength = mix(0.013, 0.105) * (dark ? 1 + 0.45 * t : 1);
  return `0 ${mix(7, 10)}px ${mix(6, 34)}px rgba(0, 0, 0, ${round(strength)})`;
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
  // The first in the list is drawn on top: the lines, then the shadow.
  const shadows = [
    state.shadow ? glassEdges(element, state.dark, state.luminance) : '',
    state.shadow ? glassShadow(element, state.dark) : '',
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
    state.fallback ? fallbackGlassCss(element, state.dark) : '',
    shadows.length ? `:host{box-shadow:${shadows.join(', ')}}` : '',
    // The `scale` property rather than `transform`, which composes with a
    // transform the element has of its own, such as a popover arrow's turn.
    state.scale !== 1
      ? `:host{scale:${Math.round(state.scale * 1000) / 1000}}`
      : '',
    // Over the content, which the canvas is under: a pseudo-element of the
    // host is drawn after everything in it.
    state.press > 0
      ? ':host::after{content:"";position:absolute;inset:0;' +
        'border-radius:inherit;pointer-events:none;background:#fff;' +
        `opacity:${round(state.press * (state.dark ? DARK_PRESS_WASH : PRESS_WASH))}}`
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

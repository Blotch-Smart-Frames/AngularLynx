/** How a `<blur-view>` on web is styled while the glass code looks after it. */
export type HostStyleState = {
  /** It's a glass shape that WebGL isn't drawing (yet): show frosted CSS. */
  fallback: boolean;
  /** WebGL draws this shape, so web-elements' own backdrop blur must go. */
  rendered: boolean;
  /** It holds a group's canvas, which must stack under its children. */
  hostsCanvas: boolean;
};

const styles = new WeakMap<Element, HTMLStyleElement>();

const DEFAULT_FALLBACK_BLUR = 12;

/**
 * The frosted look a glass shape has before WebGL takes over, or without it:
 * a backdrop blur with a bright inner rim, roughly the pre-iOS-26 material.
 * Author styles on the element itself still win, since a `:host` rule loses to
 * them, so a background set in the template is kept.
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
    `background-color:${background};box-shadow:inset 0 1px 0 ` +
    `rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.25)}`
  );
};

export const hostStyleCss = (element: Element, state: HostStyleState): string =>
  [
    state.hostsCanvas ? ':host{isolation:isolate}' : '',
    state.rendered
      ? ':host{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'
      : '',
    state.fallback ? fallbackGlassCss(element) : '',
  ].join('');

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

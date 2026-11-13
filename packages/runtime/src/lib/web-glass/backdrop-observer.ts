/**
 * Calls `onChange` whenever what's behind the glass may look different:
 * something in `backdrop` mutates, resizes, scrolls or loads, a transition or
 * an animation in it ends, web fonts finish loading, or the color scheme
 * flips. Changes `inFront` answers true for don't count: the glass itself (a
 * blob dragged by its left/top) and what's drawn above it, which change
 * nothing behind it. Returns a function that stops observing.
 */
export const observeBackdrop = (
  backdrop: HTMLElement,
  inFront: (node: Node) => boolean,
  onChange: () => void,
): (() => void) => {
  const win = backdrop.ownerDocument.defaultView!;
  const mutations = new win.MutationObserver((records) => {
    if (records.some((record) => !inFront(record.target))) onChange();
  });
  mutations.observe(backdrop, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const resizes = new win.ResizeObserver(onChange);
  resizes.observe(backdrop);
  const onEvent = (event: Event) => {
    if (!inFront(event.target as Node)) onChange();
  };
  // Scroll and image load events don't bubble, but they do reach a capturing
  // listener on an ancestor. A transition or an animation ending leaves the
  // page as it'll stay, where the last picture may have caught it half way:
  // a dimming layer fading in under a sheet.
  const events = ['scroll', 'load', 'transitionend', 'animationend'];
  for (const type of events) backdrop.addEventListener(type, onEvent, true);
  const scheme = win.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', onChange);
  // Text reflows once web fonts load, moving what's behind the glass.
  void backdrop.ownerDocument.fonts.ready.then(onChange);
  return () => {
    mutations.disconnect();
    resizes.disconnect();
    for (const type of events) {
      backdrop.removeEventListener(type, onEvent, true);
    }
    scheme.removeEventListener('change', onChange);
  };
};

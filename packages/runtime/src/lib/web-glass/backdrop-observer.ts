/**
 * Calls `onChange` whenever what's behind the glass may look different:
 * something in `backdrop` mutates, resizes, scrolls or loads, web fonts
 * finish loading, or the color scheme flips. Changes inside `glass` itself (a
 * blob dragged by its left/top) don't count, since they don't change what's
 * behind it. Returns a function that stops observing.
 */
export const observeBackdrop = (
  backdrop: HTMLElement,
  glass: Element,
  onChange: () => void,
): (() => void) => {
  const win = backdrop.ownerDocument.defaultView!;
  const mutations = new win.MutationObserver((records) => {
    if (records.some((record) => !glass.contains(record.target))) onChange();
  });
  mutations.observe(backdrop, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const resizes = new win.ResizeObserver(onChange);
  resizes.observe(backdrop);
  // Scroll and image load events don't bubble, but they do reach a capturing
  // listener on an ancestor.
  backdrop.addEventListener('scroll', onChange, true);
  backdrop.addEventListener('load', onChange, true);
  const scheme = win.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', onChange);
  // Text reflows once web fonts load, moving what's behind the glass.
  void backdrop.ownerDocument.fonts.ready.then(onChange);
  return () => {
    mutations.disconnect();
    resizes.disconnect();
    backdrop.removeEventListener('scroll', onChange, true);
    backdrop.removeEventListener('load', onChange, true);
    scheme.removeEventListener('change', onChange);
  };
};

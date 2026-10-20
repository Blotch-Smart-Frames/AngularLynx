import type { ElementRef } from '../../types/lynx';

/**
 * Native backdrop blur (Lynx 4.0+). Blurs whatever is rendered BEHIND the
 * element, like CSS `backdrop-filter: blur()`, which Lynx doesn't support as a
 * style. On iOS 26+ `blur-effect="glass"` renders Apple's Liquid Glass
 * material. It must be a real `blur-view`: the unknown-tag view fallback would
 * silently ignore every blur attribute and render a plain view with no blur.
 *
 * Lynx for Web's `blur-view` only implements `blur-radius`, so on web the
 * glass effects are drawn by `attachWebGlass`.
 */
export const createBlurViewElement = (pageId: number): ElementRef => {
  const element = __CreateElement('blur-view', pageId);
  // `__WEB__` is a compile-time define: on native the bundler drops this
  // branch before it follows the import, so none of the WebGL code ships
  // there. A static import wouldn't do: the minifier can't prove the glass
  // classes side-effect free once they're compiled for the main thread, so it
  // would keep them. On web the build inlines the import, and the glass
  // attaches a microtask after the element is created, before it's on screen.
  // Only the main thread draws; web's background thread never gets here with
  // a real element, but `__MAIN_THREAD__` keeps it from loading the module.
  if (__WEB__ && __MAIN_THREAD__) {
    import('../../web-glass/web-glass')
      .then(({ attachWebGlass }) => attachWebGlass(element))
      .catch(() => {
        // Glass is decoration: without its module the blur fallback stays.
      });
  }
  return element;
};

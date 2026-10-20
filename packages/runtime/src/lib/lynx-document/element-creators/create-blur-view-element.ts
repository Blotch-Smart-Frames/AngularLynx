import type { ElementRef } from '../../types/lynx';
import {
  ANDROID_BLUR_CAPTURE_TARGET,
  isAndroid,
} from '../android-blur-capture';

/**
 * Native backdrop blur (Lynx 4.0+). Blurs whatever is rendered BEHIND the
 * element, like CSS `backdrop-filter: blur()`, which Lynx doesn't support as a
 * style. On iOS 26+ `blur-effect="glass"` renders Apple's Liquid Glass
 * material. It must be a real `blur-view`: the unknown-tag view fallback would
 * silently ignore every blur attribute and render a plain view with no blur.
 *
 * Lynx for Web's `blur-view` only implements `blur-radius` and doesn't lay its
 * children out like a view, so on web `attachWebGlass` adds both.
 *
 * On Android it blurs the page (see ANDROID_BLUR_CAPTURE_TARGET), so a
 * blur-view inside another one still shows its backdrop. An app's own
 * `android-capture-target` replaces this, and an empty one restores Android's
 * own choice.
 */
export const createBlurViewElement = (pageId: number): ElementRef => {
  const element = __CreateElement('blur-view', pageId);
  if (!__WEB__ && isAndroid()) {
    __SetAttribute(
      element,
      'android-capture-target',
      ANDROID_BLUR_CAPTURE_TARGET,
    );
  }
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

import type { LynxViewElement } from '@lynx-js/web-core/client';

/**
 * The size of the LynxView in an app built with `ng build --platform ios` on
 * the iPhone 17 Pro and 18 Pro, Xcode's default simulators: the 402×874pt
 * screen minus the 62pt status bar and 34pt home indicator, since the app
 * keeps its LynxView inside the safe area. Lynx for Web lays the example out
 * at this size and scales it to the preview pane, so it wraps, centers and
 * scrolls exactly as on the phone instead of reflowing to the pane's width.
 */
export const DEVICE_WIDTH = 402;
export const DEVICE_HEIGHT = 778;

/**
 * Lynx's default font: the system font on iOS (and Roboto on Android, which
 * `system-ui` picks there). Without it, text inside `<lynx-view>` inherits the
 * docs site's Inter, or Times in a bare page.
 */
const SYSTEM_FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Where Lynx for Web's defaults differ from Lynx on iOS. Inserted into every
 * `<lynx-view>`'s shadow root, ahead of the example's own styles, so the
 * example can still override any of them.
 */
const NATIVE_PARITY_RULES = [
  // On native Lynx `rem` is relative to a 14px root font size, which is also
  // the default font size of text. web-core leaves `rem` alone unless
  // `transformREM` is on, so it resolved against the docs page's 16px and
  // every Tailwind size (`h-11`, `p-4`, `text-base`) came out a seventh
  // larger than on the phone. `--rem-unit` is what `transformREM` rewrites
  // `rem` to.
  `:host { --rem-unit: 14px; font-size: 14px; font-family: ${SYSTEM_FONT}; }`,
  // web-elements forwards the host's box to the inner <textarea> (through the
  // <form> around it) without `box-sizing` or `border-radius`, unlike its
  // <input>: a textarea drew square corners and grew by its padding and border.
  'x-textarea::part(form), x-textarea::part(textarea) { box-sizing: inherit; border-radius: inherit; }',
  // UIKit's placeholder color (`placeholderText`, rgb(196, 198, 196) on white)
  // instead of web-elements' much darker #808080. A `placeholder-color` set by
  // the example still wins: web-elements sets it inline on the same part.
  'x-input::part(input), x-textarea::part(textarea) { --placeholder-color: rgba(60, 60, 67, 0.3); }',
  // An overlay opens in place instead of in the top layer (see
  // `containOverlays`), so it needs a z-index to stay above the page as on
  // native: web-elements makes every element `position: relative`, which
  // otherwise paints the page's later elements over it. A z-index on the
  // `<overlay>` itself does nothing, since web-elements gives it
  // `display: contents`.
  'x-overlay-ng::part(dialog) { z-index: 2147483647; }',
];

const configured = new WeakSet<HTMLElement>();

/**
 * Whether `node` is in a `<lynx-view>`'s shadow tree. An `<overlay>`'s dialog
 * is a level deeper, in its `x-overlay-ng`'s own shadow root.
 */
const isInLynxView = (node: Node): boolean => {
  for (
    let root = node.getRootNode();
    root instanceof ShadowRoot;
    root = root.host.getRootNode()
  ) {
    if (root.host.localName === 'lynx-view') return true;
  }
  return false;
};

/**
 * Keeps each `<overlay>` (sheets, dialogs, selects) inside its preview, as it
 * stays inside the phone's screen on native. web-elements opens an overlay's
 * `<dialog>` with `showModal()`, which lifts it into the browser's top layer:
 * it covered the whole docs page, unscaled, and left the rest of the page
 * inert until it closed. `show()` opens it in place instead, where the
 * `position: fixed` web-elements gives it resolves against the `<lynx-view>`
 * (its `contain: strict` makes it the containing block), so the overlay
 * scales and clips with the preview.
 */
const containOverlays = (): void => {
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    if (isInLynxView(this)) this.show();
    else showModal.call(this);
  };
};

/**
 * Makes every `<lynx-view>` on the site render like Lynx on an iPhone.
 *
 * `<Go>` creates the `<lynx-view>` itself, with no way to pass it attributes,
 * so this registers `<lynx-view>` as a subclass of web-core's element that
 * configures each view as it connects, before it fetches its bundle, which is
 * when web-core reads `transformREM` and `injectStyleRules`. A browser reads
 * an element's lifecycle callbacks when it's defined, so the subclass has to
 * be what web-core defines: this wraps `customElements.define` until then.
 * It runs when the docs app starts, and `<Go>` imports web-core only once a
 * preview mounts.
 */
export const applyNativeParity = (): void => {
  // Static site generation renders `<Go>` without a DOM.
  if (typeof customElements === 'undefined') return;
  if (customElements.get('lynx-view')) return;
  containOverlays();
  const define = customElements.define;
  customElements.define = function (name, constructor, options) {
    if (name !== 'lynx-view') {
      define.call(this, name, constructor, options);
      return;
    }
    customElements.define = define;
    const LynxView = constructor as unknown as {
      new (): LynxViewElement & { connectedCallback(): void };
    };
    class NativeParityLynxView extends LynxView {
      connectedCallback(): void {
        // React moves a view by reconnecting it; configure it only once.
        if (!configured.has(this)) {
          configured.add(this);
          this.transformREM = true;
          this.injectStyleRules = [
            ...NATIVE_PARITY_RULES,
            ...(this.injectStyleRules ?? []),
          ];
        }
        super.connectedCallback();
      }
    }
    define.call(this, name, NativeParityLynxView, options);
  };
};

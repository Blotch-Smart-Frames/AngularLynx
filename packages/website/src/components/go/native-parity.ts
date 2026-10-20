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
 * `target`, with the given properties replaced, for code that only reads
 * them. Its other properties and methods still come from `target`, since DOM
 * getters and methods throw when called on anything else.
 */
const withValues = <T extends object>(
  target: T,
  values: Record<string, unknown>,
): T =>
  new Proxy(target, {
    get(object, key) {
      if (typeof key === 'string' && Object.hasOwn(values, key)) {
        return values[key];
      }
      const value: unknown = Reflect.get(object, key, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });

/**
 * `event` with its positions and sizes in the view's own pixels rather than
 * the screen's, undoing the scale `<Go>` draws the view at. A point keeps its
 * place relative to the view's top-left corner, which web-core subtracts (its
 * `lynxViewClientLeft`/`Top`) to give `x`/`y` and `layoutchange` positions
 * relative to the view.
 */
const toViewSpace = (view: HTMLElement, event: Event): Event => {
  // A transform leaves `offsetWidth` alone, so this is the drawn scale.
  const box = view.getBoundingClientRect();
  const scale = box.width / view.offsetWidth;
  if (!(scale > 0) || Math.abs(scale - 1) < 0.001) return event;
  const x = (clientX: number) => box.left + (clientX - box.left) / scale;
  const y = (clientY: number) => box.top + (clientY - box.top) / scale;
  const point = (from: MouseEvent | Touch) => {
    const clientX = x(from.clientX);
    const clientY = y(from.clientY);
    return {
      clientX,
      clientY,
      // `pageX` is `clientX` plus the page's scroll offset.
      pageX: from.pageX + clientX - from.clientX,
      pageY: from.pageY + clientY - from.clientY,
    };
  };
  if (event instanceof MouseEvent) return withValues(event, point(event));
  // Desktop Firefox and Safari have no TouchEvent.
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touches = (list: TouchList) =>
      Array.from(list, (touch) => withValues(touch, point(touch)));
    return withValues(event, {
      touches: touches(event.touches),
      targetTouches: touches(event.targetTouches),
      changedTouches: touches(event.changedTouches),
    });
  }
  // web-elements fills `layoutchange` from `getBoundingClientRect()`.
  if (event.type === 'layoutchange' && event instanceof CustomEvent) {
    const { left, right, top, bottom, width, height } = event.detail;
    return withValues(event, {
      detail: {
        ...event.detail,
        left: x(left),
        right: x(right),
        top: y(top),
        bottom: y(bottom),
        width: width / scale,
        height: height / scale,
      },
    });
  }
  return event;
};

/**
 * Gives events to the app in the phone's pixels. `<Go>` lays the view out at
 * the phone's size and scales it down to fit its pane, so the browser reports
 * pointer positions and element boxes 0.68 of their size at the default
 * split, and web-core passes them on as they are: the blur-view playground's
 * glass followed the mouse at 0.68 of its speed, and its `layoutchange` gave
 * a stage 0.68 of its size, confining the glass to the stage's top-left.
 *
 * web-core handles every event its elements bind with listeners on the view's
 * shadow root, so this wraps those listeners. web-elements and the rest of the
 * page still get the browser's own event: web-elements pairs some pointer
 * positions with `elementFromPoint()`, which takes the screen's.
 */
const listenInViewSpace = (view: HTMLElement, root: ShadowRoot): void => {
  const wrappers = new WeakMap<
    EventListenerOrEventListenerObject,
    EventListener
  >();
  const add = root.addEventListener;
  const remove = root.removeEventListener;
  root.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    // A null listener is a no-op for the DOM too.
    if (!listener) return;
    let wrapper = wrappers.get(listener);
    if (!wrapper) {
      wrapper = (event) => {
        const viewEvent = toViewSpace(view, event);
        if (typeof listener === 'function') listener.call(root, viewEvent);
        else listener.handleEvent(viewEvent);
      };
      wrappers.set(listener, wrapper);
    }
    add.call(this, type, wrapper, options);
  };
  root.removeEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (!listener) return;
    remove.call(this, type, wrappers.get(listener) ?? listener, options);
  };
};

/**
 * Makes every `<lynx-view>` on the site render like Lynx on an iPhone.
 *
 * `<Go>` creates the `<lynx-view>` itself, with no way to pass it attributes,
 * so this registers `<lynx-view>` as a subclass of web-core's element that
 * configures each view as it connects, before it fetches its bundle, which is
 * when web-core reads `transformREM` and `injectStyleRules`, and that hands
 * web-core its events in the phone's pixels (see `listenInViewSpace`). A
 * browser reads an element's lifecycle callbacks when it's defined, so the
 * subclass has to be what web-core defines: this wraps `customElements.define`
 * until then.
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
      override connectedCallback(): void {
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

      /**
       * web-core attaches the shadow root when it first renders the view, and
       * reuses it when the view reloads.
       */
      override attachShadow(init: ShadowRootInit): ShadowRoot {
        const root = super.attachShadow(init);
        listenInViewSpace(this, root);
        return root;
      }
    }
    define.call(this, name, NativeParityLynxView, options);
  };
};

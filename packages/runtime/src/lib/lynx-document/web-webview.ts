import type { ElementRef } from '../types/lynx';

/** The custom element web-elements draws a `<webview>` as. */
const WEB_VIEW_TAG = 'x-webview';

/**
 * An `<iframe>` in a browser that knows the `credentialless` attribute, which
 * TypeScript's DOM types leave out while it's Chromium's alone.
 */
type CredentiallessFrame = HTMLIFrameElement & { credentialless: boolean };

/**
 * The frame inside a `<webview>`'s shadow root, marked `credentialless`, or
 * undefined where there's no frame yet or the browser doesn't know the
 * attribute.
 */
const markFrame = (
  host: Partial<HTMLElement>,
): CredentiallessFrame | undefined => {
  const frame = host.shadowRoot?.querySelector('iframe');
  if (!frame || !('credentialless' in frame)) return undefined;
  (frame as CredentiallessFrame).credentialless = true;
  return frame as CredentiallessFrame;
};

/**
 * Lets a `<webview>` on Lynx for Web load its page when the page around it is
 * cross-origin isolated, as `ng serve`'s web preview is (it needs
 * `SharedArrayBuffer`).
 *
 * web-elements draws a `<webview>` as an `<x-webview>` around an `<iframe>`.
 * In an isolated page the browser loads a frame only if the frame's own
 * response opts in, with `Cross-Origin-Embedder-Policy` and, from another
 * origin, `Cross-Origin-Resource-Policy`. Almost no site sends those, so the
 * frame showed the browser's "refused to connect" page while `bindload`
 * still fired, and a `<webview>` that works on the phone looked broken.
 *
 * A frame with the `credentialless` attribute is exempt: the browser loads
 * its page with cookies and storage of its own, apart from the ones the site
 * has in the browser, and discards them when the page around the frame goes.
 * So a site's login doesn't carry into the frame there, which a page that
 * can't load at all doesn't have either. Chromium 110 and newer know the
 * attribute; other browsers block the frame as before, and are left alone.
 *
 * A page that isn't isolated (the docs site's previews, most deployed apps)
 * loads frames as usual, so its frame is left alone and keeps its cookies.
 *
 * web-elements attaches the shadow root, frame included, in the element's
 * constructor, and passes `src` on to the frame in a microtask (and `html`,
 * as the frame's `srcdoc`), so a frame marked here is marked before it first
 * loads. But web-core loads an
 * element's definition the first time one is created, and the element can
 * come first: it's then a plain element with no frame until the definition
 * arrives (the order is the network's to decide; both were seen). That frame
 * is marked once it exists, and its load started again if it had begun.
 */
export const loadWebViewInIsolatedPage = (element: ElementRef): void => {
  const host = element as Partial<HTMLElement>;
  // The page that will hold the frame: web-core creates the element in the
  // page's document, though Angular runs in a hidden iframe of its own.
  const page = host.ownerDocument?.defaultView;
  if (!page?.crossOriginIsolated) return;
  if (host.shadowRoot) {
    markFrame(host);
    return;
  }
  void page.customElements.whenDefined(WEB_VIEW_TAG).then(() => {
    // Defining an element upgrades the ones in the document. One that isn't
    // in it yet waits until it is, so it's upgraded here to get its frame.
    page.customElements.upgrade(host as HTMLElement);
    const frame = markFrame(host);
    if (!frame) return;
    // The frame got its `src` before this ran (in Chromium the definition's
    // own microtasks run first), so its page is loading without the
    // attribute. Setting `src` again doesn't help: Chromium ignores a load
    // of the URL it's already loading. Taking the frame out of the page
    // ends that load, and putting it back starts one that reads the
    // attribute. The frame is the same element, so web-elements' listeners
    // stay on it, and the load that was ended fires no event.
    //
    // The same goes for `html`, the frame's `srcdoc`. Its own page loads
    // either way, but a frame inside that page is blocked like any other
    // unless the page was loaded credentialless, which it passes down.
    if (!frame.hasAttribute('src') && !frame.hasAttribute('srcdoc')) return;
    // Found inside the shadow root, so it has a parent.
    const parent = frame.parentNode as Node;
    const next = frame.nextSibling;
    frame.remove();
    parent.insertBefore(frame, next);
  });
};

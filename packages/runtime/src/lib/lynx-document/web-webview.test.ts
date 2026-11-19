// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { loadWebViewInIsolatedPage } from './web-webview';

type Page = Window & typeof globalThis;

/**
 * A page of its own: a window with its own custom element registry, so each
 * test decides whether and when `x-webview` is defined. `isolated` is what
 * the browser says of it, or undefined where it says nothing (jsdom).
 */
const newPage = (
  isolated: boolean | undefined,
  { credentialless = true } = {},
): Page => {
  const holder = document.createElement('iframe');
  document.body.append(holder);
  const page = holder.contentWindow as Page;
  if (isolated !== undefined) {
    Object.defineProperty(page, 'crossOriginIsolated', { value: isolated });
  }
  if (credentialless) {
    // Chromium's property, which reflects the attribute. jsdom has neither.
    Object.defineProperty(page.HTMLIFrameElement.prototype, 'credentialless', {
      get(this: HTMLIFrameElement) {
        return this.hasAttribute('credentialless');
      },
      set(this: HTMLIFrameElement, value: boolean) {
        this.toggleAttribute('credentialless', value);
      },
    });
  }
  return page;
};

/**
 * What the frame was given, in order: `src` or `srcdoc`, with whether it
 * was credentialless by then.
 */
type FrameLog = string[];

/**
 * Defines `x-webview` the way web-elements does: the shadow root and its
 * frame in the constructor, and `src` passed on to the frame in a microtask
 * (and `html`, as the frame's `srcdoc`), or at once with
 * `passSrc: 'at once'`, which stands in for a batch of web-elements'
 * microtasks that was queued before the definition arrived.
 */
const defineXWebView = (
  page: Page,
  log: FrameLog = [],
  {
    passSrc = 'in a microtask' as 'in a microtask' | 'at once',
    frame = true,
  } = {},
): FrameLog => {
  class XWebView extends page.HTMLElement {
    static observedAttributes = ['src', 'html'];

    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = frame
        ? '<iframe id="webview" part="webview"></iframe>'
        : '';
    }

    attributeChangedCallback(name: string, _old: string, value: string) {
      const inner = this.shadowRoot!.querySelector('iframe')!;
      const attribute = name === 'html' ? 'srcdoc' : 'src';
      const pass = () => {
        log.push(
          `${attribute} ${value}, credentialless ${inner.hasAttribute('credentialless')}`,
        );
        inner.setAttribute(attribute, value);
      };
      if (passSrc === 'at once') pass();
      else queueMicrotask(pass);
    }
  }
  page.customElements.define('x-webview', XWebView);
  return log;
};

/**
 * Lets the definition's and the runtime's microtasks run.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

const frameOf = (host: HTMLElement) => host.shadowRoot?.querySelector('iframe');

const load = (host: HTMLElement) =>
  loadWebViewInIsolatedPage(host as unknown as ElementRef);

afterEach(() => {
  document.body.replaceChildren();
});

describe('loadWebViewInIsolatedPage', () => {
  it('marks the frame credentialless in a cross-origin isolated page', () => {
    const page = newPage(true);
    defineXWebView(page);
    const host = page.document.createElement('x-webview');

    load(host);

    expect(frameOf(host)?.hasAttribute('credentialless')).toBe(true);
    // Lynx owns the element's own attributes.
    expect(host.getAttributeNames()).toEqual([]);
  });

  it('marks the frame before it gets its src', async () => {
    const page = newPage(true);
    const log = defineXWebView(page);
    const host = page.document.createElement('x-webview');

    load(host);
    host.setAttribute('src', 'https://angular.dev');
    await settle();

    expect(log).toEqual(['src https://angular.dev, credentialless true']);
  });

  it('marks the frame before it gets its html', async () => {
    const page = newPage(true);
    const log = defineXWebView(page);
    const host = page.document.createElement('x-webview');

    load(host);
    host.setAttribute('html', '<p>Inline</p>');
    await settle();

    expect(log).toEqual(['srcdoc <p>Inline</p>, credentialless true']);
  });

  it("leaves the frame its cookies in a page that isn't isolated", () => {
    const page = newPage(false);
    defineXWebView(page);
    const host = page.document.createElement('x-webview');

    load(host);

    expect(frameOf(host)?.hasAttribute('credentialless')).toBe(false);
  });

  it("leaves the frame alone where the browser doesn't say", () => {
    const page = newPage(undefined);
    defineXWebView(page);
    const host = page.document.createElement('x-webview');

    load(host);

    expect(frameOf(host)?.hasAttribute('credentialless')).toBe(false);
  });

  it("leaves the frame alone in a browser that doesn't know the attribute", () => {
    const page = newPage(true, { credentialless: false });
    defineXWebView(page);
    const host = page.document.createElement('x-webview');

    load(host);

    expect(frameOf(host)?.getAttributeNames()).toEqual(['id', 'part']);
  });

  it('leaves a shadow root without a frame alone', () => {
    const page = newPage(true);
    defineXWebView(page, [], { frame: false });
    const host = page.document.createElement('x-webview');

    expect(() => load(host)).not.toThrow();
    expect(host.shadowRoot?.childNodes).toHaveLength(0);
  });

  it('leaves something that is no element alone', () => {
    expect(() =>
      loadWebViewInIsolatedPage({} as unknown as ElementRef),
    ).not.toThrow();
  });

  describe('for an element created before its definition loaded', () => {
    it('marks the frame once the definition gives it one, before its src', async () => {
      const page = newPage(true);
      const host = page.document.createElement('x-webview');
      host.setAttribute('src', 'https://angular.dev');
      page.document.body.append(host);

      load(host);
      expect(host.shadowRoot).toBeNull();
      const log = defineXWebView(page);
      await settle();

      expect(frameOf(host)?.hasAttribute('credentialless')).toBe(true);
      expect(log).toEqual(['src https://angular.dev, credentialless true']);
    });

    it("upgrades one that isn't in the document yet, to mark its frame", async () => {
      const page = newPage(true);
      const host = page.document.createElement('x-webview');
      host.setAttribute('src', 'https://angular.dev');

      load(host);
      const log = defineXWebView(page);
      await settle();

      expect(frameOf(host)?.hasAttribute('credentialless')).toBe(true);
      expect(log).toEqual(['src https://angular.dev, credentialless true']);
    });

    // A page given as `html` loads either way, but only one loaded
    // credentialless lets the frames inside it load, so it starts again too.
    it.each([
      ['src', 'src', 'https://angular.dev'],
      ['html', 'srcdoc', '<iframe src="https://angular.dev"></iframe>'],
    ])(
      'starts the load again when the frame got its %s first',
      async (attribute, onFrame, value) => {
        const page = newPage(true);
        const host = page.document.createElement('x-webview');
        host.setAttribute(attribute, value);
        page.document.body.append(host);

        load(host);
        const log = defineXWebView(page, [], { passSrc: 'at once' });
        const frame = frameOf(host)!;
        const style = page.document.createElement('style');
        host.shadowRoot!.append(style);
        // What happened to the frame, with whether it was credentialless by
        // then: a browser starts a frame's load when it's put in the page.
        const moves: string[] = [];
        new page.MutationObserver((records) => {
          for (const record of records) {
            if ([...record.removedNodes].includes(frame)) moves.push('out');
            if ([...record.addedNodes].includes(frame)) {
              moves.push(
                `back, credentialless ${frame.hasAttribute('credentialless')}`,
              );
            }
          }
        }).observe(host.shadowRoot!, { childList: true });
        await settle();

        // The definition passed it on before the frame was marked.
        expect(log).toEqual([`${onFrame} ${value}, credentialless false`]);
        expect(moves).toEqual(['out', 'back, credentialless true']);
        // The same frame, where it was, with what it had.
        expect(frameOf(host)).toBe(frame);
        expect(frame.nextSibling).toBe(style);
        expect(frame.getAttribute(onFrame)).toBe(value);
      },
    );

    it('leaves a frame with no src or html, which has no load to start again, in place', async () => {
      const page = newPage(true);
      const host = page.document.createElement('x-webview');
      page.document.body.append(host);

      load(host);
      defineXWebView(page);
      let moved = false;
      new page.MutationObserver(() => {
        moved = true;
      }).observe(host.shadowRoot!, { childList: true });
      await settle();

      expect(frameOf(host)?.hasAttribute('credentialless')).toBe(true);
      expect(moved).toBe(false);
    });

    it("leaves the frame alone in a browser that doesn't know the attribute", async () => {
      const page = newPage(true, { credentialless: false });
      const host = page.document.createElement('x-webview');
      host.setAttribute('src', 'https://angular.dev');
      page.document.body.append(host);

      load(host);
      defineXWebView(page);
      let moved = false;
      new page.MutationObserver(() => {
        moved = true;
      }).observe(host.shadowRoot!, { childList: true });
      await settle();

      expect(frameOf(host)?.hasAttribute('credentialless')).toBe(false);
      expect(moved).toBe(false);
    });

    it("waits for nothing in a page that isn't isolated", async () => {
      const page = newPage(false);
      const host = page.document.createElement('x-webview');
      page.document.body.append(host);

      load(host);
      defineXWebView(page);
      await settle();

      expect(frameOf(host)?.hasAttribute('credentialless')).toBe(false);
    });
  });
});

import { LynxElement } from '../lynx-element';
import { LynxDocument, type LynxDocumentBase } from '../lynx-document';
import { globalEvents } from '../global-events';
import { hostElementOf } from '../lynx-document/host-elements';
import { INLINE_FLOW_TAGS, WEB_TEXT_TAGS } from '../lynx-document/web-tags';
import { ANONYMOUS_TEXT_CLASS } from '../lynx-element/text-flow';
import { followSafeAreaInsets } from '../lynx-document/page-safe-area';
import type { ElementRef } from '../types/lynx';

/**
 * Hydration-aware document that reconnects Angular's element tree to
 * pre-existing native elements (created by the Lynx engine from a snapshot)
 * instead of creating new ones. Once the hydration queue is exhausted,
 * falls through to a normal LynxDocument for subsequent dynamic mutations.
 */
export class LynxHydrateDocument implements LynxDocumentBase {
  readonly #queue: ElementRef[];
  #cursor = 0;
  #fallback: LynxDocument | null = null;
  #page: LynxElement | null = null;
  readonly #pageElementRef: ElementRef;

  constructor(pageElementRef: ElementRef, elementQueue: ElementRef[]) {
    this.#pageElementRef = pageElementRef;
    this.#queue = elementQueue;
  }

  #isHydrating(): boolean {
    return this.#cursor < this.#queue.length;
  }

  /**
   * Lazily create the fallback document for post-hydration mutations.
   * Reuses the same page element so Angular's root stays consistent.
   */
  #getFallback(): LynxDocument {
    if (!this.#fallback) {
      this.#fallback = new LynxDocument();
      // Backfill the fallback's page reference without calling __CreatePage
      // again — the page already exists from the snapshot.
      this.#fallback.page = this.#page!;
    }
    return this.#fallback;
  }

  #nextElement(): LynxElement {
    // Callers (createElement/createText/createComment) already gate on
    // #isHydrating() before reaching here, so the queue is guaranteed to have
    // an entry. The defensive re-check has been folded into a single throw
    // path (ignored) rather than a two-branch if to keep the coverage report
    // clean while still failing loudly on a future caller that forgets the
    // guard.
    /* v8 ignore next 4 */
    if (this.#cursor >= this.#queue.length) {
      throw new Error(
        'Hydration queue exhausted during initial render — snapshot/template mismatch',
      );
    }
    let ref = this.#queue[this.#cursor++]!;
    // Loose text that the server render drew in an anonymous <text> (see
    // LynxElement's #regroup) has the <text> just before it in the snapshot.
    // Angular never asks for it, so it's taken here, and marked for what it
    // is. It's always followed by what it holds.
    while (
      __GetClasses(ref).includes(ANONYMOUS_TEXT_CLASS) &&
      this.#cursor < this.#queue.length
    ) {
      new LynxElement(ref).markAnonymousText();
      ref = this.#queue[this.#cursor++]!;
    }
    return new LynxElement(ref);
  }

  createRootElement(): LynxElement {
    // Reuse the page element the engine reconstructed from the snapshot
    // instead of calling __CreatePage which would create a duplicate.
    const page = new LynxElement(this.#pageElementRef);
    page.tagName = 'page';
    page.isRootPageElement = true;
    this.#page = page;
    // The document and window hear the screen's events from the page.
    globalEvents().attach(page, (id) => LynxElement.byUniqueId(id));
    // As LynxDocument does: env(safe-area-inset-*) reads the shell's insets.
    followSafeAreaInsets(page);
    return page;
  }

  createElement(tag: string, value?: string): LynxElement {
    if (!this.#isHydrating()) {
      return this.#getFallback().createElement(tag, value) as LynxElement;
    }

    // Return the next pre-existing element from the queue. Angular calls
    // createElement in the same deterministic order as the original render,
    // so the queue order matches.
    if (tag === 'page') {
      return this.#page!;
    }
    const el = this.#nextElement();
    // The snapshot holds the element the host registered (registerHostElement),
    // or the one an HTML tag renders as, so the wrapper takes its tag too.
    el.tagName = hostElementOf(tag);
    // As LynxDocument does: an HTML text tag inherits text styles, and an
    // inline one shares a line with the text beside it.
    if (el.tagName === 'text' && WEB_TEXT_TAGS.has(tag)) {
      el.markWebText(INLINE_FLOW_TAGS.has(tag));
    }
    return el;
  }

  createText(value: string): LynxElement {
    if (!this.#isHydrating()) {
      return this.#getFallback().createText(value);
    }
    const el = this.#nextElement();
    el.tagName = 'raw-text';
    // Seed the same recreation/normalization cache a freshly-created raw-text
    // gets (see LynxDocument.createText). Without this, #rawText stays
    // undefined; if this element is later touched by the flush-time whitespace
    // pass (e.g. a sibling run inside the same <text> changes), it would read
    // back '' and blank this correctly-hydrated text.
    el.setInitialText(value);
    return el;
  }

  createComment(): LynxElement {
    if (!this.#isHydrating()) {
      return this.#getFallback().createComment();
    }
    const el = this.#nextElement();
    el.tagName = 'comment';
    el.hydrateAnchor();
    return el;
  }

  appendChild(newChild: LynxElement): void {
    // During hydration: no-op — the tree structure is already correct
    // in the native layer from the snapshot reconstruction.
    if (this.#isHydrating()) return;
    // The optional-chaining transform generates a synthetic branch that v8's
    // provider counts inconsistently; the two-branch behavior (page set vs
    // not) is exercised by the "delegates to page" and "before createRoot"
    // tests. Ignore the synthetic branch here.
    /* v8 ignore next */
    this.#page?.appendChild(newChild);
  }
}

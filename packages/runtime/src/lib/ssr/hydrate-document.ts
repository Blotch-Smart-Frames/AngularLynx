import { LynxElement } from '../lynx-element';
import { LynxDocument, type LynxDocumentBase } from '../lynx-document';
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
    if (this.#isHydrating()) {
      const ref = this.#queue[this.#cursor++]!;
      return new LynxElement(ref);
    }
    throw new Error(
      'Hydration queue exhausted during initial render — snapshot/template mismatch',
    );
  }

  createRootElement(): LynxElement {
    // Reuse the page element the engine reconstructed from the snapshot
    // instead of calling __CreatePage which would create a duplicate.
    const page = new LynxElement(this.#pageElementRef);
    page.tagName = 'page';
    page.isRootPageElement = true;
    this.#page = page;
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
    el.tagName = tag;
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
    return el;
  }

  appendChild(newChild: LynxElement): void {
    // During hydration: no-op — the tree structure is already correct
    // in the native layer from the snapshot reconstruction.
    if (this.#isHydrating()) return;
    this.#page?.appendChild(newChild);
  }
}

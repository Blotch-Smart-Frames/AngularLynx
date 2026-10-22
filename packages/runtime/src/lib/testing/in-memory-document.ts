import type { LynxDocumentBase } from '../lynx-document/types';
import { InMemoryElement } from './in-memory-element';

/**
 * Test double for LynxDocument that builds an InMemoryElement tree. Not
 * exported from public-api.ts: test-only, never shipped.
 */
export class InMemoryDocument implements LynxDocumentBase {
  #page: InMemoryElement | null = null;

  constructor() {}
  createRootElement(): InMemoryElement {
    const page = new InMemoryElement();
    page.tagName = 'page';
    page.setAttribute('tagName', 'page');
    page.isRootPageElement = true;
    this.#page = page;
    return this.#page;
  }
  createElement(tag: string, value?: string): InMemoryElement {
    // Returns the existing root page element — same singleton semantics as main thread.
    if (tag === 'page') {
      return this.#page!;
    }

    // Stores the tag name so tests can check which element was created.
    const element = new InMemoryElement();
    element.tagName = tag;
    element.setAttribute('tagName', tag);

    // Stores the text content, if any, for tests to check.
    if (value) {
      element.setAttribute('textContent', value);
    }

    return element;
  }
  createText(value: string): InMemoryElement {
    const element = new InMemoryElement();
    element.tagName = 'text';
    element.setAttribute('tagName', 'text');
    element.setAttribute('textContent', value);
    return element;
  }
  createComment(): InMemoryElement {
    const element = new InMemoryElement();
    element.tagName = 'comment';
    element.setAttribute('tagName', 'comment');
    return element;
  }
  appendChild(newChild: InMemoryElement): void {
    this.#page?.appendChild(newChild);
  }
}

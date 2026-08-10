import { LynxBackgroundElement } from '../lynx-element';
import type { LynxDocumentBase } from './types';

export class LynxBackgroundDocument implements LynxDocumentBase {
  #page: LynxBackgroundElement | null = null;

  constructor() {}
  createRootElement(): LynxBackgroundElement {
    const page = new LynxBackgroundElement();
    page.tagName = 'page';
    page.setAttribute('tagName', 'page');
    page.isRootPageElement = true;
    this.#page = page;
    return this.#page;
  }
  createElement(tag: string, value?: string): LynxBackgroundElement {
    // Returns the existing root page element — same singleton semantics as main thread.
    if (tag === 'page') {
      return this.#page!;
    }

    // In the background thread, we create virtual elements but store their tag name
    // to help with debugging and potential future synchronization
    const element = new LynxBackgroundElement();
    element.tagName = tag;
    element.setAttribute('tagName', tag);

    // For debugging purposes, store text content if provided
    if (value) {
      element.setAttribute('textContent', value);
    }

    return element;
  }
  createText(value: string): LynxBackgroundElement {
    const element = new LynxBackgroundElement();
    element.tagName = 'text';
    element.setAttribute('tagName', 'text');
    element.setAttribute('textContent', value);
    return element;
  }
  createComment(): LynxBackgroundElement {
    const element = new LynxBackgroundElement();
    element.tagName = 'comment';
    element.setAttribute('tagName', 'comment');
    return element;
  }
  appendChild(newChild: LynxBackgroundElement): void {
    this.#page?.appendChild(newChild);
  }
}

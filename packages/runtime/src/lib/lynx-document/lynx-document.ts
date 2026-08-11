import { devStats } from '../devtools/stats';
import {
  LynxElement,
  type LynxListElement,
  scheduleSettleFlush,
} from '../lynx-element';
import { setPageElementRef } from './page-ref';

import { createNativeRefByTag } from './create-native-ref';
import {
  createCommentElement,
  createListElement,
  createPageElement,
} from './element-creators';
import type { LynxDocumentBase } from './types';

/**
 * Main-thread document that creates native Lynx elements via PAPI functions.
 * Each createElement call wraps a PAPI call (__CreateView, __CreateText, etc.)
 * and returns a LynxElement wrapping the native ElementRef. The document owns
 * the root page element and tracks its unique ID for child element creation.
 */
export class LynxDocument implements LynxDocumentBase {
  page!: LynxElement;
  #pageId = 0;
  #pageElementRequested = false;

  constructor() {}
  createRootElement(): LynxElement {
    const pageElement = __CreatePage('0', 0);
    this.page = new LynxElement(pageElement);
    this.page.tagName = 'page';
    // Prevent Angular from reparenting or removing the root page element
    // during normal component lifecycle (appendChild/remove calls).
    this.page.isRootPageElement = true;
    this.#pageId = __GetElementUniqueID(pageElement);
    setPageElementRef(pageElement);
    return this.page;
  }
  createElement(tag: string, value?: string): LynxElement | LynxListElement {
    if (__PROFILE__) devStats.elementCreated++;
    // Ensure content created outside a CD cycle (e.g. a lazy route component
    // built by RouterOutlet during navigation) still gets flushed — see
    // scheduleSettleFlush(). A no-op during normal in-cycle rendering.
    scheduleSettleFlush();
    // 'list' returns a LynxListElement (a virtual-tree wrapper, not a raw ref)
    // and 'page' returns the singleton root — both are special and are never
    // recreated, so they are handled here rather than via the shared raw-ref
    // dispatch (createNativeRefByTag), which the recreation path also uses.
    if (tag === 'list') {
      return createListElement(this.#pageId);
    }
    if (tag === 'page') {
      const result = createPageElement(this.page, this.#pageElementRequested);
      this.#pageElementRequested = result.pageElementRequested;
      return result.element;
    }
    const element = createNativeRefByTag(tag, this.#pageId, value);
    const el = new LynxElement(element);
    el.tagName = tag;
    // raw-text bakes its text into the native element at creation, bypassing the
    // cached setter path — seed the recreation cache so a remounted raw-text can
    // be rebuilt via __CreateRawText with the same text.
    if (tag === 'raw-text') {
      el.setInitialText(value ?? '');
    }
    return el;
  }
  createText(value: string): LynxElement {
    scheduleSettleFlush();
    const text = __CreateRawText(value);
    const lynxElement = new LynxElement(text);
    lynxElement.tagName = 'raw-text';
    // Seed the recreation cache: the text is baked into the native ref at
    // creation and never flows through a cached setter, so without this a
    // remounted raw-text would rebuild empty (see LynxElement.setInitialText /
    // #recreateSubtree).
    lynxElement.setInitialText(value);
    return lynxElement;
  }
  createComment(): LynxElement {
    scheduleSettleFlush();
    const element = createCommentElement(this.#pageId);
    const el = new LynxElement(element);
    // tagName 'comment' is the SOLE marker LynxListElement.getUIChildren() uses
    // to skip these @for/@if insertion anchors. It deliberately does not go in a
    // WeakSet of element refs — hashing a native ref crashes the Lepus engine
    // (see getUIChildren). Keep this tag and that filter in sync.
    el.tagName = 'comment';
    return el;
  }
  appendChild(newChild: LynxElement): void {
    this.page.appendChild(newChild);
  }
}

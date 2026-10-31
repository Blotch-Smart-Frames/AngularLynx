import { devStats } from '../devtools/stats';
import {
  LynxElement,
  type LynxListElement,
  scheduleSettleFlush,
} from '../lynx-element';
import { ANDROID_BLUR_CAPTURE_TARGET, isAndroid } from './android-blur-capture';
import {
  __pageElementRef,
  setPageElementRef,
  takePageHandOver,
} from './page-ref';

import { createNativeRefByTag } from './create-native-ref';
import { hostElementOf } from './host-elements';
import {
  createCommentElement,
  createListElement,
  createPageElement,
} from './element-creators';
import type { ElementRef } from '../types/lynx';
import type { LynxDocumentBase } from './types';

/**
 * The page a previous app rendered into, emptied, when a hot update
 * bootstraps the app again (see `handOverPageToNextApp`). A Lynx page has one
 * page element, and the engine shows the first one created: a second
 * `__CreatePage()` gives the new app a page that's never shown, while the old
 * app's elements, whose views are gone, stay on screen. Angular's
 * `ApplicationRef.destroy()` doesn't remove a root component's elements (in a
 * browser they also stay in the page), so they're removed here.
 *
 * @returns The page element, or `null` when no re-bootstrap handed one over.
 */
const takeOverPage = (): ElementRef | null => {
  const page = __pageElementRef;
  if (!takePageHandOver() || !page) return null;
  for (const child of __GetChildren(page) ?? []) {
    __RemoveElement(page, child);
  }
  return page;
};

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
    const pageElement = takeOverPage() ?? __CreatePage('0', 0);
    this.page = new LynxElement(pageElement);
    this.page.tagName = 'page';
    // Prevent Angular from reparenting or removing the root page element
    // during normal component lifecycle (appendChild/remove calls).
    this.page.isRootPageElement = true;
    if (isAndroid()) {
      // What every blur-view blurs on Android (see create-blur-view-element).
      __SetID(pageElement, ANDROID_BLUR_CAPTURE_TARGET);
    }
    this.#pageId = __GetElementUniqueID(pageElement);
    setPageElementRef(pageElement);
    return this.page;
  }
  createElement(name: string, value?: string): LynxElement | LynxListElement {
    // A component's host is a view, unless the component registered another
    // element for it (registerHostElement).
    const tag = hostElementOf(name);
    // `__PROFILE__` is a build-time `define`. In the test config it's `false`
    // (dead-code-eliminated), so the increment is unreachable from Vitest.
    /* v8 ignore next */
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
    // Before any attribute is set: a blur-view with no attributes must still
    // set its (empty) material, or it inherits a parent blur-view's.
    if (tag === 'blur-view') {
      el.updateBlurMaterial();
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

import {
  type ListenerOptions,
  type Renderer2,
  RendererStyleFlags2,
} from '@angular/core';
import { globalEvents } from '../global-events';
import type { LynxDocumentBase } from '../lynx-document';
import { tagClassFor } from '../lynx-document/element-tags';
import type { BaseLynxElement } from '../lynx-element';

/**
 * Collapse every run of whitespace to a single space — WITHOUT trimming the ends.
 *
 * Angular's template compiler (`preserveWhitespaces: false`, the default)
 * already collapses interior whitespace but leaves the single leading/trailing
 * space that template indentation produces (e.g. `<text>\n  Hello\n</text>`
 * reaches us as `" Hello "`). Native Lynx has no CSS white-space model, so that
 * edge space renders as a literal indent on-device.
 *
 * We must strip that edge space — but NOT here, because whether an edge space is
 * trimmable depends on POSITION within the text's inline-formatting context. The
 * leading space of the FIRST run and the trailing space of the LAST run are
 * trimmed, but the space between two adjacent runs — e.g. the projected
 * `<text>One </text><text>two</text><text> three</text>` — is meaningful and
 * must survive (otherwise "One two three" renders as "Onetwothree"). The
 * renderer sees one text node at a time with no sibling context, and projected
 * runs from separate templates only form one inline context at runtime, so the
 * positional edge-trim runs later — at flush time over the assembled tree (see
 * `processPendingTextNormalization` in lynx-element.ts). Here we only collapse,
 * so the element can stash the collapsed-but-untrimmed value that pass re-derives
 * the display from. React Lynx sidesteps all this at compile time, where its JSX
 * transform still has the newline info Angular has already discarded by now.
 *
 * ASCII whitespace only, so a deliberate non-breaking space (U+00A0) survives as
 * an escape hatch for a value that needs a literal edge space.
 */
const collapseWhitespace = (value: string): string =>
  value.replace(/[ \t\n\r\f\v]+/g, ' ');

/**
 * Marks an element created for a tag Lynx has no element for (a component's
 * host, or a web tag such as `div`) with the tag's class. It renders as a
 * `<view>` (or the element `registerHostElement` names), so a type selector
 * naming the tag, such as `app-card { height: 100%; }`, would match nothing;
 * the build plugin rewrites such selectors to the class (see element-tags.ts).
 * A scope class, so binding `class` doesn't drop it.
 */
const markTag = (element: BaseLynxElement, tag: string): void => {
  const tagClass = tagClassFor(tag);
  if (tagClass) element.addScopeClass(tagClass);
};

export class LynxRenderer implements Renderer2 {
  readonly #document: LynxDocumentBase;
  /**
   * Stable storage for Angular's per-renderer metadata (e.g. component styles).
   * Must be the same object reference across calls — Angular reads back what it writes.
   */
  readonly #data: { [key: string]: unknown } = {};

  constructor(document: LynxDocumentBase) {
    this.#document = document;
  }

  get data(): { [key: string]: any } {
    return this.#data;
  }

  destroy(): void {
    // No-op: this renderer does not own the document (it is injected via DI)
    // and holds no other resources that require explicit cleanup.
  }
  createElement(name: string, _namespace?: string | null): BaseLynxElement {
    const element = this.#document.createElement(name);
    markTag(element, name);
    return element;
  }
  createComment(_value: string): BaseLynxElement {
    return this.#document.createComment();
  }
  createText(value: string): BaseLynxElement {
    return this.#document.createText(collapseWhitespace(value));
  }
  // Angular walks a destroyed view and calls destroyNode() per node ONLY when
  // this is non-null (see destroyLView in @angular/core). We use it to drop the
  // node from LynxElement's native-ref → canonical-wrapper registry, so the
  // registry doesn't retain wrappers for genuinely-destroyed elements. A no-op
  // for nodes without the method (background-thread / SSR elements).
  destroyNode: ((node: unknown) => void) | null = (node: unknown): void => {
    (node as { deregisterNative?: () => void }).deregisterNative?.();
    // A canvas's GL context goes with it (see LynxCanvasElement).
    (node as { releaseContext?: () => void }).releaseContext?.();
  };

  appendChild(parent: BaseLynxElement, newChild: BaseLynxElement): void {
    parent.appendChild(newChild);
  }
  insertBefore(
    parent: BaseLynxElement,
    newChild: BaseLynxElement,
    refChild: BaseLynxElement | null,
    _isMove?: boolean,
  ): void {
    if (refChild == null) {
      parent.appendChild(newChild);
    } else {
      parent.insertBefore(newChild, refChild);
    }
  }
  removeChild(
    _parent: BaseLynxElement,
    oldChild: BaseLynxElement,
    _isHostElement?: boolean,
  ): void {
    oldChild.remove();
  }
  /**
   * Angular calls selectRootElement once during bootstrap to get the root
   * node where the app component will be rendered. In browser Angular this
   * finds an existing DOM element; here we create the Lynx page element.
   */
  selectRootElement(): BaseLynxElement {
    return this.#document.createRootElement();
  }
  parentNode(node: BaseLynxElement): BaseLynxElement | null {
    return node.parentNode();
  }
  nextSibling(node: BaseLynxElement): BaseLynxElement | null {
    return node.nextSibling();
  }
  setAttribute(
    el: BaseLynxElement,
    name: string,
    value: string,
    _namespace?: string | null,
  ): void {
    el.setAttribute(name, value);
  }
  removeAttribute(
    el: BaseLynxElement,
    name: string,
    _namespace?: string | null,
  ): void {
    el.removeAttribute(name);
  }
  addClass(el: BaseLynxElement, name: string): void {
    el.addClass(name);
  }
  removeClass(el: BaseLynxElement, name: string): void {
    el.removeClass(name);
  }
  setStyle(
    el: BaseLynxElement,
    style: string,
    value: any,
    flags?: RendererStyleFlags2,
  ): void {
    // Angular passes style names in camelCase unless DashCase flag is set.
    // Lynx expects CSS property names in dash-case (e.g. background-color).
    const cssKey =
      flags != null && flags & RendererStyleFlags2.DashCase
        ? style
        : style.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    // Important flag signals [style.foo.important] binding — append !important.
    const cssValue =
      flags != null && flags & RendererStyleFlags2.Important
        ? `${String(value)} !important`
        : value;
    el.setStyle(cssKey, cssValue);
  }
  removeStyle(
    el: BaseLynxElement,
    style: string,
    flags?: RendererStyleFlags2,
  ): void {
    const cssKey =
      flags != null && flags & RendererStyleFlags2.DashCase
        ? style
        : style.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    el.removeStyle(cssKey);
  }
  setProperty(el: BaseLynxElement, name: string, value: any): void {
    el.setProperty(name, value);
  }
  /**
   * Angular calls setValue for text nodes created via createText(). In the
   * browser DOM this sets node.nodeValue. In Lynx, raw-text elements store
   * their content in the 'text' attribute.
   */
  setValue(node: BaseLynxElement, value: string): void {
    node.setAttribute('text', collapseWhitespace(value));
  }
  /**
   * Adds a listener to an element, or to a global target: Angular passes the
   * document stand-in for a `document:` host listener, its `body` for
   * `body:`, and its `defaultView` for `window:` (see global-events), and a
   * library can name one, as `renderer.listen('document', …)`, which
   * Angular's DOM renderer resolves the same way. In the web preview, code
   * can also pass a DOM object of its own.
   */
  listen(
    target: BaseLynxElement | GlobalTargetName | ListenTarget,
    eventName: string,
    callback: (event: any) => boolean | void,
    options?: ListenerOptions,
  ): () => void {
    const resolved =
      typeof target === 'string'
        ? globalTarget(target, eventName)
        : (target as ListenTarget);
    const remove = resolved.addEventListener(eventName, callback, options);
    // A Lynx element returns the function that removes its listener; the
    // document, the window and DOM objects return nothing.
    return typeof remove === 'function'
      ? (remove as () => void)
      : () => resolved.removeEventListener!(eventName, callback, options);
  }
}

type GlobalTargetName = 'window' | 'document' | 'body';

/** What `listen()` needs of a target: an EventTarget's two methods. */
type ListenTarget = {
  addEventListener(
    name: string,
    callback: (event: any) => unknown,
    options?: ListenerOptions,
  ): unknown;
  removeEventListener?(
    name: string,
    callback: (event: any) => unknown,
    options?: ListenerOptions,
  ): void;
};

/**
 * The object a global target's name stands for, as Angular's DOM renderer
 * finds it (`getGlobalEventTarget`), with the same error for any other.
 */
const globalTarget = (name: string, eventName: string): ListenTarget => {
  const document = globalEvents().document;
  const target =
    name === 'window'
      ? document.defaultView
      : name === 'document'
        ? document
        : name === 'body'
          ? document.body
          : null;
  if (!target) {
    throw new Error(`Unsupported event target ${name} for event ${eventName}`);
  }
  return target as ListenTarget;
};

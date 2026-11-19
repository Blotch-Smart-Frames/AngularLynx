import type { BaseLynxElement } from '../lynx-element';

/**
 * Contract implemented by LynxDocument (real PAPI calls) and
 * LynxHydrateDocument (reuses the elements of an SSR snapshot).
 */
export type LynxDocumentBase = {
  /**
   * The app's page: made by the first call, and the same element on every
   * call after it (a Lynx page has one page element).
   */
  createRootElement(): BaseLynxElement;
  createElement(tag: string, value?: string): BaseLynxElement;
  createText(value: string): BaseLynxElement;
  // Angular uses comment nodes as insertion anchors for @if/@for/@switch and
  // ViewContainerRef.createComponent(). In LynxDocument, these map to invisible
  // <view style="display:none"> elements because __CreateNonElement doesn't
  // support the tree traversal APIs Angular needs.
  createComment(): BaseLynxElement;
  appendChild(newChild: BaseLynxElement): void;
};

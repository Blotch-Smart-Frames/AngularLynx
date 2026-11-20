import type { BaseLynxElement } from '../lynx-element';
import type { StaticBlock } from '../static-blocks/static-block';

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
  /**
   * Gives a static block's root its elements (see
   * static-blocks/static-block.ts). A document without it (the testing
   * doubles) builds none: only the build plugin makes static blocks, and
   * tests aren't built with it.
   */
  buildStaticBlock?(
    root: BaseLynxElement,
    block: StaticBlock,
    scope: string,
  ): void;
};

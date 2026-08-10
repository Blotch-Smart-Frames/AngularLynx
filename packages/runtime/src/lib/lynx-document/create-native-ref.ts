import type { ElementRef } from '../types/lynx';
// Import each creator by its DIRECT file path, NOT the element-creators barrel.
// The barrel re-exports createListElement/createPageElement, which import
// LynxElement — routing through it would form a cycle (LynxElement imports this
// module). The individual creators below import only PAPI globals and types.
import { createBlockElement } from './element-creators/create-block-element';
import { createCommentElement } from './element-creators/create-comment-element';
import { createDefaultElement } from './element-creators/create-default-element';
import { createForElement } from './element-creators/create-for-element';
import { createFrameElement } from './element-creators/create-frame-element';
import { createIfElement } from './element-creators/create-if-element';
import { createImageElement } from './element-creators/create-image-element';
import { createInputElement } from './element-creators/create-input-element';
import { createListItemElement } from './element-creators/create-list-item-element';
import { createOverlayElement } from './element-creators/create-overlay-element';
import { createRawTextElement } from './element-creators/create-raw-text-element';
import {
  createRefreshElement,
  createRefreshHeaderElement,
} from './element-creators/create-refresh-element';
import {
  createScrollCoordinatorElement,
  createScrollCoordinatorHeaderElement,
  createScrollCoordinatorSlotElement,
  createScrollCoordinatorToolbarElement,
} from './element-creators/create-scroll-coordinator-element';
import { createScrollViewElement } from './element-creators/create-scroll-view-element';
import { createSvgElement } from './element-creators/create-svg-element';
import { createTextElement } from './element-creators/create-text-element';
import { createTitleBarViewElement } from './element-creators/create-title-bar-view-element';
import { createViewElement } from './element-creators/create-view-element';
import {
  createViewPagerElement,
  createViewPagerItemElement,
} from './element-creators/create-viewpager-element';

/**
 * Creates a raw native ElementRef for a logical tag, WITHOUT wrapping it in a
 * LynxElement. One tag→`__Create*` dispatch shared by two callers:
 *
 *  - `LynxDocument.createElement` — wraps the ref in a LynxElement and sets
 *    `tagName`.
 *  - `LynxElement.#recreateSubtree` — re-creates a fresh native ref for an
 *    element whose painting node was destroyed by a cross-flush removal (Lynx
 *    has no API to resurrect a torn-down painting node, so a remounted element
 *    must be rebuilt — see that method).
 *
 * Deliberately excludes 'list' and 'page': 'list' returns a `LynxListElement`
 * (a wrapper, not a raw ref) whose children are driven by update-list-info, and
 * 'page' is the singleton root created once by `createRootElement`. Neither is
 * ever recreated, so both are guarded out at the call sites — and importing
 * their creators here would pull `LynxElement` into this module, forming an
 * import cycle (lynx-document already imports LynxElement).
 */
export const createNativeRefByTag = (
  tag: string,
  pageId: number,
  text?: string,
): ElementRef => {
  switch (tag) {
    case 'view':
      return createViewElement(pageId);
    case 'image':
      return createImageElement(pageId);
    case 'text':
      return createTextElement(pageId);
    case 'raw-text':
      return createRawTextElement(text ?? '');
    case 'scroll-view':
      return createScrollViewElement(pageId);
    case 'list-item':
      return createListItemElement(pageId);
    case 'block':
      return createBlockElement(pageId);
    case 'if':
      return createIfElement(pageId);
    case 'for':
      return createForElement(pageId);
    case 'frame':
      return createFrameElement(pageId);
    case 'input':
    case 'textarea':
      return createInputElement(tag, pageId);
    case 'overlay':
      return createOverlayElement(pageId);
    case 'svg':
      return createSvgElement(pageId);
    case 'viewpager':
      return createViewPagerElement(pageId);
    case 'viewpager-item':
      return createViewPagerItemElement(pageId);
    case 'refresh':
      return createRefreshElement(pageId);
    case 'refresh-header':
      return createRefreshHeaderElement(pageId);
    case 'title-bar-view':
      return createTitleBarViewElement(pageId);
    case 'scroll-coordinator':
      return createScrollCoordinatorElement(pageId);
    case 'scroll-coordinator-header':
      return createScrollCoordinatorHeaderElement(pageId);
    case 'scroll-coordinator-toolbar':
      return createScrollCoordinatorToolbarElement(pageId);
    case 'scroll-coordinator-slot':
      return createScrollCoordinatorSlotElement(pageId);
    case 'comment':
      return createCommentElement(pageId);
    default:
      return createDefaultElement(tag, pageId);
  }
};

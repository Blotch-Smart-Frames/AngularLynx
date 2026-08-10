import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * High-performance virtualized list, equivalent to RecyclerView / UITableView.
 */
@Directive({
  selector: 'list',
  standalone: true,
  inputs: [
    'list-type',
    'span-count',
    'scroll-orientation',
    'enable-scroll',
    'enable-nested-scroll',
    'bounces',
    'sticky',
    'sticky-offset',
    'scroll-bar-enable',
    'initial-scroll-index',
    'upper-threshold-item-count',
    'lower-threshold-item-count',
    'scroll-event-throttle',
    'need-visible-item-info',
    'need-layout-complete-info',
    'preload-buffer-count',
    'item-snap',
    'update-animation',
    'list-main-axis-gap',
    'list-cross-axis-gap',
    'enable-async-list',
  ],
})
export class LynxList extends LynxElementBase {
  /**
   * Layout algorithm.
   * - `'single'`    — one item per row/column
   * - `'flow'`      — fixed column count, items fill left-to-right
   * - `'waterfall'` — Pinterest-style varying-height columns
   */
  'list-type'?: 'single' | 'flow' | 'waterfall';
  /**
   * Number of columns (flow/waterfall) or rows (horizontal single).
   */
  'span-count'?: number;
  /**
   * Scroll axis. @default 'vertical'
   */
  'scroll-orientation'?: 'vertical' | 'horizontal';
  'enable-scroll'?: boolean;
  'enable-nested-scroll'?: boolean;
  bounces?: boolean;
  sticky?: boolean;
  /**
   * Offset in px for sticky items.
   */
  'sticky-offset'?: number;
  'scroll-bar-enable'?: boolean;
  /**
   * Scroll to this item index on first render.
   */
  'initial-scroll-index'?: number;
  /**
   * Number of items from the top that triggers bindscrolltoupper.
   */
  'upper-threshold-item-count'?: number;
  /**
   * Number of items from the bottom that triggers bindscrolltolower.
   */
  'lower-threshold-item-count'?: number;
  /**
   * Minimum interval in ms between scroll events.
   */
  'scroll-event-throttle'?: number;
  /**
   * Include visible item info in scroll event payloads.
   */
  'need-visible-item-info'?: boolean;
  /**
   * Include layout completion info in events.
   */
  'need-layout-complete-info'?: boolean;
  /**
   * Number of items to preload beyond the visible area.
   */
  'preload-buffer-count'?: number;
  /**
   * Snap behavior: `{ factor: 0–1, offset: px }`.
   */
  'item-snap'?: { factor: number; offset: number };
  /**
   * Insert/remove animation style.
   */
  'update-animation'?: 'default' | 'none';
  /**
   * Gap between items on the main axis (CSS length).
   */
  'list-main-axis-gap'?: string;
  /**
   * Gap between columns/rows on the cross axis (CSS length).
   */
  'list-cross-axis-gap'?: string;
  /**
   * Required by Lynx's native list UI whenever the app uses the standard
   * dual-thread engine strategy (always true for AngularLynx) — without it
   * the native list silently never applies its data source, so
   * `componentAtIndex` is never called and no items render. The renderer
   * sets this to `true` by default at element creation; bind it explicitly
   * only to opt back into the sync (all-on-UI) engine strategy.
   * @default true
   */
  'enable-async-list'?: boolean;
}

/**
 * Child of `<list>`; represents a single virtualized cell.
 */
@Directive({
  selector: 'list-item',
  standalone: true,
  inputs: [
    'item-key',
    'full-span',
    'sticky-top',
    'sticky-bottom',
    'recyclable',
    'reuse-identifier',
    'estimated-main-axis-size-px',
    'defer',
  ],
})
export class LynxListItem extends LynxElementBase {
  /**
   * Stable unique key for this item — used for diffing and recycling.
   * Must be unique within the list.
   */
  'item-key'?: string;
  /**
   * Whether this item spans all columns (full-width in flow/waterfall).
   */
  'full-span'?: boolean;
  /**
   * Stick this item to the top of the list while scrolling.
   */
  'sticky-top'?: boolean;
  /**
   * Stick this item to the bottom of the list while scrolling.
   */
  'sticky-bottom'?: boolean;
  /**
   * Whether this item's view can be recycled. @default true
   */
  recyclable?: boolean;
  /**
   * Reuse pool identifier — items with the same identifier share views.
   */
  'reuse-identifier'?: string;
  /**
   * Estimated item size in px for layout pre-calculation.
   */
  'estimated-main-axis-size-px'?: number;
  /**
   * Deferred rendering. Pass `true` to defer, or an object to control
   * whether the item unmounts when recycled.
   */
  defer?: boolean | { unmountRecycled?: boolean };
}

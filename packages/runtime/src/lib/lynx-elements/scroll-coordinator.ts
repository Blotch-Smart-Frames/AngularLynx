import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Nested scroll coordination container. Synchronizes a foldable header, sticky toolbar, and scrollable content slot.
 */
@Directive({
  selector: 'scroll-coordinator',
  standalone: true,
  inputs: [
    'enable-scroll',
    'bounces',
    'granularity',
    'header-over-slot',
    'refresh-mode',
    'enable-scroll-bar',
    'android-nested-scroll-as-child',
    'ios-force-scroll-detach',
    'ios-scrolls-to-top',
  ],
})
export class LynxScrollCoordinator extends LynxElementBase {
  /**
   * Whether the coordinator can scroll vertically. @default true
   */
  'enable-scroll'?: boolean;
  /**
   * Enable bounce effect when scrolling past boundary (iOS/Harmony). @default true
   */
  bounces?: boolean;
  /**
   * Event response granularity for bindoffset. @default 0.01
   */
  granularity?: number;
  /**
   * Whether header appears over slot when overflowing. @default false
   */
  'header-over-slot'?: boolean;
  /**
   * Refresh mode: 'none', 'page', or 'fold' (iOS). @default 'none'
   */
  'refresh-mode'?: 'none' | 'page' | 'fold';
  /**
   * Show scrollbar during scrolling (iOS/Harmony). @default false
   */
  'enable-scroll-bar'?: boolean;
  /**
   * Enable nested scroll as child in other scrolling widgets (Android). @default false
   */
  'android-nested-scroll-as-child'?: boolean;
  /**
   * Force nested-vertical-scroll-behavior invalid (iOS). @default false
   */
  'ios-force-scroll-detach'?: boolean;
  /**
   * Scroll to top when tapping status bar (iOS). @default false
   */
  'ios-scrolls-to-top'?: boolean;
}

/**
 * Header content that scrolls out of view. Must be a direct child of `<scroll-coordinator>`.
 */
@Directive({
  selector: 'scroll-coordinator-header',
  standalone: true,
})
export class LynxScrollCoordinatorHeader extends LynxElementBase {}

/**
 * Sticky toolbar that remains visible at the top. Must be a direct child of `<scroll-coordinator>`.
 */
@Directive({
  selector: 'scroll-coordinator-toolbar',
  standalone: true,
})
export class LynxScrollCoordinatorToolbar extends LynxElementBase {}

/**
 * Container for scrollable content (typically a `<list>`). Must be a direct child of `<scroll-coordinator>`.
 */
@Directive({
  selector: 'scroll-coordinator-slot',
  standalone: true,
})
export class LynxScrollCoordinatorSlot extends LynxElementBase {}

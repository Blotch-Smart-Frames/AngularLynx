import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import { type PopoverAnchor, UiPopoverPanel } from './popover-panel';

/** How many popovers there have been, for their glass ids. */
let popoverCount = 0;

/**
 * A popover's content: a column, padded, that a `ui-popover` shows when it
 * opens.
 *
 * ```html
 * <ui-popover-content class="w-64 gap-1">
 *   <text class="text-base font-semibold text-glass-foreground">Kyoto</text>
 *   <text class="text-sm text-glass-muted-foreground">Day 3 of 5</text>
 * </ui-popover-content>
 * ```
 *
 * Its classes go on its own element, so `class` sets its width, padding and
 * spacing. It's as wide as its content by default, and no wider than the
 * screen. Color text in it with `text-glass-foreground` and
 * `text-glass-muted-foreground`, which suit the glass and Material's solid
 * surface alike.
 */
@Component({
  selector: 'ui-popover-content',
  encapsulation: ViewEncapsulation.None,
  // The classes on the host itself: it's the column, with no inner view in
  // a host of no size of its own between it and the panel.
  host: { '[class]': 'contentClass()' },
  template: `<ng-content />`,
})
export class UiPopoverContent {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly contentClass = computed(() =>
    cn('flex-col gap-1 p-4 flex', this.userClass()),
  );
}

/**
 * A popover: content that opens from the control that presents it, and
 * leaves the rest of the screen as it was.
 *
 * ```html
 * <ui-popover>
 *   <ui-button uiPopoverTrigger variant="outline">Details</ui-button>
 *   <ui-popover-content class="w-64">
 *     <text class="text-sm text-glass-foreground">Check-in from 3pm.</text>
 *   </ui-popover-content>
 * </ui-popover>
 * ```
 *
 * Mark the element that opens it with `uiPopoverTrigger`; what's in the
 * `<ui-popover-content>` is the popover. A tap on the trigger opens and
 * closes it, and a touch anywhere else closes it without being swallowed:
 * nothing dims, and the button under the finger still gets the tap.
 * `[(open)]` opens and closes it from code.
 *
 * On iOS 26 and later it's Liquid Glass that grows out of the trigger, over
 * it, as iOS 26 grows a popover out of its source item. Before iOS 26 it's
 * the frosted material beside the trigger, with an arrow pointing at it, as
 * UIKit drew a popover on iPhone. On Android it's a Material 3 menu surface
 * that unfolds below the trigger, or Liquid Glass with
 * `provideGlass({ android: 'glass' })`. It stays inside the safe area, and
 * opens upward near the bottom of the screen.
 */
@Component({
  selector: 'ui-popover',
  imports: [LYNX_ELEMENTS, UiPopoverPanel],
  encapsulation: ViewEncapsulation.None,
  template: `
    <ng-content />
    <ui-popover-panel
      #panel
      [open]="open()"
      [anchor]="anchor()"
      [glassId]="glassId"
      (dismissed)="close()"
      (closed)="closed.emit()"
    >
      <ng-content select="ui-popover-content" />
    </ui-popover-panel>
  `,
})
export class UiPopover {
  /** Whether the popover is open. */
  readonly open = model(false);
  /** The popover has closed and its close animation has finished. */
  readonly closed = output<void>();

  readonly #host = inject<ElementRef<PopoverAnchor>>(ElementRef);
  readonly #trigger = signal<PopoverAnchor | null>(null);

  /**
   * The id the popover's glass and a glass trigger share (see UiGlass's
   * `glassId`), unique to the popover, so it takes over the trigger's glass
   * as it grows out of it.
   */
  readonly glassId = `ui-popover-${++popoverCount}`;

  // Required: always in the template.
  readonly panel = viewChild.required<UiPopoverPanel>('panel');

  /**
   * What the popover opens from: its trigger, or the popover's own element
   * when nothing is marked `uiPopoverTrigger`.
   */
  protected readonly anchor = computed(
    () => this.#trigger() ?? this.#host.nativeElement,
  );

  /** Whether the popover covers its trigger now; see coversAnchor. */
  readonly coversTrigger = computed(() => this.panel().coversAnchor());

  toggle(): void {
    this.open.update((open) => !open);
  }

  close(): void {
    this.open.set(false);
  }

  /**
   * @internal Called by the `uiPopoverTrigger` directive.
   */
  setTrigger(trigger: PopoverAnchor | null): void {
    this.#trigger.set(trigger);
  }
}

/**
 * Marks the element that opens a `ui-popover`: a tap on it opens or closes
 * the popover, which opens from it.
 *
 * ```html
 * <ui-popover>
 *   <ui-button uiPopoverTrigger>Details</ui-button>
 *   …
 * </ui-popover>
 * ```
 *
 * A touch on the trigger doesn't count as one outside the popover, so a tap
 * on it closes an open popover rather than closing and reopening it.
 */
@Directive({
  selector: '[uiPopoverTrigger]',
  host: {
    '(click)': 'popover.toggle()',
    // Bubbling, from what the touch landed on in the trigger: Lynx 4.1 ran
    // no capture listener on iOS (see UiPopoverPanel).
    '(bindtouchstart)': 'popover.panel().touchedAnchor()',
    '(bindmousedown)': 'popover.panel().touchedAnchor()',
    '[style.visibility]': 'popover.coversTrigger() ? "hidden" : null',
  },
})
export class UiPopoverTrigger {
  protected readonly popover = inject(UiPopover);

  /**
   * Points the popover at this element until the directive is destroyed. A
   * trigger that's glass itself (`<blur-view ui-glass uiPopoverTrigger>`)
   * shares the popover's glass id meanwhile, so the popover takes its glass
   * over (see UiPopoverPanel's coversAnchor).
   */
  protected readonly unregister = registerTrigger(
    this.popover,
    inject<ElementRef<PopoverAnchor>>(ElementRef).nativeElement,
    inject(UiGlass, { self: true, optional: true }),
    inject(DestroyRef),
  );
}

/**
 * Makes `trigger` the element `popover` opens from, and pairs its `glass`,
 * if it's glass, with the popover's, until `destroyRef` is destroyed.
 * Returns what takes the registration back early.
 */
const registerTrigger = (
  popover: UiPopover,
  trigger: PopoverAnchor,
  glass: UiGlass | null,
  destroyRef: DestroyRef,
): (() => void) => {
  popover.setTrigger(trigger);
  glass?.pair(popover.glassId);
  return destroyRef.onDestroy(() => {
    popover.setTrigger(null);
    glass?.pair(null);
  });
};

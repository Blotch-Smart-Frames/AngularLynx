import { NgTemplateOutlet } from '@angular/common';
import {
  type OnDestroy,
  Component,
  Directive,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  SCALE,
  fadeIn,
  fadeOut,
  pressDown,
  pressRelease,
  slideIn,
  slideOut,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import { injectGlassDesign } from '../glass/glass-design';
import { type PopoverAnchor, UiPopoverPanel } from '../popover/popover-panel';

/** How many action sheets there have been, for their glass ids. */
let sheetCount = 0;

/**
 * The width of an action sheet opened from a control: iOS's, and Material's
 * widest menu.
 */
const ANCHORED_WIDTH = { glass: 270, material: 280 } as const;

/**
 * An action sheet: a short list of choices about an action the user took,
 * such as saving or deleting a draft.
 *
 * ```html
 * <ui-button (pressed)="open.set(true)">Share</ui-button>
 * <ui-action-sheet [(open)]="open">
 *   <ui-action-sheet-title>Share this document</ui-action-sheet-title>
 *   <ui-action-sheet-item (pressed)="copyLink()">Copy link</ui-action-sheet-item>
 *   <ui-action-sheet-item variant="destructive" (pressed)="remove()">Delete</ui-action-sheet-item>
 *   <ui-action-sheet-cancel />
 * </ui-action-sheet>
 * ```
 *
 * By default it slides up from the bottom of the screen over a dimmed
 * backdrop, with Cancel in a tile of its own below the actions, and takes
 * the screen until it closes.
 *
 * Mark the control that presents it with `[uiActionSheetAnchor]="sheet"`
 * to open it from that control instead, as iOS 26 does: there it's Liquid
 * Glass that grows out of the control, and on Android a Material 3 menu
 * that unfolds beside it. Nothing dims, Cancel gives way to a touch outside,
 * and that touch still reaches what it lands on. Before iOS 26, iPhone
 * action sheets always rose from the bottom, so it does there too.
 */
@Component({
  selector: 'ui-action-sheet',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiPopoverPanel],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- Android's back button asks the overlay to close (requestclose),
         which closes the sheet as Cancel does. -->
    <overlay
      [attr.visible]="overlayVisible()"
      [style]="overlayStyle()"
      (bindrequestclose)="close()"
    >
      <!-- bg-black/50 dims the content behind the sheet. The fadeIn/fadeOut in
           #animateIn/#animateOut already tween this element's opacity over
           DURATION.normal, so the dim animates in lockstep with the panel slide —
           matching the dialog/bottom-sheet backdrop. It's a named color, not a
           theme one, because the dim is black in light and dark mode alike;
           bg-black/50 compiles to rgb(0 0 0 / 0.5), which Lynx accepts. -->
      <view
        #backdrop
        class="h-full w-full bg-black/50"
        (bindtap)="onBackdropTap()"
      >
        <view
          #panel
          [class]="panelClass()"
          [style]="panelPositionStyle()"
          [accessibility-exclusive-focus]="overlayVisible()"
          (catchtap)="onPanelTap()"
        >
          <!-- The elevation shadow is an inline rgba() box-shadow rather than a
               \`shadow-*\` Tailwind class: the Lynx tailwind preset doesn't wire
               up the \`--tw-shadow\`/\`--tw-ring-*\` variables those utilities
               depend on, so \`shadow-*\` renders nothing on Lynx. \`overflow-hidden\`
               clips this tile's children to the rounded corners but not its own
               box-shadow (painted outside the border box), so the shadow shows. -->
          <view
            class="flex-col rounded-lg border border-border bg-card flex overflow-hidden"
            style="box-shadow: 0 2px 16px rgba(0, 0, 0, 0.15);"
          >
            @if (!anchored()) {
              <ng-container [ngTemplateOutlet]="actions" />
            }
          </view>
          <!-- Cancel button is slotted separately so it renders outside the
               rounded card — matching the iOS action sheet visual convention
               where cancel is a distinct tile below the action group. -->
          <ng-content select="ui-action-sheet-cancel" />
        </view>
      </view>
    </overlay>
    @if (anchorElement(); as anchor) {
      <!-- Opened from its control: a popover's panel, which leaves the rest
           of the screen as it was. A touch outside it is the cancel, as
           UIKit drops an action sheet's Cancel when it shows it as a
           popover, so the Cancel tile above stays hidden. -->
      <ui-popover-panel
        #anchoredPanel
        [open]="open()"
        [anchor]="anchor"
        [width]="anchoredWidth()"
        [glassId]="glassId"
        (dismissed)="close()"
        (closed)="closed.emit()"
      >
        <view [class]="anchoredClass()">
          <ng-container [ngTemplateOutlet]="actions" />
        </view>
      </ui-popover-panel>
    }
    <!-- One copy of the title and items, for whichever form the sheet takes:
         Angular projects content once, so it can't be in both. -->
    <ng-template #actions><ng-content /></ng-template>
  `,
})
export class UiActionSheet implements OnDestroy {
  readonly open = model(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly closed = output<void>();

  readonly design = injectGlassDesign();
  readonly #anchor = signal<PopoverAnchor | null>(null);

  /**
   * The id the anchored sheet's glass and a glass control share (see
   * UiGlass's `glassId`), unique to the sheet, so it takes over the
   * control's glass as it grows out of it.
   */
  readonly glassId = `ui-action-sheet-${++sheetCount}`;

  /**
   * The control the sheet opens from, on a design that opens it there: iOS
   * 26's glass and Android's Material. iPhone action sheets rose from the
   * bottom edge before iOS 26 whatever presented them, so `frosted` keeps
   * the bottom sheet.
   */
  protected readonly anchorElement = computed(() =>
    this.design() === 'frosted' ? null : this.#anchor(),
  );

  /** Whether the sheet opens from its control rather than from the bottom. */
  readonly anchored = computed(() => this.anchorElement() !== null);

  // Optional: only there while the sheet is anchored.
  readonly anchoredPanel = viewChild<UiPopoverPanel>('anchoredPanel');

  /**
   * Whether the sheet covers its control now: on iOS 26 it grows out of the
   * control and shrinks back into it, which hides meanwhile.
   */
  readonly coversAnchor = computed(
    () => this.anchoredPanel()?.coversAnchor() ?? false,
  );

  /**
   * How the sheet's title and items draw: as today's bottom sheet, as
   * iOS 26's glass popover, or as a Material 3 menu.
   */
  readonly look = computed<'sheet' | 'glass' | 'material'>(() => {
    if (!this.anchored()) return 'sheet';
    return this.design() === 'material' ? 'material' : 'glass';
  });

  protected readonly anchoredWidth = computed(() =>
    this.look() === 'material' ? ANCHORED_WIDTH.material : ANCHORED_WIDTH.glass,
  );

  protected readonly anchoredClass = computed(() =>
    cn('flex-col flex', this.look() === 'material' ? 'py-2' : 'py-1.5'),
  );

  protected readonly overlayVisible = signal(false);
  /**
   * `width`/`height`/`top`/`left` are web-only necessities: on web
   * `<overlay>` has no intrinsic full-screen sizing (unlike native), so
   * without them it collapses to 0x0 and nothing renders. `z-index` keeps it
   * above sibling content that would otherwise occasionally paint on top.
   */
  protected readonly overlayStyle = computed(() =>
    this.overlayVisible()
      ? 'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999;'
      : 'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999; display: none;',
  );

  // Required: both are always in the template (the overlay is hidden, never
  // removed), and nothing reads them before the first render.
  readonly backdropRef = viewChild.required<ElementRef>('backdrop');
  readonly panelRef = viewChild.required<ElementRef>('panel');
  #backdropAnim?: AnimationHandle;
  #panelAnim?: AnimationHandle;
  #sheetOpen = false;
  // The open and close sequences' pending timers, so ngOnDestroy can stop
  // them.
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Opens or closes the action sheet as `open` changes. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   *
   * `#sheetOpen` says the bottom sheet is open or opening, so only a sheet
   * that opened closes. Without it, the first run, with `open` false, would
   * call #doClose() and emit `closed` before the action sheet ever opened,
   * and so would an anchor arriving or leaving while it's closed.
   */
  protected readonly openOrClose = effect(() => {
    // An anchored sheet opens in its popover panel instead, which follows
    // `open` itself.
    const isOpen = this.open() && !this.anchored();
    if (isOpen) {
      this.#sheetOpen = true;
      this.#doOpen();
    } else if (this.#sheetOpen) {
      this.#sheetOpen = false;
      this.#doClose();
    }
  });

  protected readonly panelClass = computed(() =>
    cn('w-full flex-col gap-2 px-4 pb-6 flex', this.userClass()),
  );

  protected readonly panelPositionStyle = computed(
    () => 'position: absolute; bottom: 0; left: 0; right: 0;',
  );

  protected onBackdropTap(): void {
    this.open.set(false);
  }

  close(): void {
    this.open.set(false);
  }

  /**
   * @internal Called by the `uiActionSheetAnchor` directive.
   */
  setAnchor(anchor: PopoverAnchor | null): void {
    this.#anchor.set(anchor);
  }

  /**
   * @internal A touch began on the anchor, which opens the sheet rather than
   * landing outside it (see UiPopoverPanel.touchedAnchor).
   */
  touchedAnchor(): void {
    this.anchoredPanel()?.touchedAnchor();
  }

  /**
   * No-op tap handler for the panel. `catchtap` (vs `bindtap`) already stops
   * the tap from bubbling to the backdrop — Lynx controls propagation via the
   * event prefix, not at runtime. (The renderer shims `event.stopPropagation()`
   * as a no-op so DOM-style handlers don't crash, but it has no effect here.)
   */
  protected onPanelTap(): void {}

  /**
   * The action sheet can be destroyed while its open or close sequence is still
   * running, for example by an `@if` around it or a route change right after
   * closing it. The rest of the sequence then ran on the destroyed component:
   * it animated detached elements and emitted `closed` from a destroyed
   * output, which Angular warns about in dev builds (NG0953).
   */
  ngOnDestroy(): void {
    for (const timer of this.#timers) clearTimeout(timer);
  }

  /**
   * `setTimeout`, tracked so that ngOnDestroy can cancel it.
   */
  #later(callback: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      callback();
    }, ms);
    this.#timers.add(timer);
  }

  /**
   * Two-phase open: make overlay visible first (so native elements exist in
   * the tree), then animate on the next frame. See nav-drawer for the same
   * pattern — Lynx animate() requires elements to be mounted before use.
   */
  #doOpen(): void {
    this.#later(() => {
      this.overlayVisible.set(true);
      this.#later(() => this.#animateIn(), 0);
    }, 0);
  }

  /**
   * Animate out before hiding; +20ms guards against Lynx timer imprecision
   * causing elements to disappear before the animation finishes.
   */
  #doClose(): void {
    this.#later(() => {
      this.#animateOut();
      this.#later(() => {
        this.overlayVisible.set(false);
        this.closed.emit();
      }, DURATION.normal + 20);
    }, 0);
  }

  #animateIn(): void {
    const backdrop = this.backdropRef().nativeElement;
    const panel = this.panelRef().nativeElement;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#backdropAnim = fadeIn(backdrop, { duration: DURATION.normal });
    // Move a screen reader into the panel. It would otherwise stay on whatever
    // opened it, which is now behind the overlay. With the panel's
    // accessibility-exclusive-focus (see the template), it then can't leave
    // the panel until it closes.
    panel.invoke?.('requestAccessibilityFocus');
    this.#panelAnim = slideIn(panel, 'up', {
      duration: DURATION.slow,
      easing: EASING.sheet,
    });
  }

  #animateOut(): void {
    const backdrop = this.backdropRef().nativeElement;
    const panel = this.panelRef().nativeElement;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#backdropAnim = fadeOut(backdrop, { duration: DURATION.normal });
    this.#panelAnim = slideOut(panel, 'down', {
      duration: DURATION.normal,
      easing: EASING.accelerate,
    });
  }
}

/** How an action sheet's title and items draw; see UiActionSheet.look. */
type ActionSheetLook = 'sheet' | 'glass' | 'material';

/**
 * The look of the sheet a title or item is in. Today's bottom sheet when
 * it's in none.
 */
const lookOf = (sheet: UiActionSheet | null) =>
  computed<ActionSheetLook>(() => sheet?.look() ?? 'sheet');

// The bottom sheet's tiles; iOS 26's popover, whose rows are 44pt tall with
// the text in the middle, as UIKit's action sheets keep it in every form;
// and Material 3's menu, with 48dp rows and the text at the start.
const TITLE_CONTAINER: Readonly<Record<ActionSheetLook, string>> = {
  sheet: 'items-center px-4 py-3 flex justify-center',
  glass: 'items-center px-4 pb-1 pt-2 flex justify-center',
  material: 'items-center px-3 pb-1 pt-2 flex',
};
const TITLE_TEXT: Readonly<Record<ActionSheetLook, string>> = {
  sheet: 'text-sm text-muted-foreground',
  glass: 'text-center text-[13px] text-glass-muted-foreground',
  material: 'text-[13px] text-glass-muted-foreground',
};
const ITEM_CONTAINER: Readonly<Record<ActionSheetLook, string>> = {
  sheet: 'items-center border-t border-border px-4 py-3 flex justify-center',
  glass:
    'min-h-[44px] items-center px-4 py-[11px] flex justify-center relative',
  material: 'min-h-[48px] items-center px-3 py-3 flex relative',
};
const ITEM_TEXT: Readonly<Record<ActionSheetLook, string>> = {
  sheet: 'text-base',
  glass: 'text-center text-[17px]',
  material: 'text-[16px]',
};

/**
 * The action sheet's title, muted, above its items. A screen reader reads
 * it as a heading.
 */
@Component({
  selector: 'ui-action-sheet-title',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <text [class]="textClass()" accessibility-traits="header"
        ><ng-content
      /></text>
    </view>
  `,
})
export class UiActionSheetTitle {
  readonly #look = lookOf(inject(UiActionSheet, { optional: true }));

  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn(TITLE_CONTAINER[this.#look()], this.userClass()),
  );

  protected readonly textClass = computed(() => TITLE_TEXT[this.#look()]);
}

/**
 * One of the action sheet's choices: a tap emits `pressed` and closes the
 * sheet. A screen reader reads it as a button.
 */
@Component({
  selector: 'ui-action-sheet-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view
      #container
      [class]="containerClass()"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      @if (look() !== 'sheet') {
        <!-- A menu row's pressed highlight (see UiMenuItem's highlightClass):
             rows in a popover light up rather than shrink. -->
        <view
          [class]="highlightClass()"
          [style.opacity]="held() ? highlightOpacity() : 0"
        ></view>
      }
      <text [class]="textClass()" accessibility-traits="button"
        ><ng-content
      /></text>
    </view>
  `,
})
export class UiActionSheetItem {
  readonly #sheet = inject(UiActionSheet);
  protected readonly look = lookOf(this.#sheet);

  readonly variant = input<'default' | 'destructive'>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  // Required: the container is always in the template.
  readonly containerRef = viewChild.required<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  /** Whether a finger (or the mouse) is down on a row in a popover. */
  protected readonly held = signal(false);

  // As UiMenuItem's: iOS 26's inset capsule, and Material's full-width
  // state layer.
  protected readonly highlightClass = computed(() =>
    cn(
      'bg-glass-foreground absolute bottom-0 top-0',
      this.look() === 'glass'
        ? 'rounded-full left-[10px] right-[10px]'
        : 'left-0 right-0',
    ),
  );
  protected readonly highlightOpacity = computed(() =>
    this.look() === 'glass' ? 0.08 : 0.1,
  );

  protected readonly containerClass = computed(() =>
    cn(ITEM_CONTAINER[this.look()], this.userClass()),
  );

  protected readonly textClass = computed(() => {
    const destructive = this.variant() === 'destructive';
    return cn(
      ITEM_TEXT[this.look()],
      destructive && 'text-destructive',
      !destructive &&
        (this.look() === 'sheet' ? 'text-primary' : 'text-glass-foreground'),
    );
  });

  protected onPressStart(): void {
    if (this.look() !== 'sheet') {
      this.held.set(true);
      return;
    }
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(
      this.containerRef().nativeElement,
      SCALE.pressDownLight,
    );
  }

  protected onPressEnd(): void {
    this.held.set(false);
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef().nativeElement);
  }

  protected onPressCancel(): void {
    this.held.set(false);
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef().nativeElement);
  }

  protected onTap(): void {
    this.pressed.emit();
    this.#sheet.close();
  }
}

/**
 * The action sheet's Cancel, in a tile of its own below the actions: a tap
 * closes the sheet. An action sheet opened from its control has none: a
 * touch outside it cancels.
 */
@Component({
  selector: 'ui-action-sheet-cancel',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view
      #container
      [class]="containerClass()"
      style="box-shadow: 0 2px 16px rgba(0, 0, 0, 0.15);"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      <text [class]="textClass()" accessibility-traits="button">{{
        label()
      }}</text>
    </view>
  `,
})
export class UiActionSheetCancel {
  readonly #sheet = inject(UiActionSheet);

  readonly label = input('Cancel');
  readonly userClass = input<string>('', { alias: 'class' });

  // Required: the container is always in the template.
  readonly containerRef = viewChild.required<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn(
      'items-center rounded-lg border border-border bg-card px-4 py-3 flex justify-center',
      this.userClass(),
    ),
  );

  protected readonly textClass = computed(() =>
    cn('text-base font-semibold text-primary'),
  );

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(
      this.containerRef().nativeElement,
      SCALE.pressDownLight,
    );
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef().nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef().nativeElement);
  }

  protected onTap(): void {
    this.#sheet.close();
  }
}

/**
 * Marks the control that presents an action sheet, which then opens from it
 * instead of from the bottom of the screen: Liquid Glass that grows out of
 * it on iOS 26, and a Material 3 menu beside it on Android.
 *
 * ```html
 * <ui-button [uiActionSheetAnchor]="sheet" (pressed)="open.set(true)">
 *   Share
 * </ui-button>
 * <ui-action-sheet #sheet [(open)]="open">…</ui-action-sheet>
 * ```
 *
 * It only says where the sheet opens from: open it as before, from the
 * control's own tap handler. A touch on the control doesn't count as one
 * outside the sheet, so it doesn't close it.
 */
@Directive({
  selector: '[uiActionSheetAnchor]',
  host: {
    // Bubbling, from what the touch landed on in the control: Lynx 4.1 ran
    // no capture listener on iOS (see UiPopoverPanel).
    '(bindtouchstart)': 'sheet().touchedAnchor()',
    '(bindmousedown)': 'sheet().touchedAnchor()',
    '[style.visibility]': 'sheet().coversAnchor() ? "hidden" : null',
  },
})
export class UiActionSheetAnchor {
  /** The action sheet this control presents. */
  readonly sheet = input.required<UiActionSheet>({
    alias: 'uiActionSheetAnchor',
  });

  readonly #element =
    inject<ElementRef<PopoverAnchor>>(ElementRef).nativeElement;
  readonly #glass = inject(UiGlass, { self: true, optional: true });

  /**
   * Points the sheet at this control, and away from it when the directive
   * is destroyed or points at another sheet. A control that's glass itself
   * (`<blur-view ui-glass [uiActionSheetAnchor]>`) shares the sheet's glass
   * id meanwhile, so the sheet takes its glass over (see UiPopoverPanel's
   * coversAnchor).
   */
  protected readonly register = effect((onCleanup) => {
    const sheet = this.sheet();
    sheet.setAnchor(this.#element);
    this.#glass?.pair(sheet.glassId);
    onCleanup(() => {
      sheet.setAnchor(null);
      this.#glass?.pair(null);
    });
  });
}

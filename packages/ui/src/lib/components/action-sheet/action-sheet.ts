import {
  type ElementRef,
  type OnDestroy,
  Component,
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
} from '../../utils/animate';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-action-sheet',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay [attr.visible]="overlayVisible()" [style]="overlayStyle()">
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
            <ng-content />
          </view>
          <!-- Cancel button is slotted separately so it renders outside the
               rounded card — matching the iOS action sheet visual convention
               where cancel is a distinct tile below the action group. -->
          <ng-content select="ui-action-sheet-cancel" />
        </view>
      </view>
    </overlay>
  `,
})
export class UiActionSheet implements OnDestroy {
  readonly open = model(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly closed = output<void>();

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
  #hasBeenOpen = false;
  // The open and close sequences' pending timers, so ngOnDestroy can stop
  // them.
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Opens or closes the action sheet as `open` changes. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   *
   * `#hasBeenOpen` prevents the close animation from running on the initial
   * effect evaluation when `open` starts as false. Without this guard, the
   * first run would call #doClose() and emit `closed` before the action
   * sheet has ever been opened.
   */
  protected readonly openOrClose = effect(() => {
    const isOpen = this.open();
    if (isOpen) {
      this.#hasBeenOpen = true;
      this.#doOpen();
    } else if (this.#hasBeenOpen) {
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

@Component({
  selector: 'ui-action-sheet-title',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <text [class]="textClass()"><ng-content /></text>
    </view>
  `,
})
export class UiActionSheetTitle {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('items-center px-4 py-3 flex justify-center', this.userClass()),
  );

  protected readonly textClass = computed(() =>
    cn('text-sm text-muted-foreground'),
  );
}

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
      <text [class]="textClass()"><ng-content /></text>
    </view>
  `,
})
export class UiActionSheetItem {
  readonly #sheet = inject(UiActionSheet);

  readonly variant = input<'default' | 'destructive'>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  // Required: the container is always in the template.
  readonly containerRef = viewChild.required<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn(
      'items-center border-t border-border px-4 py-3 flex justify-center',
      this.userClass(),
    ),
  );

  protected readonly textClass = computed(() =>
    cn(
      'text-base',
      this.variant() === 'destructive' ? 'text-destructive' : 'text-primary',
    ),
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
    this.pressed.emit();
    this.#sheet.close();
  }
}

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
      <text [class]="textClass()">{{ label() }}</text>
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

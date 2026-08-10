import {
  type ElementRef,
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay [attr.visible]="overlayVisible()" [style]="overlayStyle()">
      <!-- bg-black/50 dims the content behind the sheet. The fadeIn/fadeOut in
           #animateIn/#animateOut already tween this element's opacity over
           DURATION.normal, so the dim animates in lockstep with the panel slide —
           matching the dialog/bottom-sheet backdrop. A named color with an opacity
           modifier is required here: bg-black/50 compiles to rgb(0 0 0 / 0.5),
           which Lynx accepts, whereas opacity modifiers on semantic tokens don't. -->
      <view
        #backdrop
        class="h-full w-full bg-black/50"
        (bindtap)="onBackdropTap()"
      >
        <view
          #panel
          [class]="panelClass()"
          [style]="panelPositionStyle()"
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
export class UiActionSheet {
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

  readonly backdropRef = viewChild<ElementRef>('backdrop');
  readonly panelRef = viewChild<ElementRef>('panel');
  #backdropAnim?: AnimationHandle;
  #panelAnim?: AnimationHandle;
  #hasBeenOpen = false;

  constructor() {
    // `#hasBeenOpen` prevents the close animation from running on the initial
    // effect evaluation when `open` starts as false. Without this guard, the
    // first run would call #doClose() and emit `closed` before the action
    // sheet has ever been opened.
    effect(() => {
      const isOpen = this.open();
      if (isOpen) {
        this.#hasBeenOpen = true;
        this.#doOpen();
      } else if (this.#hasBeenOpen) {
        this.#doClose();
      }
    });
  }

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
   * Two-phase open: make overlay visible first (so native elements exist in
   * the tree), then animate on the next frame. See nav-drawer for the same
   * pattern — Lynx animate() requires elements to be mounted before use.
   */
  #doOpen(): void {
    setTimeout(() => {
      this.overlayVisible.set(true);
      setTimeout(() => this.#animateIn(), 0);
    }, 0);
  }

  /**
   * Animate out before hiding; +20ms guards against Lynx timer imprecision
   * causing elements to disappear before the animation finishes.
   */
  #doClose(): void {
    setTimeout(() => {
      this.#animateOut();
      setTimeout(() => {
        this.overlayVisible.set(false);
        this.closed.emit();
      }, DURATION.normal + 20);
    }, 0);
  }

  #animateIn(): void {
    const backdrop = this.backdropRef()?.nativeElement;
    const panel = this.panelRef()?.nativeElement;
    if (!backdrop || !panel) return;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    this.#backdropAnim = fadeIn(backdrop, { duration: DURATION.normal });
    this.#panelAnim = slideIn(panel, 'up', {
      duration: DURATION.slow,
      easing: EASING.sheet,
    });
  }

  #animateOut(): void {
    const backdrop = this.backdropRef()?.nativeElement;
    const panel = this.panelRef()?.nativeElement;
    if (!backdrop || !panel) return;

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
  standalone: true,
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
  standalone: true,
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

  readonly containerRef = viewChild<ElementRef>('container');
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
      this.containerRef()?.nativeElement,
      SCALE.pressDownLight,
    );
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    this.pressed.emit();
    this.#sheet.close();
  }
}

@Component({
  selector: 'ui-action-sheet-cancel',
  standalone: true,
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

  readonly containerRef = viewChild<ElementRef>('container');
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
      this.containerRef()?.nativeElement,
      SCALE.pressDownLight,
    );
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    this.#sheet.close();
  }
}

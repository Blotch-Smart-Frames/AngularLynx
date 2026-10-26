import {
  type ElementRef,
  type OnDestroy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
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
  scaleIn,
  scaleOut,
} from '../../utils/animate';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-dialog',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay [attr.visible]="overlayVisible()" [style]="overlayStyle()">
      <view #backdrop [class]="backdropClass()" (bindtap)="onBackdropTap()">
        <view
          #panel
          [class]="panelClass()"
          [accessibility-exclusive-focus]="overlayVisible()"
          (catchtap)="onPanelTap()"
        >
          <ng-content />
        </view>
      </view>
    </overlay>
  `,
})
export class UiDialog implements OnDestroy {
  readonly open = model(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly closed = output<void>();

  protected readonly overlayVisible = signal(false);

  readonly backdropRef = viewChild<ElementRef>('backdrop');
  readonly panelRef = viewChild<ElementRef>('panel');
  #backdropAnim?: AnimationHandle;
  #panelAnim?: AnimationHandle;
  #hasBeenOpen = false;
  // The open and close sequences' pending timers, so ngOnDestroy can stop
  // them.
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    // `#hasBeenOpen` prevents the close animation from running on the initial
    // effect evaluation when `open` starts as false. Without this guard, the
    // very first run would call #doClose() immediately, resulting in a no-op
    // animation that still hides the overlay and emits `closed` unexpectedly.
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

  /**
   * Hide the overlay with `display:none` on web where `visible` attr has no
   * effect. `width`/`height`/`top`/`left` are also web-only necessities: on
   * web `<overlay>` has no intrinsic full-screen sizing (unlike native), so
   * without them it collapses to 0x0 and nothing renders. `z-index` keeps it
   * above sibling content that would otherwise occasionally paint on top.
   */
  protected readonly overlayStyle = computed(() =>
    this.overlayVisible()
      ? 'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999;'
      : 'position: fixed; overflow: visible; width: 100vw; height: 100vh; top: 0; left: 0; z-index: 999; display: none;',
  );

  protected readonly backdropClass = computed(() =>
    // bg-black/50 dims the backdrop; backdrop-blur-sm applies frosted-glass blur
    // on web. Lynx does not support backdrop-filter, so the blur is web-only.
    cn(
      'h-full w-full items-center flex justify-center',
      'backdrop-blur-sm bg-black/50',
    ),
  );

  protected readonly panelClass = computed(() =>
    cn(
      'w-4/5 flex-col rounded-lg border border-border bg-background p-6 flex',
      this.userClass(),
    ),
  );

  protected onBackdropTap(): void {
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
   * The dialog can be destroyed while its open or close sequence is still
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
    const backdrop = this.backdropRef()?.nativeElement;
    const panel = this.panelRef()?.nativeElement;
    if (!backdrop || !panel) return;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    // Backdrop fades in first
    this.#backdropAnim = fadeIn(backdrop, { duration: DURATION.normal });
    // Move a screen reader into the panel. It would otherwise stay on whatever
    // opened it, which is now behind the overlay. With the panel's
    // accessibility-exclusive-focus (see the template), it then can't leave
    // the panel until it closes.
    panel.invoke?.('requestAccessibilityFocus');

    // Panel scales in with gentle spring (staggered 30ms after backdrop)
    this.#later(() => {
      this.#panelAnim = scaleIn(panel, {
        duration: DURATION.slow,
        easing: EASING.springSubtle,
        fromScale: SCALE.dialogFrom,
        fromY: 10,
      });
    }, 30);
  }

  #animateOut(): void {
    const backdrop = this.backdropRef()?.nativeElement;
    const panel = this.panelRef()?.nativeElement;
    if (!backdrop || !panel) return;

    this.#backdropAnim?.cancel();
    this.#panelAnim?.cancel();

    // Panel exits with subtle scale + fade
    this.#panelAnim = scaleOut(panel, {
      duration: 180,
      easing: EASING.accelerate,
      toScale: SCALE.dialogTo,
      toY: 10,
    });

    // Backdrop fades out in parallel
    this.#backdropAnim = fadeOut(backdrop, { duration: DURATION.normal });
  }
}

@Component({
  selector: 'ui-dialog-header',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiDialogHeader {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-col gap-1.5 flex', this.userClass()),
  );
}

@Component({
  selector: 'ui-dialog-title',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiDialogTitle {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-lg font-semibold text-foreground', this.userClass()),
  );
}

@Component({
  selector: 'ui-dialog-description',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiDialogDescription {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-sm text-muted-foreground', this.userClass()),
  );
}

@Component({
  selector: 'ui-dialog-footer',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiDialogFooter {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-row gap-2 pt-4 flex justify-end', this.userClass()),
  );
}

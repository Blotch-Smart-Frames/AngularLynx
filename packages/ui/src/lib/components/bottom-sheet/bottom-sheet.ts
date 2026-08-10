// cspell:words WAAPI tweens
import {
  type ElementRef,
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
  fadeIn,
  fadeOut,
  slideIn,
  slideOut,
} from '../../utils/animate';
import { cn } from '../../utils/cn';

// Drag-to-dismiss tuning for the handle strip at the top of the sheet.
//
// Minimum downward travel (px) before releasing dismisses the sheet instead of
// snapping it back — small enough to feel responsive, large enough that a stray
// tap or tiny movement doesn't accidentally close it.
const DISMISS_THRESHOLD = 100;
// Off-screen translateY target (px) for the dismiss slide. Deliberately larger
// than any realistic sheet height so the panel fully clears the viewport. Kept
// in px — not % — so the exit interpolates continuously from the px-based drag
// offset; WAAPI won't tween between px and % transforms.
const DISMISS_TRANSLATE = 600;

// Backdrop dim tuning. The scrim sits at BACKDROP_MAX_DIM alpha when the sheet
// is fully open and lightens toward transparent as the handle is dragged down,
// so the dimming reads as coupled to how much of the sheet is still on screen.
const BACKDROP_MAX_DIM = 0.5;
// Drag distance (px) over which the backdrop fades from full dim to fully clear.
// Ideally this would be the panel's own height, but measuring it on the drag's
// background thread isn't cheap (getBoundingClientRect is main-thread/async), so
// we approximate a full reveal with a fixed travel that stays within the
// DISMISS_TRANSLATE off-screen distance. The dim reduces linearly across it.
const BACKDROP_CLEAR_DISTANCE = 500;

/**
 * Low-level bottom-sheet primitive: a full-screen `<overlay>` with a dimmed
 * backdrop and a panel docked to the bottom that slides up on open, slides
 * down on close, and can be dragged down by its handle to dismiss.
 *
 * It owns none of the content — consumers project whatever they want via
 * `<ng-content>` (a scrollable item list for `select`, arbitrary content for
 * `sheet`). This is the shared engine both those components build on, so the
 * overlay/animation/drag behavior lives in exactly one place.
 */
@Component({
  selector: 'ui-bottom-sheet',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <overlay [attr.visible]="overlayVisible()" [style]="overlayStyle()">
      <view
        #backdrop
        class="h-full w-full"
        [style]="backdropStyle()"
        (bindtap)="onBackdropTap()"
      >
        <view
          #panel
          [class]="panelClass()"
          [style]="panelPositionStyle()"
          (catchtap)="onPanelTap()"
        >
          <view
            class="items-center pb-3 pt-2 flex justify-center"
            (catchtouchstart)="onHandleTouchStart($event)"
            (catchtouchmove)="onHandleTouchMove($event)"
            (catchtouchend)="onHandleTouchEnd()"
            (catchtouchcancel)="onHandleTouchEnd()"
          >
            <view class="h-1 w-10 rounded-full bg-muted" />
          </view>
          <ng-content />
        </view>
      </view>
    </overlay>
  `,
})
export class UiBottomSheet {
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

  // --- Drag-to-dismiss state ---
  // Live downward drag distance (px), applied to the panel as a translateY via
  // `panelPositionStyle()` so the sheet tracks the finger in real time.
  protected readonly dragOffset = signal(0);
  // Screen Y where the current drag began; the delta from here drives dragOffset.
  #dragStartY = 0;
  // True only between touchstart and touchend on the handle, so unrelated move
  // events can't shift the sheet.
  #isDragging = false;

  constructor() {
    // `#hasBeenOpen` prevents the close animation from running on the initial
    // effect evaluation when `open` starts as false. Without this guard, the
    // first run would call #doClose() and emit `closed` before the sheet
    // has ever been opened.
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
    cn(
      'flex-col rounded-t-2xl border-t border-border bg-background flex',
      'w-full',
      // The panel docks at bottom: 0 (see panelPositionStyle), so its lower edge
      // sits behind the home indicator. `pb-safe` pads the bottom by
      // env(safe-area-inset-bottom), lifting the projected content clear of it
      // while the panel background still fills to the screen edge. Degrades to no
      // padding where there's no bottom inset (web/older devices). Mirrors how
      // the toast bakes the safe area into its own docked positioning.
      'pb-safe',
      this.userClass(),
    ),
  );

  // Docked at the bottom, full width; `translateY(dragOffset)` layers the live
  // drag on top so the sheet follows the finger. The open/close slide
  // animations run via element.animate() and override this transform while they
  // play (see #animateIn/#animateOut), then hand back to it once canceled.
  protected readonly panelPositionStyle = computed(
    () =>
      `position: absolute; bottom: 0; left: 0; right: 0; transform: translateY(${this.dragOffset()}px);`,
  );

  // Backdrop scrim dimmed in tandem with the sheet's reveal: full dim while
  // docked (dragOffset 0), lightening as the handle is dragged down so the
  // content behind shows through progressively. Driven through the same live
  // `[style]` path as panelPositionStyle — dragOffset updates on the drag's
  // background thread, and inline styles reflect there (unlike element.animate()
  // opacity tweens, which the open/close fade uses on the main thread instead).
  // The alpha lives in the background-color rather than the element's opacity so
  // it composes cleanly with the fadeIn/fadeOut opacity animations without the
  // two mechanisms fighting over the same property.
  protected readonly backdropStyle = computed(() => {
    const revealed = Math.max(
      0,
      1 - this.dragOffset() / BACKDROP_CLEAR_DISTANCE,
    );
    return `background-color: rgba(0, 0, 0, ${BACKDROP_MAX_DIM * revealed});`;
  });

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
   * Begin a drag on the handle strip. The open slideIn holds the panel at
   * translateY(0%) via fill:'forwards', which would override our inline
   * transform — cancel it so `dragOffset` (applied through panelPositionStyle)
   * actually moves the panel from here on.
   */
  protected onHandleTouchStart(e: {
    touches?: ReadonlyArray<{ clientY: number }>;
  }): void {
    const y = e.touches?.[0]?.clientY;
    if (y == null) return;
    this.#panelAnim?.cancel();
    this.#isDragging = true;
    this.#dragStartY = y;
  }

  protected onHandleTouchMove(e: {
    touches?: ReadonlyArray<{ clientY: number }>;
  }): void {
    if (!this.#isDragging) return;
    const y = e.touches?.[0]?.clientY;
    if (y == null) return;
    // Clamp to >= 0: the sheet is already docked at the bottom, so only a
    // downward (dismiss-direction) drag should move it.
    this.dragOffset.set(Math.max(0, y - this.#dragStartY));
  }

  /**
   * Release the drag. Past the threshold we set `open` to false and let the
   * effect drive teardown (#doClose → drag-aware #animateOut), which keeps the
   * two-way `open` binding in sync and reuses the `closed` emit. Otherwise the
   * sheet springs back to fully open.
   */
  protected onHandleTouchEnd(): void {
    if (!this.#isDragging) return;
    this.#isDragging = false;
    if (this.dragOffset() > DISMISS_THRESHOLD) {
      this.open.set(false);
    } else {
      this.#snapBack(this.dragOffset());
    }
  }

  /**
   * Two-phase open: make the overlay visible first so native elements exist
   * in the tree, then animate on the next frame. Without this, animate()
   * targets elements that haven't been flushed to native yet and silently fails.
   */
  #doOpen(): void {
    setTimeout(() => {
      this.overlayVisible.set(true);
      setTimeout(() => this.#animateIn(), 0);
    }, 0);
  }

  /**
   * Reverse: animate out first, then hide the overlay once the animation
   * completes. The +20ms buffer absorbs timer imprecision in the Lynx
   * runtime — hiding the overlay mid-animation causes elements to vanish
   * before the fade finishes.
   */
  #doClose(): void {
    setTimeout(() => {
      this.#animateOut();
      setTimeout(() => {
        this.overlayVisible.set(false);
        this.closed.emit();
        // Reset for the next open: the sheet returns to its docked position
        // while hidden, so a fresh open animates cleanly from off-screen.
        this.dragOffset.set(0);
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

    // If the sheet was dragged, continue from the finger's offset off-screen
    // (px → px) rather than slideOut's 0% → 100%, which would snap it up first.
    const offset = this.dragOffset();
    this.#panelAnim =
      offset > 0
        ? panel.animate(
            [
              { transform: `translateY(${offset}px)`, opacity: 1 },
              { transform: `translateY(${DISMISS_TRANSLATE}px)`, opacity: 0.8 },
            ],
            {
              duration: DURATION.normal,
              easing: EASING.accelerate,
              fill: 'forwards',
            },
          )
        : slideOut(panel, 'down', {
            duration: DURATION.normal,
            easing: EASING.accelerate,
          });
  }

  /**
   * Release below the dismiss threshold: spring the sheet back to fully open,
   * continuing smoothly from wherever the finger let go (px → 0px).
   */
  #snapBack(fromOffset: number): void {
    const panel = this.panelRef()?.nativeElement;
    this.#panelAnim?.cancel();
    if (panel) {
      this.#panelAnim = panel.animate(
        [
          { transform: `translateY(${fromOffset}px)` },
          { transform: 'translateY(0px)' },
        ],
        { duration: DURATION.fast, easing: EASING.spring, fill: 'forwards' },
      );
    }
    // Match the inline transform to the animation's resting state so the two
    // agree once fill:'forwards' hands control back to the style binding.
    this.dragOffset.set(0);
  }
}

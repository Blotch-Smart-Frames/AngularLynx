import {
  type OnInit,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { type ToastData, dismissToast, toasts } from './toast-state';

// --- Drag-to-dismiss tuning (front toast only) ---
// Minimum downward travel (px) before releasing dismisses the toast instead of
// snapping it back — small enough to feel responsive, large enough that a stray
// tap doesn't close it.
const DISMISS_THRESHOLD = 80;
// Off-screen translateY target (px) for the drag-dismiss slide. Larger than any
// realistic toast height so the toast fully clears the bottom of the screen.
const DISMISS_TRANSLATE = 300;

// --- Stack tuning ---
// How many toasts are visually stacked at once. Extras stay in the `toasts`
// array (the queue) but aren't rendered, so they hold no timer and simply wait
// their turn — nothing is dropped.
const MAX_VISIBLE = 3;
// Each toast deeper in the stack is lifted up by this many px, so older toasts
// peek out above the front one.
const STACK_GAP = 14;
// ...and shrunk by this much per depth level, faking perspective.
const STACK_SCALE_STEP = 0.05;

/**
 * `translateY`/`scale` transform for a toast at a given stack depth, ignoring
 * drag. depth 0 = front (full size, no lift); deeper = higher up + smaller.
 * Used as the FROM/TO of the entrance/restack/exit animations, and mirrored by
 * `UiToastItem.hostStyle()` for the resting state the animations hand back to.
 */
const stackTransform = (depth: number): string =>
  `translateY(${-depth * STACK_GAP}px) scale(${1 - depth * STACK_SCALE_STEP})`;

/**
 * A single toast in the stack. Owns its host `<view>` (styled/animated
 * directly), its auto-dismiss timer, and — when it's the front toast — its
 * drag-to-dismiss gesture. Emits `dismissed` once it has animated out so the
 * host can remove it from the queue.
 */
@Component({
  selector: 'ui-toast-item',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Styling + interaction live on the HOST element (a plain `view`, since the
  // custom tag falls back to one — see the separator component). Making the host
  // the card avoids an extra wrapper and lets absolute positioning + the stack
  // transform apply to the actual element. Only the front toast reacts to
  // taps/touches; behind toasts gate their handlers on isFront().
  host: {
    '[class]': 'cardClass()',
    '[style]': 'hostStyle()',
    '(bindtap)': 'onTap()',
    '(catchtouchstart)': 'onTouchStart($event)',
    '(catchtouchmove)': 'onTouchMove($event)',
    '(catchtouchend)': 'onTouchEnd()',
    '(catchtouchcancel)': 'onTouchEnd()',
  },
  template: `
    <view class="flex-1 flex-col gap-1 flex">
      @if (data().title) {
        <text [class]="titleClass()">{{ data().title }}</text>
      }
      @if (data().description) {
        <text [class]="descriptionClass()">{{ data().description }}</text>
      }
    </view>
    @if (data().action; as action) {
      <view [class]="actionClass()" (catchtap)="onAction()">
        <text [class]="actionTextClass()">{{ action.label }}</text>
      </view>
    }
  `,
})
export class UiToastItem implements OnInit {
  readonly data = input.required<ToastData>();
  // 0 = front (newest, interactive); higher = further back in the stack.
  readonly depth = input.required<number>();
  readonly dismissed = output<void>();

  // The host element itself — the card we position and animate.
  readonly #host = inject(ElementRef);
  #anim?: AnimationHandle;
  #dismissTimer: ReturnType<typeof setTimeout> | null = null;

  // Hidden until the entrance animation runs, so the toast doesn't flash at its
  // resting position for a frame before sliding/fading in.
  readonly #hasEntered = signal(false);

  // --- Drag-to-dismiss state (front toast only) ---
  protected readonly dragOffset = signal(0);
  #dragStartY = 0;
  #isDragging = false;
  // Guards dismiss() against re-entry: a tap and its touchend fire in an
  // unspecified order, and the timer can race both.
  #isDismissing = false;

  constructor() {
    // Restack: when a toast in front is dismissed (or a new one is pushed) this
    // toast's depth changes — animate it to its new slot. `effect` runs after
    // inputs are set, so the first run just records the starting depth.
    let prevDepth: number | null = null;
    effect(() => {
      const d = this.depth();
      if (prevDepth === null) {
        prevDepth = d;
        return;
      }
      if (d === prevDepth) return;
      const from = prevDepth;
      prevDepth = d;
      this.#animateRestack(from, d);
    });
  }

  ngOnInit(): void {
    // Start the auto-dismiss countdown when the toast mounts — i.e. when it is
    // promoted into the visible stack — so a queued toast doesn't expire while
    // hidden.
    this.#dismissTimer = setTimeout(() => this.dismiss(), this.data().duration);
    // Two-phase like the original toaster: wait a tick so the host view is
    // committed to Lynx's native tree before animating (animate() silently
    // no-ops on elements not yet flushed).
    setTimeout(() => this.#animateIn(), 0);
  }

  #isFront(): boolean {
    return this.depth() === 0;
  }

  // Resting state: docked to the bottom of UiToaster's stack container (which
  // owns the screen-edge inset and safe-area lift — see its style comment),
  // lifted/scaled into the stack slot, plus the live drag offset (front only).
  // Height is left to auto so the card grows with its content — this is why
  // the container gives absolutely-positioned children a *definite* (if
  // small) height to resolve `bottom` against: Lynx resolves an absolute
  // element's auto height against its containing block, so a collapsed block
  // squished the card (and its text).
  //
  // The entrance/restack/exit animations run via element.animate() and override
  // `transform`/`opacity` while they play (fill:'forwards'); canceling one (on
  // touchstart) hands control back to this style so the drag can move the toast.
  // `box-shadow` isn't animatable on Lynx, so it lives here and stays put.
  protected readonly hostStyle = computed(() => {
    const d = this.depth();
    const ty = this.dragOffset() - d * STACK_GAP;
    const scale = 1 - d * STACK_SCALE_STEP;
    // Subtle elevation, softening slightly with depth.
    const shadow = `0 ${6 - d}px ${16 - d * 3}px rgba(0, 0, 0, ${(0.15 - d * 0.03).toFixed(2)})`;
    return (
      // left/right (not width) set the width to fill the container; bottom
      // docks to its bottom edge (the container itself carries the safe-area
      // and screen-edge insets, so this is 0, not calc(...) + 1rem).
      `position: absolute; left: 0; right: 0; bottom: 0; z-index: ${100 - d};` +
      // Scale from the bottom edge so stacked toasts keep their base aligned and
      // recede upward — a cleaner fan than center-origin scaling.
      ` transform-origin: 50% 100%; transform: translateY(${ty}px) scale(${scale});` +
      ` box-shadow: ${shadow}; opacity: ${this.#hasEntered() ? 1 : 0};`
    );
  });

  protected readonly cardClass = computed(() => {
    const isDestructive = this.data().variant === 'destructive';
    // No `w-full`: the host is absolutely positioned and its width comes from
    // the left/right insets in hostStyle(); width:100% would fight `right` and
    // overflow the screen.
    return cn(
      'flex-row items-start gap-3 rounded-lg border p-4 flex',
      isDestructive
        ? 'border-destructive bg-destructive'
        : 'border-border bg-background',
    );
  });

  protected readonly titleClass = computed(() => {
    const isDestructive = this.data().variant === 'destructive';
    return cn(
      'text-sm font-semibold',
      isDestructive ? 'text-destructive-foreground' : 'text-foreground',
    );
  });

  protected readonly descriptionClass = computed(() => {
    const isDestructive = this.data().variant === 'destructive';
    return cn(
      'text-sm',
      isDestructive ? 'text-destructive-foreground' : 'text-muted-foreground',
    );
  });

  protected readonly actionClass = computed(() => {
    const isDestructive = this.data().variant === 'destructive';
    return cn(
      'items-center rounded-md border px-3 py-1.5 flex justify-center',
      isDestructive ? 'border-destructive-foreground' : 'border-border',
    );
  });

  protected readonly actionTextClass = computed(() => {
    const isDestructive = this.data().variant === 'destructive';
    return cn(
      'text-sm font-medium',
      isDestructive ? 'text-destructive-foreground' : 'text-foreground',
    );
  });

  protected onTap(): void {
    if (!this.#isFront()) return;
    this.dismiss();
  }

  protected onAction(): void {
    this.data().action?.onAction();
    this.dismiss();
  }

  /**
   * Begin a drag (front toast only). Cancel the current animation — its
   * fill:'forwards' pins the transform and would override the inline drag
   * offset — and pause the auto-dismiss timer so the toast can't vanish
   * mid-drag.
   */
  protected onTouchStart(e: {
    touches?: ReadonlyArray<{ clientY: number }>;
  }): void {
    if (!this.#isFront()) return;
    const y = e.touches?.[0]?.clientY;
    if (y == null) return;
    this.#anim?.cancel();
    if (this.#dismissTimer) {
      clearTimeout(this.#dismissTimer);
      this.#dismissTimer = null;
    }
    this.#isDragging = true;
    this.#dragStartY = y;
  }

  protected onTouchMove(e: {
    touches?: ReadonlyArray<{ clientY: number }>;
  }): void {
    if (!this.#isDragging) return;
    const y = e.touches?.[0]?.clientY;
    if (y == null) return;
    // Clamp to >= 0: the toast is docked at the bottom, so only a downward
    // (dismiss-direction) drag should move it.
    this.dragOffset.set(Math.max(0, y - this.#dragStartY));
  }

  /**
   * Release the drag. Past the threshold, dismiss (drag-aware exit). Otherwise
   * spring back and resume the auto-dismiss timer. The #isDismissing guard makes
   * this a no-op when a concurrent tap already started dismissing.
   */
  protected onTouchEnd(): void {
    if (!this.#isDragging) return;
    this.#isDragging = false;
    if (this.#isDismissing) return;
    if (this.dragOffset() > DISMISS_THRESHOLD) {
      this.dismiss();
    } else {
      this.#snapBack(this.dragOffset());
    }
  }

  /**
   * Dismiss this toast: animate out, then (after the animation) emit `dismissed`
   * so the host removes it from the queue. Removal is deferred until the
   * animation completes because there's no Angular `:leave` hook here — pulling
   * the node from `@for` immediately would cut the exit short.
   */
  dismiss(): void {
    if (this.#isDismissing) return;
    this.#isDismissing = true;
    if (this.#dismissTimer) {
      clearTimeout(this.#dismissTimer);
      this.#dismissTimer = null;
    }
    this.#animateOut();
    setTimeout(() => this.dismissed.emit(), DURATION.fast + 20);
  }

  #animateIn(): void {
    const el = this.#host.nativeElement;
    if (!el) return;
    this.#anim?.cancel();
    // Reveal now that the animation owns opacity (0 → 1 below); afterwards the
    // host style keeps it at 1. Without this the resting-position frame before
    // this runs would flash.
    this.#hasEntered.set(true);

    const d = this.depth();
    this.#anim =
      d === 0
        ? // Front: spring up from below the screen.
          el.animate(
            [
              { transform: 'translateY(100%) scale(0.95)', opacity: 0 },
              { transform: stackTransform(0), opacity: 1 },
            ],
            {
              duration: DURATION.slow,
              easing: EASING.spring,
              fill: 'forwards',
            },
          )
        : // Promoted from the queue straight into a back slot: fade/rise in place.
          el.animate(
            [
              {
                transform: `translateY(${-d * STACK_GAP + 8}px) scale(${(1 - d * STACK_SCALE_STEP) * 0.96})`,
                opacity: 0,
              },
              { transform: stackTransform(d), opacity: 1 },
            ],
            {
              duration: DURATION.normal,
              easing: EASING.decelerate,
              fill: 'forwards',
            },
          );
  }

  /**
   * Move to a new stack slot when depth changes (a toast in front popped, or a
   * new one pushed this one back). This is what makes the stack slide forward
   * when the front toast is dismissed.
   */
  #animateRestack(from: number, to: number): void {
    // A toast pushed while this one is animating out would shift its depth and
    // restack it back into view — let the exit win instead.
    if (this.#isDismissing) return;
    const el = this.#host.nativeElement;
    if (!el) return;
    this.#anim?.cancel();
    this.#anim = el.animate(
      [{ transform: stackTransform(from) }, { transform: stackTransform(to) }],
      { duration: DURATION.normal, easing: EASING.standard, fill: 'forwards' },
    );
  }

  #animateOut(): void {
    const el = this.#host.nativeElement;
    if (!el) return;
    this.#anim?.cancel();

    const d = this.depth();
    if (d === 0) {
      // Front: continue from the finger's offset (or 0) straight off the bottom.
      const from = this.dragOffset();
      this.#anim = el.animate(
        [
          { transform: `translateY(${from}px) scale(1)`, opacity: 1 },
          {
            transform: `translateY(${DISMISS_TRANSLATE}px) scale(0.95)`,
            opacity: 0,
          },
        ],
        {
          duration: DURATION.fast,
          easing: EASING.accelerate,
          fill: 'forwards',
        },
      );
    } else {
      // Behind: fade and shrink away in place (e.g. the oldest expiring at the
      // back), without sliding across the front toast.
      this.#anim = el.animate(
        [
          { transform: stackTransform(d), opacity: 1 },
          {
            transform: `translateY(${-d * STACK_GAP}px) scale(${(1 - d * STACK_SCALE_STEP) * 0.9})`,
            opacity: 0,
          },
        ],
        {
          duration: DURATION.fast,
          easing: EASING.accelerate,
          fill: 'forwards',
        },
      );
    }
  }

  /**
   * Release below the dismiss threshold: spring back to the front resting
   * position (px → 0px) and restart the auto-dismiss timer.
   */
  #snapBack(fromOffset: number): void {
    const el = this.#host.nativeElement;
    this.#anim?.cancel();
    if (el) {
      this.#anim = el.animate(
        [
          { transform: `translateY(${fromOffset}px) scale(1)` },
          { transform: 'translateY(0px) scale(1)' },
        ],
        { duration: DURATION.fast, easing: EASING.spring, fill: 'forwards' },
      );
    }
    // Match the inline transform to the animation's resting state so the two
    // agree once fill:'forwards' hands control back to the style binding.
    this.dragOffset.set(0);
    // Resume auto-dismiss from the full duration — the user interacted, so give
    // them the standard window to read it again.
    this.#dismissTimer = setTimeout(() => this.dismiss(), this.data().duration);
  }
}

/**
 * Stack host. Renders the newest `MAX_VISIBLE` toasts as an overlapping,
 * pseudo-3D stack (newest in front, older ones scaled down and shifted up).
 *
 * All per-toast behavior — entrance/exit/restack animation, the auto-dismiss
 * timer, and drag-to-dismiss — lives in `UiToastItem`, mirroring how the
 * accordion delegates per-item animation to a child component. This host only
 * decides which toasts are on screen and at what depth, and removes a toast from
 * the shared queue once its child has finished animating out.
 */
@Component({
  selector: 'ui-toaster',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiToastItem],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!--
      Deliberately NOT an <overlay>. The previous implementation wrapped the
      stack in <overlay> (needed a full-screen first child to avoid Lynx's
      "collapses to top-left" layout quirk — see the note below). Symptom:
      while ANY toast was visible, every tap and long-press anywhere else in
      the app — even a header button nowhere near the toast — silently did
      nothing, for the toast's entire lifetime (confirmed with an on-screen
      tap counter, since Lynx has no attachable console on-device).
      Root cause: <overlay> is Lynx's modal-flavored native construct — a real
      separate paint surface (a genuinely separate UIWindow on iOS unless
      mode="page" is set) with its own bespoke hit-testing
      (UIOverlay::OnNodeEvent / LynxOverlayContainer.hitTest on Harmony/iOS).
      That's correct for action-sheet/dialog/bottom-sheet, which SHOULD block
      the rest of the app. The toast is explicitly non-modal — the rest of the
      app must stay interactive while it's showing — so it had no business
      being built on a modal primitive at all.
      event-through (an inheritable per-view attribute honored by <overlay>'s
      hit-testing) looked like the fix and checked out against the native
      source on paper, but did not stop full-screen touch capture in testing;
      neither did also forcing mode="page" (which stops <overlay> from
      defaulting to a separate native window) — see
      investigations/lynx-vs-web-differences.md for the abandoned attempts.
      A plain view sidesteps the whole question: ordinary Lynx views are hit
      exactly where they're actually drawn, via the SAME hit-testing every
      other element in the app already relies on — no special attribute
      needed, nothing overlay-specific to get wrong.
      @if (not [attr.visible]) is safe here (unlike for <overlay>) because
      there's no live native window to orphan — that re-homing hazard is
      specific to <overlay> (see the "orphaned <overlay>" note in
      investigations/lynx-vs-web-differences.md).
    -->
    @if (hasToasts()) {
      <view [style]="stackContainerStyle">
        @for (t of visible(); track t.id; let i = $index) {
          <ui-toast-item
            [data]="t"
            [depth]="visible().length - 1 - i"
            (dismissed)="onDismissed(t.id)"
          />
        }
      </view>
    }
  `,
})
export class UiToaster {
  // Newest `MAX_VISIBLE`, in chronological order (last = newest = front).
  protected readonly visible = computed(() => toasts().slice(-MAX_VISIBLE));

  // Kept mounted as long as any toast exists. A dismissing toast stays in the
  // array until its child emits `dismissed` (after its exit animation), so
  // the container never unmounts mid-animation.
  protected readonly hasToasts = computed(() => toasts().length > 0);

  // position:fixed reparents this to the page root and positions it against
  // the full screen (Lynx-documented behavior), landing each toast card's
  // absolute left/right/bottom in the same place <overlay>'s backdrop did.
  // height is a small, explicit, DEFINITE value — not full-screen — so this
  // container only occupies real screen space near the toast stack, and
  // ordinary hit-testing naturally leaves the rest of the screen alone. It
  // exists solely so the absolutely-positioned cards inside have a definite
  // height to resolve `bottom: 0` against (an auto/collapsed height here
  // squishes them — see UiToastItem.hostStyle); it does not need to match
  // real toast content height, because `overflow: visible` lets both painting
  // and hit-testing extend past it for any card taller than this floor.
  protected readonly stackContainerStyle =
    'position: fixed; left: 1rem; right: 1rem; bottom: calc(env(safe-area-inset-bottom) + 1rem); overflow: visible; height: 8rem;';

  protected onDismissed(id: string): void {
    // Removing here (after the child's exit animation) drops the toast from the
    // stack; any queued toast then slides into the freed slot, and remaining
    // toasts restack forward via their depth-watching effect.
    dismissToast(id);
  }
}

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
import { type FormValueControl } from '@angular/forms/signals';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, shake } from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

@Component({
  selector: 'ui-textarea',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view #container [class]="containerClass()">
      @if (label()) {
        <text [class]="labelClass()">{{ label() }}</text>
      }
      <!-- The min/max height lives on this wrapper, not the textarea: a native
           Lynx textarea only auto-grows when it drives its container's height
           (via height:100% below). Pinning min/max-height on the textarea itself
           locks it to a fixed box that scrolls but never grows. -->
      <view [class]="textareaWrapperClass()" [style]="wrapperStyle()">
        <!-- Focus ring on its own overlay layer so it can fade (see input.ts for
             the full rationale): box-shadow is animatable:no on Lynx, opacity is,
             so we transition the layer's opacity. First child = painted behind
             the textarea on Lynx (strict source order). Source order alone is NOT
             enough on web: CSS paints a positioned (absolute) sibling above a
             static one regardless of source order, so this transparent overlay
             would swallow every tap — no focus, no typing. The textarea below
             carries position:relative + z-index:1 so it sits above the overlay on
             BOTH platforms (redundant on Lynx, required on web). No pointer-events
             (which errors the Lynx build). OUTSET only; Lynx doesn't render inset
             box-shadows. -->
        <view
          class="rounded-xl opacity-0 absolute bottom-0 left-0 right-0 top-0"
          [style.transition]="'opacity 150ms ease'"
          [style.box-shadow]="ringShadow()"
          [style.opacity]="ringVisible() ? 1 : 0"
        ></view>
        <!-- [attr.disabled]="disabled() || undefined": passing 'undefined'
             removes the attribute entirely; passing 'false' would set
             disabled="false" which Lynx still treats as disabled. -->
        <!-- [value] not [attr.value]: same reason as UiInput — routes through
             LynxTextarea.ngOnChanges so value changes call invoke("setValue")
             rather than the ineffective __SetAttribute path. -->
        <!-- [attr.enable-scroll-bar]: only surface the scrollbar once maxLines is
             set (i.e. the field can actually scroll). Native scrolling past
             max-height works regardless; this just shows the indicator.
             height:100% makes the textarea fill (and grow) the wrapper; the
             pinned line-height keeps the wrapper's line math exact. -->
        <!-- [attr.placeholder]: suppress the placeholder whenever a value is
             present. The browser hides a placeholder under a value automatically,
             but Lynx's iOS textarea renders the placeholder as a separate overlay
             view that only hides on textViewDidChange — so an initial value set via
             the setValue UIMethod leaves the placeholder stacked on top of it. Not
             emitting the attribute when there's a value matches web semantics and
             avoids the overlap on all platforms. -->
        <textarea
          [attr.placeholder]="value() ? null : placeholder()"
          [value]="value()"
          [attr.disabled]="disabled() || undefined"
          [attr.enable-scroll-bar]="maxLines() != null ? 'true' : null"
          class="text-sm text-foreground"
          style="border: none; background: transparent; height: 100%; width: 100%; line-height: 20px; position: relative; z-index: 1;"
          (bindinput)="onInput($any($event))"
          (bindfocus)="onFocus()"
          (bindblur)="onBlur()"
        ></textarea>
      </view>
      @if (error()) {
        <text [class]="errorClass()">{{ error() }}</text>
      } @else if (helperText()) {
        <text [class]="helperClass()">{{ helperText() }}</text>
      }
    </view>
  `,
})
export class UiTextarea implements FormValueControl<string> {
  readonly value = model<string>('');
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly helperText = input<string>('');
  readonly error = input<string>('');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  // SwiftUI-style lineLimit(min...max). The field opens at minLines, grows with
  // content, then stops at maxLines and scrolls internally. maxLines defaults to
  // undefined so the field grows unbounded (the previous behavior) unless capped.
  readonly minLines = input(3);
  readonly maxLines = input<number>();

  readonly changed = output<string>();
  readonly focused = output<void>();
  readonly blurred = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  readonly #isFocused = signal(false);
  #shakeAnim?: AnimationHandle;
  #previousError = '';

  constructor() {
    // Shake when an error first appears
    effect(() => {
      const err = this.error();
      const el = this.containerRef()?.nativeElement;
      if (err && !this.#previousError && el) {
        this.#shakeAnim?.cancel();
        this.#shakeAnim = shake(el);
      }
      this.#previousError = err;
    });
  }

  protected readonly containerClass = computed(() =>
    cn('flex-col gap-1.5 flex', this.userClass()),
  );

  protected readonly labelClass = computed(() =>
    cn('text-sm font-medium text-foreground'),
  );

  protected readonly textareaWrapperClass = computed(() =>
    cn(
      // No min-height here — the minimum is now enforced by the textarea's own
      // min-height (minLines) so callers can go below the old 3-line floor.
      'rounded-xl bg-muted px-3.5 py-2.5',
      this.disabled() && 'opacity-50',
    ),
  );

  /**
   * Focus ring, drawn as an OUTSET box-shadow on a dedicated overlay layer (see
   * the template comment, and input.ts for the full rationale). Two stacked
   * outset shadows: a solid 1px ring hugging the edge (reads as a crisp border)
   * and a softer 3px ring around it. Focus pairs var(--ring) with the translucent
   * var(--ring-subtle); error uses solid var(--destructive) for both. Always set
   * (never null) so the shadow stays painted while the layer fades out —
   * visibility is driven by ringVisible()/opacity. On its own layer (not folded
   * into wrapperStyle()) so the wrapper's whole-string [style] and this per-key
   * box-shadow never collide. Colors resolve at runtime and track dark mode.
   */
  protected readonly ringShadow = computed(() =>
    this.error()
      ? '0 0 0 1px var(--destructive), 0 0 0 3px var(--destructive)'
      : '0 0 0 1px var(--ring), 0 0 0 3px var(--ring-subtle)',
  );

  /**
   * Whether the focus ring is shown. The overlay's opacity transitions between 0
   * and 1 on this, fading the ring in/out (opacity is animatable on Lynx;
   * box-shadow is not). Shown while focused, or while an error is present.
   */
  protected readonly ringVisible = computed(
    () => this.#isFocused() || this.error() !== '',
  );

  // Sizing lives on the wrapper so the textarea (height:100%) grows it with
  // content between min and max, then scrolls at the cap — the native textarea
  // does not auto-grow on its own. The textarea's pinned line-height (20px, the
  // text-sm line box) makes N lines map to exactly N*20px, independent of
  // platform font metrics or Tailwind default drift. Lynx views are border-box,
  // so these heights include the wrapper's py-2.5 (20px) vertical padding.
  // maxLines is omitted when unset so the field keeps growing unbounded (the
  // previous default).
  protected readonly wrapperStyle = computed(() => {
    const lineHeight = 20;
    const verticalPadding = 20; // py-2.5 → 10px top + 10px bottom
    const max = this.maxLines();
    return [
      `min-height: ${this.minLines() * lineHeight + verticalPadding}px`,
      max != null ? `max-height: ${max * lineHeight + verticalPadding}px` : '',
    ]
      .filter(Boolean)
      .join('; ');
  });

  protected readonly helperClass = computed(() =>
    cn('text-xs text-muted-foreground'),
  );

  protected readonly errorClass = computed(() =>
    cn('text-xs text-destructive'),
  );

  protected onFocus(): void {
    this.#isFocused.set(true);
    this.focused.emit();
  }

  protected onBlur(): void {
    this.#isFocused.set(false);
    this.blurred.emit();
  }

  /**
   * Lynx input events carry the updated value in `event.detail.value`,
   * not in `event.target.value` as on the web — hence the custom type.
   */
  protected onInput(event: { detail: { value: string } }): void {
    if (this.disabled()) return;
    this.value.set(event.detail.value);
    this.changed.emit(event.detail.value);
  }
}

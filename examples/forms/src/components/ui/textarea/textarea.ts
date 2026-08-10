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
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view #container [class]="containerClass()">
      @if (label()) {
        <text [class]="labelClass()">{{ label() }}</text>
      }
      <!-- Focus ring on its own overlay layer so it can fade (see input.ts for
           the full rationale): box-shadow is animatable:no on Lynx, opacity is,
           so we transition the layer's opacity. First child = painted behind the
           textarea on Lynx (strict source order). Source order alone is NOT enough
           on web: CSS paints a positioned (absolute) sibling above a static one
           regardless of source order, so this transparent overlay would swallow
           every tap — no focus, no typing. The textarea below carries
           position:relative + z-index:1 so it sits above the overlay on BOTH
           platforms (redundant on Lynx, required on web). No pointer-events (which
           errors the Lynx build). OUTSET only; Lynx doesn't render inset
           box-shadows. -->
      <view [class]="textareaWrapperClass()">
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
        <textarea
          [attr.placeholder]="placeholder()"
          [value]="value()"
          [attr.disabled]="disabled() || undefined"
          class="text-sm text-foreground"
          style="border: none; background: transparent; height: 100%; width: 100%; position: relative; z-index: 1;"
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
      'min-h-20 rounded-xl bg-muted px-3.5 py-2.5',
      this.disabled() && 'opacity-50',
    ),
  );

  /**
   * Focus ring, drawn as an OUTSET box-shadow on a dedicated overlay layer (see
   * the template comment, and input.ts for the full rationale). Two stacked
   * outset shadows: a solid 1px ring hugging the edge (reads as a crisp border)
   * and a softer 3px ring around it — both follow the wrapper's rounded-xl
   * corners. Focus pairs var(--ring) with the translucent var(--ring-subtle);
   * error uses solid var(--destructive) for both. The value is always set (never
   * null) so the shadow stays painted while the layer fades OUT — visibility is
   * driven by ringVisible()/opacity. Colors resolve at runtime and track dark
   * mode.
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

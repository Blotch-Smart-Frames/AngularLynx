import {
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { type FormValueControl } from '@angular/forms/signals';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, shake } from '../../utils/animate';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-input',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // The host is the field's column. Angular gives a component's host every
  // static attribute the app writes on it, so a class on <ui-input> lands
  // there whatever the component does: a column inside the host applied it
  // twice. A placeholder lands there too, and goes: it belongs to the
  // <input>, and a second element with it is a second match for
  // getByPlaceholderText.
  host: {
    '[class]': 'containerClass()',
    '[attr.placeholder]': 'null',
  },
  template: `
    <!-- The <input> below carries the label as its accessibility-label, so
         screen readers read it with the field. Hidden here, or VoiceOver and
         TalkBack would stop on it a second time. -->
    @if (label()) {
      <text [class]="labelClass()" accessibility-elements-hidden="true">{{
        label()
      }}</text>
    }
    <!-- Focus ring is an inline box-shadow on a dedicated overlay layer, not a
         Tailwind ring-* class (the Lynx preset doesn't wire up --tw-ring-*, so
         ring-* renders nothing on device). It rides its OWN layer so it can
         fade: box-shadow is animatable:no on Lynx (the core rejects a
         transition: box-shadow), but opacity is animatable, so we transition
         the layer's opacity instead. The overlay is the FIRST child so Lynx,
         which paints in strict source order, keeps the <input> on top and
         tappable. Source order alone is NOT enough on web: CSS paints a
         positioned (absolute) sibling above a static one regardless of source
         order, so this transparent overlay would swallow every tap — no focus,
         no typing. The <input> below therefore carries position:relative +
         z-index:1 so it sits above the overlay on BOTH platforms (required on
         web). On Lynx, though, a z-indexed element is stacked against its
         nearest stacking context, and a scroll-view isn't one unless it sets
         z-index itself — so the native input would stay fixed on screen while
         the page scrolled (only its placeholder visibly floats). The wrapper's
         z-0 makes it that stacking context, keeping the input's z-index local
         so it scrolls with the field. pointer-events is avoided — it errors
         the Lynx build. The shadow is OUTSET only: Lynx doesn't render inset box-shadows,
         so the crisp 1px "border" is an outset ring hugging the edge, not a
         real inset border. -->
    <view [class]="inputWrapperClass()">
      <view
        class="rounded-xl opacity-0 absolute bottom-0 left-0 right-0 top-0"
        [style.transition]="'opacity 150ms ease'"
        [style.box-shadow]="ringShadow()"
        [style.opacity]="ringVisible() ? 1 : 0"
      ></view>
      <!-- [attr.disabled]="disabled() || undefined": passing 'undefined'
           removes the attribute entirely; passing 'false' would set
           disabled="false" which Lynx still treats as disabled. -->
      <!-- [value] not [attr.value]: [attr.value] calls renderer.setAttribute()
           which routes to __SetAttribute — a no-op for live text on Lynx native
           inputs. [value] is an Angular input binding that triggers
           LynxInput.ngOnChanges, where the setValue UIMethod override lives.
           Without this, form model resets would update the signal but the
           native input would keep showing the user's old typed text. -->
      <!-- accessibility-element: on iOS, Lynx makes only <text> and <image>
           accessibility elements by default, so the UITextField under an
           <input> isn't one. VoiceOver then read the placeholder inside it,
           or nothing once it held text. As one, it reads its
           accessibility-label, the label, then its text. -->
      <input
        accessibility-element="true"
        [attr.accessibility-label]="label() || null"
        [attr.placeholder]="placeholder()"
        [attr.type]="type()"
        [value]="value()"
        [attr.disabled]="disabled() || undefined"
        class="text-sm text-foreground"
        style="border: none; background: transparent; height: 100%; width: 100%; position: relative; z-index: 1;"
        (bindinput)="onInput($any($event))"
        (bindfocus)="onFocus()"
        (bindblur)="onBlur()"
      />
    </view>
    @if (error()) {
      <text [class]="errorClass()">{{ error() }}</text>
    } @else if (helperText()) {
      <text [class]="helperClass()">{{ helperText() }}</text>
    }
  `,
})
export class UiInput implements FormValueControl<string> {
  readonly value = model<string>('');
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly type = input<string>('text');
  readonly helperText = input<string>('');
  readonly error = input<string>('');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<string>();
  readonly focused = output<void>();
  readonly blurred = output<void>();
  /**
   * The field lost focus, for forms, which mark it as touched as they do a
   * native input (FormUiControl's `touch`). Signal Forms, reactive forms and
   * template-driven forms all listen for it; a `touched` model's change
   * isn't read by any of them.
   */
  readonly touch = output<void>();

  readonly #host = inject(ElementRef).nativeElement;
  readonly #isFocused = signal(false);
  #shakeAnim?: AnimationHandle;
  #previousError = '';

  /**
   * Shakes the field when an error appears (a change from no error to one). A
   * field rather than a constructor: Angular's test build keeps a function for
   * a constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   */
  protected readonly shakeOnError = effect(() => {
    const err = this.error();
    if (err && !this.#previousError) {
      this.#shakeAnim?.cancel();
      this.#shakeAnim = shake(this.#host);
    }
    this.#previousError = err;
  });

  protected readonly containerClass = computed(() =>
    cn('flex-col gap-1.5 flex', this.userClass()),
  );

  protected readonly labelClass = computed(() =>
    cn('text-sm font-medium text-foreground'),
  );

  protected readonly inputWrapperClass = computed(() =>
    // z-0: stacking context for the input's z-index (see the template comment).
    cn(
      'z-0 h-10 rounded-xl bg-muted px-3.5 py-2',
      this.disabled() && 'opacity-50',
    ),
  );

  /**
   * Focus ring, drawn as an OUTSET box-shadow on a dedicated overlay layer (see
   * the template comment for why it can't be a Tailwind ring-* class and why it
   * needs its own layer). Two stacked outset shadows: a solid 1px ring hugging
   * the edge (reads as a crisp border) and a softer 3px ring around it — both
   * follow the wrapper's rounded-xl corners. Focus pairs var(--ring) with the
   * translucent var(--ring-subtle); error uses solid var(--destructive) for both
   * since it flags a problem. The value is always set (never null) so the shadow
   * stays painted while the layer fades OUT — visibility is driven by
   * ringVisible()/opacity, not by adding/removing the shadow. Colors resolve at
   * runtime and track dark mode.
   */
  protected readonly ringShadow = computed(() =>
    this.error()
      ? '0 0 0 1px var(--destructive), 0 0 0 3px var(--destructive)'
      : '0 0 0 1px var(--ring), 0 0 0 3px var(--ring-subtle)',
  );

  /**
   * Whether the focus ring is shown. The overlay's opacity transitions between 0
   * and 1 on this, fading the ring in/out (opacity is animatable on Lynx;
   * box-shadow is not). Shown while focused, or while an error is present so an
   * invalid field always carries the destructive ring.
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
    this.touch.emit();
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

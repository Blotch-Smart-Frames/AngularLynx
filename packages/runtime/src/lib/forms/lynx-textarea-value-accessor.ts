import {
  Directive,
  ElementRef,
  Renderer2,
  forwardRef,
  inject,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * ControlValueAccessor for <textarea> elements. Bridges Angular's form model
 * (reactive forms, template-driven NgModel, Signal Forms [formField]) to Lynx's
 * native events (bindinput, bindblur) instead of the standard DOM input/change events.
 *
 * Activated only when a form directive is present (formControl, formControlName,
 * ngModel, or formField) — bare <textarea> elements continue to use LynxTextarea alone.
 */
@Directive({
  selector:
    'textarea[formControlName],textarea[formControl],textarea[ngModel],textarea[formField]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LynxTextareaValueAccessor),
      multi: true,
    },
  ],
  host: {
    // host bindings call renderer.listen() — the correct Lynx event path.
    // @Output() would break delivery (template compiler intercepts it).
    '(bindinput)': 'onInput($event)',
    '(bindblur)': 'onBlur()',
  },
})
export class LynxTextareaValueAccessor implements ControlValueAccessor {
  readonly #renderer = inject(Renderer2);
  readonly #el = inject(ElementRef);
  #onChange: (value: string) => void = () => {};
  #onTouched: () => void = () => {};

  onInput(event: Event): void {
    // Lynx bindinput carries the typed value in event.detail.value, not event.target.value.
    this.#onChange(
      (event as CustomEvent<{ value: string }>).detail?.value ?? '',
    );
  }

  onBlur(): void {
    this.#onTouched();
  }

  writeValue(value: string): void {
    // Same root cause as LynxInputValueAccessor: LynxUIBaseInput (the shared
    // native base class for both input and textarea on Android/iOS) has no
    // @LynxProp handler for "value", so __SetAttribute is silently ignored
    // after the user has typed. invoke?.() calls __InvokeUIMethod("setValue")
    // which is the correct path for programmatic text updates.
    this.#el.nativeElement.invoke?.('setValue', { value: value ?? '' });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.#onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.#onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) {
      this.#renderer.setAttribute(this.#el.nativeElement, 'disabled', 'true');
    } else {
      this.#renderer.removeAttribute(this.#el.nativeElement, 'disabled');
    }
  }
}

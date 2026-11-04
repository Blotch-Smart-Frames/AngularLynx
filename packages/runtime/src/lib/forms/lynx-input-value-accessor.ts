import {
  Directive,
  ElementRef,
  Renderer2,
  forwardRef,
  inject,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import type { InputDetail } from '../types/element-events';
import type { LynxEvent } from '../types/lynx-event';

/**
 * ControlValueAccessor for <input> elements. Bridges Angular's form model
 * (reactive forms, template-driven NgModel, Signal Forms [formField]) to Lynx's
 * native events (bindinput, bindblur) instead of the standard DOM input/change events.
 *
 * Activated only when a form directive is present (formControl, formControlName,
 * ngModel, or formField) — bare <input> elements continue to use LynxInput alone.
 */
@Directive({
  selector:
    'input[formControlName],input[formControl],input[ngModel],input[formField]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      /* v8 ignore next -- Angular metadata: the forwardRef arrow is only invoked by Angular's directive DI resolution, which happens inside a full template render — the accessor's runtime behavior is covered by direct unit tests below. */
      useExisting: forwardRef(() => LynxInputValueAccessor),
      multi: true,
    },
  ],
  host: {
    // Host listeners go through renderer.listen(), Lynx's event path.
    '(bindinput)': 'onInput($event)',
    '(bindblur)': 'onBlur()',
  },
})
export class LynxInputValueAccessor implements ControlValueAccessor {
  readonly #renderer = inject(Renderer2);
  readonly #el = inject(ElementRef);
  #onChange: (value: string) => void = () => {};
  #onTouched: () => void = () => {};

  onInput(event: LynxEvent<InputDetail>): void {
    // Lynx bindinput carries the typed value in event.detail.value, not
    // event.target.value. A test can fire the event with no detail, which
    // shouldn't throw, hence the `?.`.
    this.#onChange(event.detail?.value ?? '');
  }

  onBlur(): void {
    this.#onTouched();
  }

  writeValue(value: string): void {
    // __SetAttribute("value", ...) is a no-op on Lynx native inputs: the
    // Android/iOS LynxUIBaseInput class has no @LynxProp handler for "value",
    // so attribute changes after the user has typed are silently ignored by the
    // native layer. Without this fix, reactive-form resets (e.g. form.reset())
    // would update the Angular model but leave the native input showing stale text.
    // invoke() routes to __InvokeUIMethod("setValue", {value}), which is the
    // only supported path for programmatic text updates.
    this.#el.nativeElement.invoke('setValue', { value: value ?? '' });
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

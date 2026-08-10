import {
  Directive,
  ElementRef,
  inject,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';
import { LynxElementBase } from './base';

/**
 * Single-line text input field.
 */
@Directive({
  selector: 'input',
  standalone: true,
  inputs: [
    'type',
    'placeholder',
    'value',
    'maxlength',
    'readonly',
    'disabled',
    'confirm-type',
    'input-filter',
    'show-soft-input-on-focus',
    'ios-auto-correct',
    'ios-spell-check',
    'android-fullscreen-mode',
  ],
})
export class LynxInput extends LynxElementBase {
  // Injected separately from LynxElementBase.#el because ES private fields
  // are scoped to the declaring class — the subclass cannot access the parent's
  // #el directly. Both fields resolve to the same LynxElement instance at runtime.
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;

  override ngOnChanges(changes: SimpleChanges): void {
    if ('value' in changes) {
      // __SetAttribute("value", ...) is a no-op for a Lynx native input once
      // the user has typed into it. LynxUIBaseInput on both Android and iOS
      // registers no @LynxProp handler for "value", so attribute mutations never
      // reach the native text field. The only supported path is the setValue
      // UIMethod (__InvokeUIMethod("setValue", {value})).
      //
      // invoke? is an optional call: on the background thread (testing library)
      // LynxBackgroundElement doesn't implement invoke, so it becomes a no-op
      // there, which is correct — UIMethod calls are main-thread only.
      //
      // We strip "value" from the changes object before forwarding to the base
      // class so that super.ngOnChanges doesn't also call setAttribute("value"),
      // which would be redundant and would not work anyway.
      this.#el.invoke?.('setValue', {
        value: changes['value'].currentValue ?? '',
      });
      const { value: _ignored, ...rest } = changes;
      if (Object.keys(rest).length) super.ngOnChanges(rest);
    } else {
      super.ngOnChanges(changes);
    }
  }

  /**
   * Keyboard type shown when this input gains focus.
   */
  type?: 'text' | 'number' | 'digit' | 'password' | 'tel' | 'email';
  /**
   * Greyed-out hint text shown when the field is empty.
   */
  placeholder?: string;
  /**
   * Current value of the field.
   */
  value?: string;
  /**
   * Maximum character count (-1 = unlimited).
   */
  maxlength?: number;
  /**
   * Whether the field is read-only.
   */
  readonly?: boolean;
  /**
   * Whether the field and keyboard are disabled.
   */
  disabled?: boolean;
  /**
   * Label for the soft-keyboard confirm button. @default 'done'
   */
  'confirm-type'?: 'search' | 'send' | 'go' | 'done' | 'next';
  /**
   * Input character whitelist — a regular expression pattern string.
   */
  'input-filter'?: string;
  /**
   * Whether tapping the field shows the soft keyboard. @default true
   */
  'show-soft-input-on-focus'?: boolean;
  /**
   * Enable auto-correction on iOS.
   */
  'ios-auto-correct'?: boolean;
  /**
   * Enable spell-checking on iOS.
   */
  'ios-spell-check'?: boolean;
  /**
   * Enter full-screen editing mode on Android.
   */
  'android-fullscreen-mode'?: boolean;
}

/**
 * Multi-line text input field.
 */
@Directive({
  selector: 'textarea',
  standalone: true,
  inputs: [
    'type',
    'placeholder',
    'value',
    'maxlength',
    'maxlines',
    'line-spacing',
    'readonly',
    'disabled',
    'confirm-type',
    'input-filter',
    'show-soft-input-on-focus',
    'bounces',
    'enable-scroll-bar',
    'ios-auto-correct',
    'ios-spell-check',
    'android-fullscreen-mode',
  ],
})
export class LynxTextarea extends LynxElementBase {
  // Same reason as LynxInput.#el — ES private field scoping requires a
  // separate injection even though both resolve to the same element instance.
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;

  override ngOnChanges(changes: SimpleChanges): void {
    if ('value' in changes) {
      // LynxTextarea shares LynxUIBaseInput as its native base class on both
      // Android and iOS, so it has the same limitation: no @LynxProp for
      // "value", making __SetAttribute a no-op for live text updates.
      // The setValue UIMethod is required here for the same reason as LynxInput.
      this.#el.invoke?.('setValue', {
        value: changes['value'].currentValue ?? '',
      });
      const { value: _ignored, ...rest } = changes;
      if (Object.keys(rest).length) super.ngOnChanges(rest);
    } else {
      super.ngOnChanges(changes);
    }
  }

  type?: 'text' | 'number' | 'digit' | 'tel' | 'email';
  placeholder?: string;
  value?: string;
  maxlength?: number;
  /**
   * Maximum number of visible lines.
   */
  maxlines?: number;
  /**
   * Extra spacing between lines in px.
   */
  'line-spacing'?: number;
  readonly?: boolean;
  disabled?: boolean;
  'confirm-type'?: 'search' | 'send' | 'go' | 'done' | 'next';
  'input-filter'?: string;
  'show-soft-input-on-focus'?: boolean;
  bounces?: boolean;
  'enable-scroll-bar'?: boolean;
  'ios-auto-correct'?: boolean;
  'ios-spell-check'?: boolean;
  'android-fullscreen-mode'?: boolean;
}

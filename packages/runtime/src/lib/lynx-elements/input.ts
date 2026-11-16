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
    'default-value',
  ],
})
export class LynxInput extends LynxElementBase {
  // Injected separately from LynxElementBase.#el because ES private fields
  // are scoped to the declaring class — the subclass cannot access the parent's
  // #el directly. Both fields resolve to the same LynxElement instance at runtime.
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;

  override ngOnChanges(changes: SimpleChanges): void {
    const { value, ...rest } = changes;
    // A field's text isn't an attribute in Lynx: XElement's LynxUIBaseInput
    // registers no prop for "value" on Android or iOS, so __SetAttribute
    // would do nothing. Set as the DOM property, it reaches the field
    // whether native has made its UI yet or not (see LynxElement's
    // setProperty).
    if (value) this.#el.setProperty('value', value.currentValue);
    if (Object.keys(rest).length) super.ngOnChanges(rest);
  }

  /**
   * Keyboard type shown when this input gains focus.
   */
  declare type?: 'text' | 'number' | 'digit' | 'password' | 'tel' | 'email';
  /**
   * Greyed-out hint text shown when the field is empty.
   */
  declare placeholder?: string;
  /**
   * The text the field shows, from its first render, as the DOM's `value`
   * property. Changing it doesn't move the caret when the field has the
   * text already, such as a model bound back to it.
   */
  declare value?: string;
  /**
   * Maximum character count (-1 = unlimited).
   */
  declare maxlength?: number;
  /**
   * Whether the field is read-only.
   */
  declare readonly?: boolean;
  /**
   * Whether the field and keyboard are disabled.
   */
  declare disabled?: boolean;
  /**
   * Label for the soft-keyboard confirm button. @default 'done'
   */
  declare 'confirm-type'?: 'search' | 'send' | 'go' | 'done' | 'next';
  /**
   * Input character whitelist — a regular expression pattern string.
   */
  declare 'input-filter'?: string;
  /**
   * Whether tapping the field shows the soft keyboard. @default true
   */
  declare 'show-soft-input-on-focus'?: boolean;
  /**
   * Enable auto-correction on iOS.
   */
  declare 'ios-auto-correct'?: boolean;
  /**
   * Enable spell-checking on iOS.
   */
  declare 'ios-spell-check'?: boolean;
  /**
   * Enter full-screen editing mode on Android.
   */
  declare 'android-fullscreen-mode'?: boolean;
  /**
   * Initial content. Applied on first render only and doesn't fire `bindinput`.
   * Prefer `value` (or a form control) when the text must stay in sync.
   */
  declare 'default-value'?: string;
}

/**
 * Multi-line text input field.
 */
@Directive({
  selector: 'textarea',
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
    'default-value',
  ],
})
export class LynxTextarea extends LynxElementBase {
  // Same reason as LynxInput.#el — ES private field scoping requires a
  // separate injection even though both resolve to the same element instance.
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;

  override ngOnChanges(changes: SimpleChanges): void {
    const { value, ...rest } = changes;
    // As LynxInput: LynxTextarea shares LynxUIBaseInput as its native base
    // class on both Android and iOS.
    if (value) this.#el.setProperty('value', value.currentValue);
    if (Object.keys(rest).length) super.ngOnChanges(rest);
  }

  declare type?: 'text' | 'number' | 'digit' | 'tel' | 'email';
  declare placeholder?: string;
  declare value?: string;
  declare maxlength?: number;
  /**
   * Maximum number of visible lines.
   */
  declare maxlines?: number;
  /**
   * Extra spacing between lines in px.
   */
  declare 'line-spacing'?: number;
  declare readonly?: boolean;
  declare disabled?: boolean;
  declare 'confirm-type'?: 'search' | 'send' | 'go' | 'done' | 'next';
  declare 'input-filter'?: string;
  declare 'show-soft-input-on-focus'?: boolean;
  declare bounces?: boolean;
  declare 'enable-scroll-bar'?: boolean;
  declare 'ios-auto-correct'?: boolean;
  declare 'ios-spell-check'?: boolean;
  declare 'android-fullscreen-mode'?: boolean;
  /**
   * Initial content. Applied on first render only and doesn't fire `bindinput`.
   * Prefer `value` (or a form control) when the text must stay in sync.
   */
  declare 'default-value'?: string;
}

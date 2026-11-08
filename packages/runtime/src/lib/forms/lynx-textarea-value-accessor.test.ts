// @vitest-environment jsdom
//
// Mirrors lynx-input-value-accessor.test.ts exactly: LynxTextareaValueAccessor
// is a near-duplicate implementation (shares LynxUIBaseInput as its native
// base class), so it needs the same coverage of every branch.
import '@angular/compiler';
import { ElementRef, Renderer2 } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputDetail } from '../types/element-events';
import type { LynxEvent } from '../types/lynx-event';
import { LynxTextareaValueAccessor } from './lynx-textarea-value-accessor';

/**
 * The fields the accessor reads from Lynx's bindinput event.
 */
const inputEvent = (value: string) =>
  ({ detail: { value } }) as LynxEvent<InputDetail>;

describe('LynxTextareaValueAccessor', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  let renderer: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    setProperty: ReturnType<typeof vi.fn>;
  };
  let nativeElement: { invoke?: ReturnType<typeof vi.fn> };

  const configure = (): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Renderer2, useValue: renderer },
        { provide: ElementRef, useValue: { nativeElement } },
      ],
    });
  };

  beforeEach(() => {
    renderer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      setProperty: vi.fn(),
    };
    nativeElement = { invoke: vi.fn() };
    configure();
  });

  it('reads the typed value from event.detail.value and forwards it to onChange', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );
    const onChange = vi.fn();
    dir.registerOnChange(onChange);

    dir.onInput(inputEvent('hi'));

    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('defaults to an empty string when the event carries no detail', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );
    const onChange = vi.fn();
    dir.registerOnChange(onChange);

    dir.onInput({} as LynxEvent<InputDetail>);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('registerOnChange wires the callback that onInput invokes', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );
    const onChange = vi.fn();

    expect(() => dir.onInput({} as LynxEvent<InputDetail>)).not.toThrow();

    dir.registerOnChange(onChange);
    dir.onInput(inputEvent('x'));

    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('registerOnTouched wires the callback that onBlur invokes', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );
    const onTouched = vi.fn();

    expect(() => dir.onBlur()).not.toThrow();

    dir.registerOnTouched(onTouched);
    dir.onBlur();

    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it("writeValue sets the field's value property through the renderer", () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );

    dir.writeValue('v');

    // A property, as Angular's DefaultValueAccessor sets a DOM field's: the
    // element turns it into the field's text (see LynxElement's setProperty).
    expect(renderer.setProperty).toHaveBeenCalledWith(
      nativeElement,
      'value',
      'v',
    );
  });

  it('writeValue defaults a null/undefined value to an empty string', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );

    dir.writeValue(null as unknown as string);

    expect(renderer.setProperty).toHaveBeenCalledWith(
      nativeElement,
      'value',
      '',
    );
  });

  it('setDisabledState(true) sets the disabled attribute via the renderer', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );

    dir.setDisabledState(true);

    expect(renderer.setAttribute).toHaveBeenCalledWith(
      nativeElement,
      'disabled',
      'true',
    );
    expect(renderer.removeAttribute).not.toHaveBeenCalled();
  });

  it('setDisabledState(false) removes the disabled attribute via the renderer', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxTextareaValueAccessor(),
    );

    dir.setDisabledState(false);

    expect(renderer.removeAttribute).toHaveBeenCalledWith(
      nativeElement,
      'disabled',
    );
    expect(renderer.setAttribute).not.toHaveBeenCalled();
  });
});

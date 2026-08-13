// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, Renderer2 } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxInputValueAccessor } from './lynx-input-value-accessor';

describe('LynxInputValueAccessor', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  let renderer: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
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
    renderer = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    nativeElement = { invoke: vi.fn() };
    configure();
  });

  it('reads the typed value from event.detail.value and forwards it to onChange', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );
    const onChange = vi.fn();
    dir.registerOnChange(onChange);

    dir.onInput(new CustomEvent('bindinput', { detail: { value: 'hi' } }));

    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('defaults to an empty string when the event carries no detail', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );
    const onChange = vi.fn();
    dir.registerOnChange(onChange);

    dir.onInput({} as Event);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('registerOnChange wires the callback that onInput invokes', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );
    const onChange = vi.fn();

    // Before registration, onInput must not throw (default no-op onChange).
    expect(() => dir.onInput({} as Event)).not.toThrow();

    dir.registerOnChange(onChange);
    dir.onInput(new CustomEvent('bindinput', { detail: { value: 'x' } }));

    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('registerOnTouched wires the callback that onBlur invokes', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );
    const onTouched = vi.fn();

    expect(() => dir.onBlur()).not.toThrow();

    dir.registerOnTouched(onTouched);
    dir.onBlur();

    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it('writeValue invokes the native setValue UIMethod with the given value', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );

    dir.writeValue('v');

    expect(nativeElement.invoke).toHaveBeenCalledWith('setValue', {
      value: 'v',
    });
  });

  it('writeValue defaults a null/undefined value to an empty string', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );

    dir.writeValue(null as unknown as string);

    expect(nativeElement.invoke).toHaveBeenCalledWith('setValue', {
      value: '',
    });
  });

  it('writeValue does not throw when invoke is unavailable (background thread)', () => {
    nativeElement = {};
    configure();
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
    );

    expect(() => dir.writeValue('anything')).not.toThrow();
  });

  it('setDisabledState(true) sets the disabled attribute via the renderer', () => {
    const dir = TestBed.runInInjectionContext(
      () => new LynxInputValueAccessor(),
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
      () => new LynxInputValueAccessor(),
    );

    dir.setDisabledState(false);

    expect(renderer.removeAttribute).toHaveBeenCalledWith(
      nativeElement,
      'disabled',
    );
    expect(renderer.setAttribute).not.toHaveBeenCalled();
  });
});

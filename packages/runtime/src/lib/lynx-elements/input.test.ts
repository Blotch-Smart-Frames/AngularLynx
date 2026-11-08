// @vitest-environment jsdom
import '@angular/compiler';
import {
  ElementRef,
  type SimpleChange,
  type SimpleChanges,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxInput, LynxTextarea } from './input';

const change = (currentValue: unknown): SimpleChange =>
  ({
    currentValue,
    previousValue: undefined,
    firstChange: true,
    isFirstChange: () => true,
  }) as SimpleChange;

// initTestEnvironment must run exactly once per file — nesting it inside
// describe.each's beforeAll would call it once per case and throw ("base
// providers already set"), so it lives in an outer beforeAll instead.
beforeAll(() => {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

describe.each([
  { name: 'LynxInput', Cls: LynxInput },
  { name: 'LynxTextarea', Cls: LynxTextarea },
])('$name', ({ Cls }) => {
  let fakeEl: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    setProperty: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    fakeEl = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      setProperty: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: { nativeElement: fakeEl } }],
    });
  });

  it("sets a value-only change as the field's value property, not an attribute", () => {
    const dir = TestBed.runInInjectionContext(() => new Cls());
    const changes: SimpleChanges = { value: change('hello') };

    dir.ngOnChanges(changes);

    // The element turns it into the field's text (see LynxElement's
    // setProperty): Lynx fields have no attribute for it.
    expect(fakeEl.setProperty).toHaveBeenCalledWith('value', 'hello');
    expect(fakeEl.setAttribute).not.toHaveBeenCalled();
    expect(fakeEl.removeAttribute).not.toHaveBeenCalled();
  });

  it('passes a null value on for the element to turn into no text', () => {
    const dir = TestBed.runInInjectionContext(() => new Cls());
    const changes: SimpleChanges = { value: change(null) };

    dir.ngOnChanges(changes);

    expect(fakeEl.setProperty).toHaveBeenCalledWith('value', null);
    expect(fakeEl.removeAttribute).not.toHaveBeenCalled();
  });

  it('forwards other keys to the base class while still setting the value', () => {
    const dir = TestBed.runInInjectionContext(() => new Cls());
    const changes: SimpleChanges = {
      value: change('hi'),
      placeholder: change('type here'),
    };

    dir.ngOnChanges(changes);

    expect(fakeEl.setProperty).toHaveBeenCalledWith('value', 'hi');
    expect(fakeEl.setAttribute).toHaveBeenCalledWith(
      'placeholder',
      'type here',
    );
    // "value" itself must never reach setAttribute — it's stripped before super call.
    expect(fakeEl.setAttribute).not.toHaveBeenCalledWith(
      'value',
      expect.anything(),
    );
  });

  it('uses the base setAttribute/removeAttribute path when "value" is absent', () => {
    const dir = TestBed.runInInjectionContext(() => new Cls());
    const changes: SimpleChanges = {
      disabled: change(true),
      readonly: change(null),
    };

    dir.ngOnChanges(changes);

    expect(fakeEl.setProperty).not.toHaveBeenCalled();
    expect(fakeEl.setAttribute).toHaveBeenCalledWith('disabled', true);
    expect(fakeEl.removeAttribute).toHaveBeenCalledWith('readonly');
  });
});

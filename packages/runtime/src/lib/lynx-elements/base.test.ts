// @vitest-environment jsdom
import '@angular/compiler';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  type SimpleChange,
  type SimpleChanges,
  ɵgetDirectiveDef as getDirectiveDef,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { By } from '@angular/platform-browser';
import { LynxElementBase, templateAttributeValue } from './base';
import { LynxText } from './text';

describe('LynxElementBase', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  let fakeEl: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    fakeEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: { nativeElement: fakeEl } }],
    });
  });

  const change = (currentValue: unknown): SimpleChange =>
    ({
      currentValue,
      previousValue: undefined,
      firstChange: true,
      isFirstChange: () => true,
    }) as SimpleChange;

  it('forwards a non-null currentValue to setAttribute', () => {
    const dir = TestBed.runInInjectionContext(() => new LynxElementBase());
    const changes: SimpleChanges = { id: change('foo') };

    dir.ngOnChanges(changes);

    expect(fakeEl.setAttribute).toHaveBeenCalledWith('id', 'foo');
    expect(fakeEl.removeAttribute).not.toHaveBeenCalled();
  });

  it('calls removeAttribute when currentValue is null', () => {
    const dir = TestBed.runInInjectionContext(() => new LynxElementBase());
    const changes: SimpleChanges = { name: change(null) };

    dir.ngOnChanges(changes);

    expect(fakeEl.removeAttribute).toHaveBeenCalledWith('name');
    expect(fakeEl.setAttribute).not.toHaveBeenCalled();
  });

  it('calls removeAttribute when currentValue is undefined', () => {
    const dir = TestBed.runInInjectionContext(() => new LynxElementBase());
    const changes: SimpleChanges = { name: change(undefined) };

    dir.ngOnChanges(changes);

    expect(fakeEl.removeAttribute).toHaveBeenCalledWith('name');
    expect(fakeEl.setAttribute).not.toHaveBeenCalled();
  });

  it('processes multiple keys in a single call, each on its own branch', () => {
    const dir = TestBed.runInInjectionContext(() => new LynxElementBase());
    const changes: SimpleChanges = {
      id: change('abc'),
      name: change(null),
      'accessibility-label': change('hello'),
    };

    dir.ngOnChanges(changes);

    expect(fakeEl.setAttribute).toHaveBeenCalledWith('id', 'abc');
    expect(fakeEl.setAttribute).toHaveBeenCalledWith(
      'accessibility-label',
      'hello',
    );
    expect(fakeEl.removeAttribute).toHaveBeenCalledWith('name');
    expect(fakeEl.setAttribute).toHaveBeenCalledTimes(2);
    expect(fakeEl.removeAttribute).toHaveBeenCalledTimes(1);
  });
});

describe('LynxElementBase static attributes', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Renders `template` and returns the `<text>` directive on its first element.
   */
  const textDirective = (template: string): LynxText => {
    @Component({
      imports: [LynxText],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      template,
    })
    class Host {
      readonly unset = undefined;
    }
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture.debugElement
      .query(By.directive(LynxText))
      .injector.get(LynxText);
  };

  it('holds the inputs a template sets, and no others', () => {
    const text = textDirective(
      '<text [flatten]="false" accessibility-label="Hello">a</text>',
    );

    // Angular's own keys (`__ngContext__`) aside.
    const own = Object.keys(text).filter((key) => !key.startsWith('__ng'));
    expect(own.sort()).toEqual(['accessibility-label', 'flatten']);
  });

  it('reads true/false attributes written as strings as booleans', () => {
    const text = textDirective(
      '<text flatten="false" ignore-focus event-through="true">a</text>',
    );

    expect(text.flatten).toBe(false);
    expect(text['ignore-focus']).toBe(true);
    expect(text['event-through']).toBe(true);
  });

  // Issue #456: none of these were inputs, so a binding to one failed ng
  // test's template check, and a static one reached Lynx as a string.
  it('takes the accessibility attributes Lynx reads on one platform or both', () => {
    const text = textDirective(`
      <text
        accessibility-status="Unread"
        accessibility-heading
        accessibility-role-description="switch"
        accessibility-enable-tap="true"
        accessibility-auto-scroll-if-focused="false"
        android-accessibility-keep-focused
      >a</text>
    `);

    expect(text['accessibility-status']).toBe('Unread');
    expect(text['accessibility-heading']).toBe(true);
    expect(text['accessibility-role-description']).toBe('switch');
    expect(text['accessibility-enable-tap']).toBe(true);
    expect(text['accessibility-auto-scroll-if-focused']).toBe(false);
    expect(text['android-accessibility-keep-focused']).toBe(true);
  });

  it('keeps bound booleans, and undefined so the attribute can be removed', () => {
    const text = textDirective(
      '<text [flatten]="false" [user-interaction-enabled]="unset">a</text>',
    );

    expect(text.flatten).toBe(false);
    expect(text['user-interaction-enabled']).toBeUndefined();
  });

  it('reads pan-intercept attributes written as strings as numbers', () => {
    const text = textDirective(
      '<text pan-intercept-direction="1" pan-intercept-scope="5">a</text>',
    );

    expect(text['pan-intercept-direction']).toBe(1);
    expect(text['pan-intercept-scope']).toBe(5);
  });

  it('keeps bound pan-intercept numbers, and undefined', () => {
    const text = textDirective(
      '<text [pan-intercept-direction]="0" [pan-intercept-scope]="unset">a</text>',
    );

    expect(text['pan-intercept-direction']).toBe(0);
    expect(text['pan-intercept-scope']).toBeUndefined();
  });
});

describe('templateAttributeValue', () => {
  const samples = [
    'false',
    'true',
    '',
    '0',
    '1',
    '5',
    'x',
    true,
    false,
    0,
    5,
    null,
    undefined,
  ];

  // Under the Lynx renderer the renderer reads these values, in place of the
  // directive (see declaration-only.ts), so it must read them the same way.
  it('reads each input as LynxElementBase declares it, with its transform or as it is', () => {
    const inputs = Object.entries(getDirectiveDef(LynxElementBase)!.inputs);
    expect(inputs.length).toBeGreaterThan(30);
    let transformed = 0;
    for (const [name, [, , transform]] of inputs as [
      string,
      [string, number, ((value: unknown) => unknown) | null],
    ][]) {
      if (transform) transformed++;
      for (const value of samples) {
        expect(templateAttributeValue(name, value)).toBe(
          transform ? transform(value) : value,
        );
      }
    }
    expect(transformed).toBe(18);
  });

  it('passes an attribute no element directive declares as it is', () => {
    expect(templateAttributeValue('class', 'a b')).toBe('a b');
    expect(templateAttributeValue('data-index', '0')).toBe('0');
  });
});

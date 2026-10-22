// @vitest-environment jsdom
import '@angular/compiler';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
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
import { By } from '@angular/platform-browser';
import { LynxElementBase } from './base';
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

  it('reads true/false attributes written as strings as booleans', () => {
    const text = textDirective(
      '<text flatten="false" ignore-focus event-through="true">a</text>',
    );

    expect(text.flatten).toBe(false);
    expect(text['ignore-focus']).toBe(true);
    expect(text['event-through']).toBe(true);
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

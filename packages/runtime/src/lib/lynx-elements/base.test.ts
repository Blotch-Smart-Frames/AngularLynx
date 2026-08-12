// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, type SimpleChange, type SimpleChanges } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxElementBase } from './base';

describe('LynxElementBase', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  let fakeEl: { setAttribute: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    TestBed.resetTestingModule();
    fakeEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: { nativeElement: fakeEl } }],
    });
  });

  const change = (currentValue: unknown): SimpleChange =>
    ({ currentValue, previousValue: undefined, firstChange: true, isFirstChange: () => true }) as SimpleChange;

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
    expect(fakeEl.setAttribute).toHaveBeenCalledWith('accessibility-label', 'hello');
    expect(fakeEl.removeAttribute).toHaveBeenCalledWith('name');
    expect(fakeEl.setAttribute).toHaveBeenCalledTimes(2);
    expect(fakeEl.removeAttribute).toHaveBeenCalledTimes(1);
  });
});

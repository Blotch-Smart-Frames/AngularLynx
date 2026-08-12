// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LynxMainThreadEvent } from './main-thread-event';
import type { MainThreadFnHandle } from './main-thread-fn';

const makeHandle = (id: string): MainThreadFnHandle =>
  ({
    _wkltId: id,
    _workletType: 'main-thread',
    __isMainThreadFn: true,
  }) as MainThreadFnHandle;

describe('LynxMainThreadEvent', () => {
  let addEvent: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    addEvent = vi.fn();
    vi.stubGlobal('__AddEvent', addEvent);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  /**
   * Directive relies on `inject(ElementRef).nativeElement` — configuring a
   * fresh testing module per instance mirrors how Angular actually resolves
   * this at component creation time.
   */
  const createDirective = (nativeElement: unknown): LynxMainThreadEvent => {
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: { nativeElement } }],
    });
    return TestBed.runInInjectionContext(() => new LynxMainThreadEvent());
  };

  describe('ngOnChanges', () => {
    it('registers a bind* worklet handle via __AddEvent', () => {
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });
      directive.mainThreadBindtap = makeHandle('w-tap');

      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      expect(addEvent).toHaveBeenCalledWith(nativeHandle, 'bindEvent', 'tap', {
        type: 'worklet',
        value: { _wkltId: 'w-tap', _workletType: 'main-thread' },
      });
    });

    it('registers a catch* worklet handle via __AddEvent', () => {
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });
      directive.mainThreadCatchtouchstart = makeHandle('w-catch');

      directive.ngOnChanges({ mainThreadCatchtouchstart: {} as any });

      expect(addEvent).toHaveBeenCalledWith(
        nativeHandle,
        'catchEvent',
        'touchstart',
        {
          type: 'worklet',
          value: { _wkltId: 'w-catch', _workletType: 'main-thread' },
        },
      );
    });

    it('does not register when the input value is a plain function, not a worklet handle', () => {
      // Plain functions are accepted by the input type (pre-compiled worklet
      // build plugin output), but only actual MainThreadFnHandle objects can
      // be handed to __AddEvent — a raw function has no _wkltId to reference.
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });
      directive.mainThreadBindtap = () => undefined;

      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      expect(addEvent).not.toHaveBeenCalled();
    });

    it('skips changed inputs that have no INPUT_TO_EVENT mapping', () => {
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });

      // 'unknownInput' isn't one of the directive's declared inputs, so it has
      // no INPUT_TO_EVENT entry — the loop must `continue` past it silently.
      expect(() =>
        directive.ngOnChanges({ unknownInput: {} as any }),
      ).not.toThrow();
      expect(addEvent).not.toHaveBeenCalled();
    });

    it('returns early when nativeElement.element is missing', () => {
      const directive = createDirective({});
      directive.mainThreadBindtap = makeHandle('w-x');

      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      expect(addEvent).not.toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    it('unregisters each tracked event pair via __AddEvent(..., undefined)', () => {
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });
      directive.mainThreadBindtap = makeHandle('w-tap');
      directive.mainThreadCatchscroll = makeHandle('w-scroll');
      directive.ngOnChanges({
        mainThreadBindtap: {} as any,
        mainThreadCatchscroll: {} as any,
      });
      addEvent.mockClear();

      directive.ngOnDestroy();

      expect(addEvent).toHaveBeenCalledWith(
        nativeHandle,
        'bindEvent',
        'tap',
        undefined,
      );
      expect(addEvent).toHaveBeenCalledWith(
        nativeHandle,
        'catchEvent',
        'scroll',
        undefined,
      );
      expect(addEvent).toHaveBeenCalledTimes(2);
    });

    it('returns early when nativeElement.element is missing', () => {
      const directive = createDirective({});

      expect(() => directive.ngOnDestroy()).not.toThrow();
      expect(addEvent).not.toHaveBeenCalled();
    });
  });
});

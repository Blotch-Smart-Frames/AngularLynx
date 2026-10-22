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
import { __workletMap } from '../worklet-bridge';
import { LynxMainThreadEvent } from './main-thread-event';
import type { MainThreadFnHandle } from './main-thread-fn';

/**
 * What the directive passes __AddEvent to remove a handler. Native Lynx
 * ignores `undefined` for a worklet handler, so it registers one with no ID.
 */
const NO_HANDLER = {
  type: 'worklet',
  value: { _workletType: 'main-thread' },
};

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

    it.each([
      ['mainThreadBindmousedown', 'bindEvent', 'mousedown'],
      ['mainThreadCatchmousedown', 'catchEvent', 'mousedown'],
      ['mainThreadBindmousemove', 'bindEvent', 'mousemove'],
      ['mainThreadCatchmousemove', 'catchEvent', 'mousemove'],
      ['mainThreadBindmouseup', 'bindEvent', 'mouseup'],
      ['mainThreadCatchmouseup', 'catchEvent', 'mouseup'],
    ] as const)(
      'registers %s as a %s for %s, for mouse drags on web',
      (input, eventType, eventName) => {
        const nativeHandle = {};
        const directive = createDirective({ element: nativeHandle });
        directive[input] = makeHandle('w-mouse');

        directive.ngOnChanges({ [input]: {} as any });

        expect(addEvent).toHaveBeenCalledWith(
          nativeHandle,
          eventType,
          eventName,
          {
            type: 'worklet',
            value: { _wkltId: 'w-mouse', _workletType: 'main-thread' },
          },
        );
      },
    );

    it('registers a plain function the build did not wrap, and passes its ID to __AddEvent', () => {
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });
      const handler = () => undefined;
      directive.mainThreadBindtap = handler;

      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      const [, , , value] = addEvent.mock.calls[0]!;
      expect(addEvent).toHaveBeenCalledWith(nativeHandle, 'bindEvent', 'tap', {
        type: 'worklet',
        value: {
          _wkltId: expect.stringMatching(/^__angular_mts_handler_\d+$/),
          _workletType: 'main-thread',
        },
      });
      expect(__workletMap[value.value._wkltId]).toBe(handler);
    });

    it.each([null, undefined])(
      'removes the handler when the input changes to %s',
      (empty) => {
        const nativeHandle = {};
        const directive = createDirective({ element: nativeHandle });
        directive.mainThreadBindtap = makeHandle('w-tap');
        directive.ngOnChanges({ mainThreadBindtap: {} as any });
        addEvent.mockClear();

        directive.mainThreadBindtap = empty;
        directive.ngOnChanges({ mainThreadBindtap: {} as any });
        directive.ngOnDestroy();

        // Removed once by the change; destroy has nothing left to remove.
        expect(addEvent).toHaveBeenCalledTimes(1);
        expect(addEvent).toHaveBeenCalledWith(
          nativeHandle,
          'bindEvent',
          'tap',
          NO_HANDLER,
        );
      },
    );

    it('does nothing for an input that starts as null', () => {
      const directive = createDirective({ element: {} });
      directive.mainThreadBindtap = null;

      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      expect(addEvent).not.toHaveBeenCalled();
    });

    it('releases its registered plain function when the input changes', () => {
      const nativeHandle = {};
      const directive = createDirective({ element: nativeHandle });
      directive.mainThreadBindtap = () => 'first';
      directive.ngOnChanges({ mainThreadBindtap: {} as any });
      const firstId = addEvent.mock.calls[0]![3].value._wkltId;

      directive.mainThreadBindtap = makeHandle('w-tap');
      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      expect(firstId in __workletMap).toBe(false);
      expect(addEvent).toHaveBeenLastCalledWith(
        nativeHandle,
        'bindEvent',
        'tap',
        {
          type: 'worklet',
          value: { _wkltId: 'w-tap', _workletType: 'main-thread' },
        },
      );
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
    it('replaces each tracked handler with one that does nothing', () => {
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
        NO_HANDLER,
      );
      expect(addEvent).toHaveBeenCalledWith(
        nativeHandle,
        'catchEvent',
        'scroll',
        NO_HANDLER,
      );
      expect(addEvent).toHaveBeenCalledTimes(2);
    });

    it('releases the plain functions it registered', () => {
      const directive = createDirective({ element: {} });
      directive.mainThreadBindtap = () => 'tap';
      directive.ngOnChanges({ mainThreadBindtap: {} as any });
      const id = addEvent.mock.calls[0]![3].value._wkltId;

      directive.ngOnDestroy();

      expect(id in __workletMap).toBe(false);
    });

    it('returns early when nativeElement.element is missing', () => {
      const directive = createDirective({});

      expect(() => directive.ngOnDestroy()).not.toThrow();
      expect(addEvent).not.toHaveBeenCalled();
    });
  });
});

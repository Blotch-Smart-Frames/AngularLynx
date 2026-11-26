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
import { LynxElement } from '../lynx-element/lynx-element';
import { __workletMap } from '../worklet-bridge';
import { MainThreadElement } from './main-thread-element';
import { LynxMainThreadEvent } from './main-thread-event';
import type { MainThreadFnHandle } from './main-thread-fn';

const makeHandle = (id: string): MainThreadFnHandle =>
  ({
    _wkltId: id,
    _workletType: 'main-thread',
    __isMainThreadFn: true,
  }) as MainThreadFnHandle;

/**
 * An element that records the listeners the directive adds, as
 * LynxElement.addEventListener takes them.
 */
const fakeElement = () => {
  const listeners: {
    name: string;
    listener: (event: unknown) => unknown;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    listeners,
    addEventListener: vi.fn(
      (name: string, listener: (event: unknown) => unknown) => {
        const stop = vi.fn();
        listeners.push({ name, listener, stop });
        return stop;
      },
    ),
  };
};

describe('LynxMainThreadEvent', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    for (const id of Object.keys(__workletMap)) {
      if (id.startsWith('w-')) delete __workletMap[id];
    }
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

  it.each([
    ['mainThreadBindtap', 'bindtap'],
    ['mainThreadCatchtap', 'catchtap'],
    ['mainThreadBindtouchstart', 'bindtouchstart'],
    ['mainThreadCatchtouchstart', 'catchtouchstart'],
    ['mainThreadBindtouchmove', 'bindtouchmove'],
    ['mainThreadCatchtouchmove', 'catchtouchmove'],
    ['mainThreadBindtouchend', 'bindtouchend'],
    ['mainThreadCatchtouchend', 'catchtouchend'],
    ['mainThreadBindmousedown', 'bindmousedown'],
    ['mainThreadCatchmousedown', 'catchmousedown'],
    ['mainThreadBindmousemove', 'bindmousemove'],
    ['mainThreadCatchmousemove', 'catchmousemove'],
    ['mainThreadBindmouseup', 'bindmouseup'],
    ['mainThreadCatchmouseup', 'catchmouseup'],
    ['mainThreadBindlongpress', 'bindlongpress'],
    ['mainThreadCatchlongpress', 'catchlongpress'],
    ['mainThreadBindscroll', 'bindscroll'],
    ['mainThreadCatchscroll', 'catchscroll'],
    ['mainThreadBindanimationstart', 'bindanimationstart'],
    ['mainThreadBindanimationend', 'bindanimationend'],
    ['mainThreadBindtransitionend', 'bindtransitionend'],
    ['mainThreadBindlayoutchange', 'bindlayoutchange'],
  ] as const)('listens with %s as %s does', (input, listenerName) => {
    const element = fakeElement();
    const directive = createDirective(element);
    directive[input] = makeHandle('w-any');

    directive.ngOnChanges({ [input]: {} as any });

    expect(element.addEventListener).toHaveBeenCalledExactlyOnceWith(
      listenerName,
      expect.any(Function),
    );
  });

  it("runs a handle's function with element handles for the event's targets, leaving the event as it was", () => {
    const element = fakeElement();
    const directive = createDirective(element);
    const script = vi.fn();
    __workletMap['w-tap'] = script;
    directive.mainThreadBindtap = makeHandle('w-tap');
    directive.ngOnChanges({ mainThreadBindtap: {} as any });

    const event = { type: 'tap', currentTarget: { elementRefptr: {} } };
    element.listeners[0]!.listener(event);

    expect(script).toHaveBeenCalledOnce();
    const [given] = script.mock.calls[0]!;
    expect(given.currentTarget).toBeInstanceOf(MainThreadElement);
    // The element's other listeners get the same event, as plain data.
    expect(event.currentTarget).not.toBeInstanceOf(MainThreadElement);
  });

  it('runs a plain function the build did not wrap, and returns what it returns', () => {
    const element = fakeElement();
    const directive = createDirective(element);
    // Native reads an eventReturnResult from what the handler returns.
    const handler = vi.fn(() => ({ eventReturnResult: 1 }));
    directive.mainThreadBindtap = handler;
    directive.ngOnChanges({ mainThreadBindtap: {} as any });

    const result = element.listeners[0]!.listener({ type: 'tap' });

    expect(handler).toHaveBeenCalledExactlyOnceWith({ type: 'tap' });
    expect(result).toEqual({ eventReturnResult: 1 });
  });

  it("looks a handle's function up as the event fires, and skips one released by then", () => {
    const element = fakeElement();
    const directive = createDirective(element);
    directive.mainThreadBindtap = makeHandle('w-later');
    directive.ngOnChanges({ mainThreadBindtap: {} as any });
    const later = vi.fn();
    __workletMap['w-later'] = later;

    element.listeners[0]!.listener({ type: 'tap' });
    expect(later).toHaveBeenCalledOnce();

    // A component's 'main thread' method goes with the component.
    delete __workletMap['w-later'];
    expect(() => element.listeners[0]!.listener({ type: 'tap' })).not.toThrow();
    expect(later).toHaveBeenCalledOnce();
  });

  it('warns in development about a handle whose function has gone', () => {
    vi.stubGlobal('__DEV__', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const element = fakeElement();
    const directive = createDirective(element);
    directive.mainThreadBindtap = makeHandle('w-gone');
    directive.ngOnChanges({ mainThreadBindtap: {} as any });

    element.listeners[0]!.listener({ type: 'tap' });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[angular-lynx] Worklet not found: w-gone',
    );
  });

  it('stops the old script when its input changes, before the new one listens', () => {
    const element = fakeElement();
    const directive = createDirective(element);
    directive.mainThreadBindtap = makeHandle('w-first');
    directive.ngOnChanges({ mainThreadBindtap: {} as any });

    directive.mainThreadBindtap = makeHandle('w-second');
    directive.ngOnChanges({ mainThreadBindtap: {} as any });

    const [first, second] = element.listeners;
    expect(first!.stop).toHaveBeenCalledOnce();
    expect(second!.stop).not.toHaveBeenCalled();
    expect(first!.stop.mock.invocationCallOrder[0]).toBeLessThan(
      element.addEventListener.mock.invocationCallOrder[1]!,
    );
  });

  it.each([null, undefined])(
    'stops the script when its input changes to %s',
    (empty) => {
      const element = fakeElement();
      const directive = createDirective(element);
      directive.mainThreadBindtap = makeHandle('w-tap');
      directive.ngOnChanges({ mainThreadBindtap: {} as any });

      directive.mainThreadBindtap = empty;
      directive.ngOnChanges({ mainThreadBindtap: {} as any });
      directive.ngOnDestroy();

      // Stopped once by the change; destroy has nothing left to stop.
      expect(element.addEventListener).toHaveBeenCalledOnce();
      expect(element.listeners[0]!.stop).toHaveBeenCalledOnce();
    },
  );

  it('does nothing for an input that starts as null', () => {
    const element = fakeElement();
    const directive = createDirective(element);
    directive.mainThreadBindtap = null;

    directive.ngOnChanges({ mainThreadBindtap: {} as any });

    expect(element.addEventListener).not.toHaveBeenCalled();
  });

  it('skips changed inputs that are not its own', () => {
    const element = fakeElement();
    const directive = createDirective(element);

    directive.ngOnChanges({ unknownInput: {} as any });

    expect(element.addEventListener).not.toHaveBeenCalled();
  });

  it('stops every script when destroyed', () => {
    const element = fakeElement();
    const directive = createDirective(element);
    directive.mainThreadBindtap = makeHandle('w-tap');
    directive.mainThreadCatchscroll = makeHandle('w-scroll');
    directive.ngOnChanges({
      mainThreadBindtap: {} as any,
      mainThreadCatchscroll: {} as any,
    });

    directive.ngOnDestroy();
    directive.ngOnDestroy();

    for (const { stop } of element.listeners) {
      expect(stop).toHaveBeenCalledOnce();
    }
  });

  describe('on a LynxElement', () => {
    let addEvent: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      addEvent = vi.fn();
      vi.stubGlobal('__AddEvent', addEvent);
      // Each LynxElement registers itself by its native id.
      let nextUid = 1;
      vi.stubGlobal('__GetElementUniqueID', () => nextUid++);
      vi.stubGlobal('__SetDataset', vi.fn());
      vi.stubGlobal('__FlushElementTree', vi.fn());
    });

    it("shares the element's one native handler with its other listeners for the event (issue #471)", () => {
      // Lynx keeps one handler per event name on an element. The directive
      // used to register its own and keep the element's listeners off the
      // event, so a (bindscroll) or an IntersectionObserver's scroll
      // listener on the same scroll-view never ran.
      const element = new LynxElement({} as never);
      const ran: string[] = [];
      element.addEventListener('bindscroll', () => ran.push('template'));
      const directive = createDirective(element);
      __workletMap['w-scroll'] = () => ran.push('script');
      directive.mainThreadBindscroll = makeHandle('w-scroll');
      directive.ngOnChanges({ mainThreadBindscroll: {} as any });
      element.addEventListener('bindscroll', () => ran.push('observer'));

      const scrolls = addEvent.mock.calls.filter(
        ([, , name]) => name === 'scroll',
      );
      expect(scrolls).toHaveLength(1);
      scrolls[0]![3].value({ type: 'scroll' });
      expect(ran).toEqual(['template', 'script', 'observer']);
    });

    it('stops the event at the element for a catch script', () => {
      const element = new LynxElement({} as never);
      element.addEventListener('bindtap', () => {});
      const directive = createDirective(element);
      directive.mainThreadCatchtap = makeHandle('w-catch');
      directive.ngOnChanges({ mainThreadCatchtap: {} as any });

      expect(addEvent).toHaveBeenLastCalledWith(
        element.element,
        'catchEvent',
        'tap',
        expect.objectContaining({ type: 'worklet' }),
      );
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { MainThreadElement } from './main-thread-element';

// A bare object is a valid ElementRef — it's an opaque brand type with no
// runtime structure (see types/lynx.ts), so identity is all that matters.
const fakeRef = {} as ElementRef;

describe('MainThreadElement', () => {
  let flushElementTree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    flushElementTree = vi.fn();
    vi.stubGlobal('__SetAttribute', vi.fn());
    vi.stubGlobal('__GetAttributeByName', vi.fn());
    vi.stubGlobal('__GetAttributeNames', vi.fn());
    vi.stubGlobal('__AddInlineStyle', vi.fn());
    vi.stubGlobal('__QuerySelector', vi.fn());
    vi.stubGlobal('__QuerySelectorAll', vi.fn());
    vi.stubGlobal('__InvokeUIMethod', vi.fn());
    vi.stubGlobal('__FlushElementTree', flushElementTree);
    vi.stubGlobal('__ElementAnimate', vi.fn());
    // Deliberately NOT stubbing __GetComputedStyleByKey here — several tests
    // rely on it being absent to exercise the "not a function" fallback path.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('setAttribute', () => {
    it('calls __SetAttribute with the element, name, and value', async () => {
      const el = new MainThreadElement(fakeRef);

      el.setAttribute('foo', 'bar');

      expect(__SetAttribute).toHaveBeenCalledWith(fakeRef, 'foo', 'bar');
      // Drain the scheduled flush microtask before this test ends, so the
      // module-level `willFlush` flag doesn't leak a pending flush into the
      // next test after afterEach()'s vi.unstubAllGlobals() call resets the
      // native globals it needs.
      await Promise.resolve();
    });

    it('schedules a flush that runs on the next microtask', async () => {
      const el = new MainThreadElement(fakeRef);

      el.setAttribute('foo', 'bar');
      expect(flushElementTree).not.toHaveBeenCalled();

      await Promise.resolve();

      expect(flushElementTree).toHaveBeenCalledTimes(1);
    });

    it('coalesces multiple mutations in the same tick into a single flush', async () => {
      const el = new MainThreadElement(fakeRef);

      // Two mutations before the microtask drains should still produce only
      // one flush — this is the `if (willFlush) return` dedup guard.
      el.setAttribute('foo', 'bar');
      el.setAttribute('baz', 'qux');

      await Promise.resolve();

      expect(flushElementTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAttribute', () => {
    it('returns the value from __GetAttributeByName', () => {
      vi.mocked(__GetAttributeByName).mockReturnValue('value');
      const el = new MainThreadElement(fakeRef);

      const result = el.getAttribute('foo');

      expect(__GetAttributeByName).toHaveBeenCalledWith(fakeRef, 'foo');
      expect(result).toBe('value');
    });
  });

  describe('getAttributeNames', () => {
    it('returns the value from __GetAttributeNames', () => {
      vi.mocked(__GetAttributeNames).mockReturnValue(['a', 'b']);
      const el = new MainThreadElement(fakeRef);

      const result = el.getAttributeNames();

      expect(__GetAttributeNames).toHaveBeenCalledWith(fakeRef);
      expect(result).toEqual(['a', 'b']);
    });
  });

  describe('setStyleProperty', () => {
    it('calls __AddInlineStyle and schedules a flush', async () => {
      const el = new MainThreadElement(fakeRef);

      el.setStyleProperty('color', 'red');

      expect(__AddInlineStyle).toHaveBeenCalledWith(fakeRef, 'color', 'red');
      await Promise.resolve();
      expect(flushElementTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('setStyleProperties', () => {
    it('calls __AddInlineStyle once per key and schedules a single flush', async () => {
      const el = new MainThreadElement(fakeRef);

      el.setStyleProperties({ color: 'red', width: '10px' });

      expect(__AddInlineStyle).toHaveBeenNthCalledWith(
        1,
        fakeRef,
        'color',
        'red',
      );
      expect(__AddInlineStyle).toHaveBeenNthCalledWith(
        2,
        fakeRef,
        'width',
        '10px',
      );
      await Promise.resolve();
      expect(flushElementTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('querySelector', () => {
    it('wraps the returned ref in a MainThreadElement', () => {
      const childRef = {} as ElementRef;
      vi.mocked(__QuerySelector).mockReturnValue(childRef);
      const el = new MainThreadElement(fakeRef);

      const result = el.querySelector('.child');

      expect(__QuerySelector).toHaveBeenCalledWith(fakeRef, '.child', {});
      expect(result).toBeInstanceOf(MainThreadElement);
    });

    it('returns null when no matching element is found', () => {
      vi.mocked(__QuerySelector).mockReturnValue(null);
      const el = new MainThreadElement(fakeRef);

      const result = el.querySelector('.missing');

      expect(result).toBeNull();
    });
  });

  describe('querySelectorAll', () => {
    it('maps each returned ref to a MainThreadElement', () => {
      const childRefs = [{} as ElementRef, {} as ElementRef];
      vi.mocked(__QuerySelectorAll).mockReturnValue(childRefs);
      const el = new MainThreadElement(fakeRef);

      const result = el.querySelectorAll('.child');

      expect(__QuerySelectorAll).toHaveBeenCalledWith(fakeRef, '.child', {});
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(MainThreadElement);
      expect(result[1]).toBeInstanceOf(MainThreadElement);
    });

    it('returns an empty array when nothing matches', () => {
      vi.mocked(__QuerySelectorAll).mockReturnValue([]);
      const el = new MainThreadElement(fakeRef);

      expect(el.querySelectorAll('.missing')).toEqual([]);
    });
  });

  describe('invoke', () => {
    it('resolves with the response data when code is 0', async () => {
      vi.mocked(__InvokeUIMethod).mockImplementation(
        (_el, _method, _params, callback) => {
          callback({ code: 0, data: 'ok' });
        },
      );
      const el = new MainThreadElement(fakeRef);

      await expect(el.invoke('scrollTo', { x: 1 })).resolves.toBe('ok');
      expect(__InvokeUIMethod).toHaveBeenCalledWith(
        fakeRef,
        'scrollTo',
        { x: 1 },
        expect.any(Function),
      );
    });

    it('defaults params to an empty object when omitted', async () => {
      vi.mocked(__InvokeUIMethod).mockImplementation(
        (_el, _method, _params, callback) => {
          callback({ code: 0, data: undefined });
        },
      );
      const el = new MainThreadElement(fakeRef);

      await el.invoke('autoPlay');

      expect(__InvokeUIMethod).toHaveBeenCalledWith(
        fakeRef,
        'autoPlay',
        {},
        expect.any(Function),
      );
    });

    it('rejects with an Error when code is non-zero', async () => {
      vi.mocked(__InvokeUIMethod).mockImplementation(
        (_el, _method, _params, callback) => {
          callback({ code: 1, data: null });
        },
      );
      const el = new MainThreadElement(fakeRef);

      await expect(el.invoke('scrollTo')).rejects.toThrow(
        /UI method invoke/,
      );
    });

    it('schedules a flush after invoking the native method', async () => {
      vi.mocked(__InvokeUIMethod).mockImplementation(
        (_el, _method, _params, callback) => {
          callback({ code: 0, data: null });
        },
      );
      const el = new MainThreadElement(fakeRef);

      await el.invoke('scrollTo');
      await Promise.resolve();

      expect(flushElementTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('animate', () => {
    it('normalizes a numeric options argument to { duration }', () => {
      const el = new MainThreadElement(fakeRef);

      el.animate([{ opacity: 0 }, { opacity: 1 }], 300);

      expect(__ElementAnimate).toHaveBeenCalledWith(
        fakeRef,
        expect.arrayContaining([
          expect.any(String),
          [{ opacity: 0 }, { opacity: 1 }],
          expect.objectContaining({ duration: 300 }),
        ]),
      );
    });

    it('passes an options object through unchanged', () => {
      const el = new MainThreadElement(fakeRef);

      el.animate([{ opacity: 0 }], { duration: 500, easing: 'ease-in' });

      const call = vi.mocked(__ElementAnimate).mock.calls[0]!;
      const wireOptions = call[1][3] as Record<string, unknown>;
      expect(wireOptions['duration']).toBe(500);
      expect(wireOptions['timingFunction']).toBe('ease-in');
    });

    it('defaults to an empty options object when none is given', () => {
      const el = new MainThreadElement(fakeRef);

      el.animate([{ opacity: 0 }]);

      const call = vi.mocked(__ElementAnimate).mock.calls[0]!;
      const wireOptions = call[1][3] as Record<string, unknown>;
      expect(wireOptions).toEqual({});
    });

    it('returns a LynxAnimation instance', () => {
      const el = new MainThreadElement(fakeRef);

      const animation = el.animate([{ opacity: 0 }]);

      expect(animation.id).toMatch(/^__lynx-angular-animation-/);
    });
  });

  describe('getBoundingClientRect', () => {
    it('returns all zeros when __GetComputedStyleByKey is not a function', () => {
      // __GetComputedStyleByKey is intentionally not stubbed in beforeEach,
      // so it is undefined here — exercising the typeof-guard fallback path.
      const el = new MainThreadElement(fakeRef);

      expect(el.getBoundingClientRect()).toEqual({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      });
    });

    it('parses computed style values when __GetComputedStyleByKey is available', () => {
      const styles: Record<string, string> = {
        width: '100px',
        height: '50px',
        left: '10px',
        top: '20px',
      };
      vi.stubGlobal(
        '__GetComputedStyleByKey',
        (_el: ElementRef, key: string) => styles[key],
      );
      const el = new MainThreadElement(fakeRef);

      expect(el.getBoundingClientRect()).toEqual({
        left: 10,
        top: 20,
        right: 110,
        bottom: 70,
        width: 100,
        height: 50,
      });
    });

    it('falls back to 0 for values that fail to parse', () => {
      vi.stubGlobal('__GetComputedStyleByKey', () => 'not-a-number');
      const el = new MainThreadElement(fakeRef);

      expect(el.getBoundingClientRect()).toEqual({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      });
    });
  });
});

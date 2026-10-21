import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

describe('LynxElement', () => {
  let element: LynxElement;
  let fakeRef: ElementRef;

  beforeEach(() => {
    fakeRef = {} as ElementRef;

    // LynxElement's constructor registers itself in a native-id → wrapper map
    // (see #byNativeId), so every construction needs a unique id. Hand out a
    // stable id per ref object.
    const uidByRef = new WeakMap<object, number>();
    let nextUid = 1;
    globalThis.__GetElementUniqueID = vi.fn((ref: object) => {
      let id = uidByRef.get(ref);
      if (id == null) {
        id = nextUid++;
        uidByRef.set(ref, id);
      }
      return id;
    });
    globalThis.__AddClass = vi.fn();
    globalThis.__SetClasses = vi.fn();
    globalThis.__GetClasses = vi.fn(() => []);
    globalThis.__AddEvent = vi.fn();
    globalThis.__GetEvents = vi.fn(() => ({}));
    globalThis.__SetEvents = vi.fn();
  });

  describe('setAttribute("class", ...)', () => {
    it('calls __SetClasses with a single class name', () => {
      element = new LynxElement(fakeRef);
      element.setAttribute('class', 'text-white');
      expect(globalThis.__SetClasses).toHaveBeenCalledWith(
        fakeRef,
        'text-white',
      );
      expect(globalThis.__AddClass).not.toHaveBeenCalled();
    });

    it('calls __SetClasses with a space-separated class list', () => {
      // Regression: __AddClass treats its argument as a single class name, so
      // passing 'bg-blue-500 p-4 rounded-lg' would set one literal class
      // 'bg-blue-500 p-4 rounded-lg' and no CSS rule would ever match.
      element = new LynxElement(fakeRef);
      element.setAttribute('class', 'bg-blue-500 p-4 rounded-lg');
      expect(globalThis.__SetClasses).toHaveBeenCalledWith(
        fakeRef,
        'bg-blue-500 p-4 rounded-lg',
      );
      expect(globalThis.__AddClass).not.toHaveBeenCalled();
    });

    it('calls __SetClasses with empty string when value is null', () => {
      element = new LynxElement(fakeRef);
      element.setAttribute('class', null);
      expect(globalThis.__SetClasses).toHaveBeenCalledWith(fakeRef, '');
    });
  });

  describe('addScopeClass', () => {
    it('adds the class', () => {
      element = new LynxElement(fakeRef);
      element.addScopeClass('_ngcontent-l1');
      expect(globalThis.__AddClass).toHaveBeenCalledWith(
        fakeRef,
        '_ngcontent-l1',
      );
    });

    it('adds each scope class once', () => {
      element = new LynxElement(fakeRef);
      element.addScopeClass('_ngcontent-l1');
      element.addScopeClass('_ngcontent-l1');
      expect(globalThis.__AddClass).toHaveBeenCalledOnce();
    });

    it('keeps scope classes when Angular replaces the class list', () => {
      // Angular writes static and bound classes as one string through
      // setAttribute('class'), which would otherwise drop the scope classes.
      element = new LynxElement(fakeRef);
      element.addScopeClass('_ngcontent-l1');
      element.addScopeClass('_nghost-l2');

      element.setAttribute('class', 'title  big');
      element.setAttribute('class', null);

      expect(vi.mocked(globalThis.__SetClasses).mock.calls).toEqual([
        [fakeRef, 'title big _ngcontent-l1 _nghost-l2'],
        [fakeRef, '_ngcontent-l1 _nghost-l2'],
      ]);
    });

    it('does not repeat a scope class the new class list already has', () => {
      element = new LynxElement(fakeRef);
      element.addScopeClass('_ngcontent-l1');

      element.setAttribute('class', 'title _ngcontent-l1');

      expect(globalThis.__SetClasses).toHaveBeenCalledWith(
        fakeRef,
        'title _ngcontent-l1',
      );
    });
  });

  describe('addClass', () => {
    it('calls __AddClass with the class name', () => {
      element = new LynxElement(fakeRef);
      element.addClass('active');
      expect(globalThis.__AddClass).toHaveBeenCalledWith(fakeRef, 'active');
    });
  });

  describe('setStyle', () => {
    it('calls __AddInlineStyle with the key and value', () => {
      globalThis.__AddInlineStyle = vi.fn();
      element = new LynxElement(fakeRef);

      element.setStyle('background-color', 'red');

      expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
        fakeRef,
        'background-color',
        'red',
      );
    });

    it('passes dash-case keys through unchanged', () => {
      globalThis.__AddInlineStyle = vi.fn();
      element = new LynxElement(fakeRef);

      element.setStyle('margin-top', '10px');

      expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
        fakeRef,
        'margin-top',
        '10px',
      );
    });

    it('passes values with !important suffix through unchanged', () => {
      globalThis.__AddInlineStyle = vi.fn();
      element = new LynxElement(fakeRef);

      element.setStyle('color', 'blue !important');

      expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
        fakeRef,
        'color',
        'blue !important',
      );
    });
  });

  describe('removeStyle', () => {
    it('calls __AddInlineStyle with null to clear the style', () => {
      globalThis.__AddInlineStyle = vi.fn();
      element = new LynxElement(fakeRef);

      element.removeStyle('background-color');

      expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
        fakeRef,
        'background-color',
        null,
      );
    });
  });

  describe('setInlineStyles', () => {
    it('calls __SetInlineStyles with the raw style string', () => {
      globalThis.__SetInlineStyles = vi.fn();
      element = new LynxElement(fakeRef);

      element.setInlineStyles('color: red; font-size: 16px');

      expect(globalThis.__SetInlineStyles).toHaveBeenCalledWith(
        fakeRef,
        'color: red; font-size: 16px',
      );
    });
  });

  describe('svg content', () => {
    const svg = () => {
      const el = new LynxElement(fakeRef);
      el.tagName = 'svg';
      return el;
    };
    const HANGS = '<svg><rect stroke-dasharray="none"/></svg>';

    beforeEach(() => {
      globalThis.__SetAttribute = vi.fn();
    });

    it('drops a stroke-dasharray the native SVG engine would hang on', () => {
      svg().setAttribute('content', HANGS);
      expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
        fakeRef,
        'content',
        '<svg><rect/></svg>',
      );
    });

    it('passes other svg attributes and other elements through', () => {
      svg().setAttribute('src', HANGS);
      const view = new LynxElement(fakeRef);
      view.tagName = 'view';
      view.setAttribute('content', HANGS);
      expect(globalThis.__SetAttribute).toHaveBeenNthCalledWith(
        1,
        fakeRef,
        'src',
        HANGS,
      );
      expect(globalThis.__SetAttribute).toHaveBeenNthCalledWith(
        2,
        fakeRef,
        'content',
        HANGS,
      );
    });
  });

  describe('blur-view materials on Android', () => {
    const material = (background: string) =>
      `--angular-lynx-blur-background: ${background}; ` +
      '--angular-lynx-blur-background-image: none; ' +
      '--angular-lynx-blur-box-shadow: none';
    const NONE = material('transparent');
    const DARK = material('rgba(0, 0, 0, 0.6)');

    const blurView = () => {
      const el = new LynxElement(fakeRef);
      el.tagName = 'blur-view';
      return el;
    };

    beforeEach(() => {
      globalThis.__SetAttribute = vi.fn();
      globalThis.__SetInlineStyles = vi.fn();
      globalThis.__AddInlineStyle = vi.fn();
      vi.stubGlobal('__WEB__', false);
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sets the material’s CSS variables as its attributes change', () => {
      element = blurView();
      element.updateBlurMaterial();
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        NONE,
      );

      element.setAttribute('blur-effect', 'dark');
      element.setAttribute('blur-radius', '16px');
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        DARK,
      );

      element.removeAttribute('blur-radius');
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        NONE,
      );
    });

    it('writes nothing while the material stays the same', () => {
      element = blurView();
      element.setAttribute('blur-effect', 'dark');
      vi.mocked(globalThis.__SetInlineStyles).mockClear();
      element.setAttribute('blur-effect', 'dark');
      element.setAttribute('glass-style', 'clear');
      expect(globalThis.__SetInlineStyles).not.toHaveBeenCalled();
    });

    it('ignores attributes the material doesn’t depend on', () => {
      element = blurView();
      element.setAttribute('blur-sampling', 4);
      expect(globalThis.__SetInlineStyles).not.toHaveBeenCalled();
    });

    it('puts the app’s own inline style after its variables', () => {
      element = blurView();
      element.setInlineStyles('width: 10px');
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        'width: 10px',
      );

      element.setAttribute('blur-effect', 'dark');
      element.setAttribute('blur-radius', '16px');
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        `${DARK}; width: 10px`,
      );

      element.setInlineStyles('width: 20px');
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        `${DARK}; width: 20px`,
      );

      // Removing the style attribute keeps the variables.
      element.setInlineStyles(null as unknown as string);
      expect(globalThis.__SetInlineStyles).toHaveBeenLastCalledWith(
        fakeRef,
        DARK,
      );
    });

    it('puts [style.x] styles back after replacing the inline style', () => {
      element = blurView();
      element.setStyle('opacity', 0.5);
      vi.mocked(globalThis.__AddInlineStyle).mockClear();

      element.setAttribute('blur-effect', 'dark');

      expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
        fakeRef,
        'opacity',
        0.5,
      );
    });

    it('leaves iOS’s blur-views alone', () => {
      vi.stubGlobal('SystemInfo', { platform: 'iOS' });
      element = blurView();
      element.updateBlurMaterial();
      element.setAttribute('blur-effect', 'dark');
      expect(globalThis.__SetInlineStyles).not.toHaveBeenCalled();
    });

    it('leaves other elements alone', () => {
      element = new LynxElement(fakeRef);
      element.tagName = 'view';
      element.setAttribute('blur-effect', 'dark');
      expect(globalThis.__SetInlineStyles).not.toHaveBeenCalled();
    });
  });

  it('addEventListener with bindtap calls __AddEvent with bindEvent', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    element.addEventListener('bindtap', cb);

    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      fakeRef,
      'bindEvent',
      'tap',
      // value is the internal wrapper around cb (see event-method shim), not
      // cb itself — assert its shape rather than identity.
      { type: 'worklet', value: expect.any(Function) },
    );
  });

  it('addEventListener with catchtap calls __AddEvent with catchEvent', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    element.addEventListener('catchtap', cb);

    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      fakeRef,
      'catchEvent',
      'tap',
      { type: 'worklet', value: expect.any(Function) },
    );
  });

  it('addEventListener with capture-bindtap calls __AddEvent with capture-bindEvent', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    element.addEventListener('capture-bindtap', cb);

    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      fakeRef,
      'capture-bindEvent',
      'tap',
      { type: 'worklet', value: expect.any(Function) },
    );
  });

  it('addEventListener with capture-catchtap calls __AddEvent with capture-catchEvent', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    element.addEventListener('capture-catchtap', cb);

    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      fakeRef,
      'capture-catchEvent',
      'tap',
      { type: 'worklet', value: expect.any(Function) },
    );
  });

  it('addEventListener with global-bindtap calls __AddEvent with global-bindEvent', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    element.addEventListener('global-bindtap', cb);

    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      fakeRef,
      'global-bindEvent',
      'tap',
      { type: 'worklet', value: expect.any(Function) },
    );
  });

  it('addEventListener with unrecognized event does not call __AddEvent', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    const cleanup = element.addEventListener('click', cb);

    expect(globalThis.__AddEvent).not.toHaveBeenCalled();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('cleanup function calls __AddEvent with undefined to remove the event', () => {
    element = new LynxElement(fakeRef);
    const cb = vi.fn();

    const cleanup = element.addEventListener('bindtap', cb);
    (globalThis.__AddEvent as ReturnType<typeof vi.fn>).mockClear();
    cleanup();

    expect(globalThis.__AddEvent).toHaveBeenCalledWith(
      fakeRef,
      'bindEvent',
      'tap',
      undefined,
    );
  });

  describe('addEventListener event-method shims', () => {
    /**
     * Grabs the wrapper function LynxElement registered with __AddEvent — this
     * is what the native engine invokes when the event fires.
     */
    const registeredListener = (): ((event: unknown) => unknown) => {
      const calls = (globalThis.__AddEvent as ReturnType<typeof vi.fn>).mock
        .calls;
      const lastArg = calls[calls.length - 1]![3] as { value: unknown };
      return lastArg.value as (event: unknown) => unknown;
    };

    it('does not throw when a handler calls stopPropagation() on a bare Lynx event', () => {
      // Regression: Lynx background-thread event objects have no
      // stopPropagation(), so `$event.stopPropagation()` used to throw
      // "not a function" — the crash reported for the nav-drawer catchtap.
      element = new LynxElement(fakeRef);
      const cb = vi.fn((event: any) => event.stopPropagation());

      element.addEventListener('catchtap', cb);
      const lynxEvent = { type: 'tap' }; // bare native event, no methods

      expect(() => registeredListener()(lynxEvent)).not.toThrow();
      expect(cb).toHaveBeenCalledWith(lynxEvent);
    });

    it('injects callable stopPropagation/preventDefault/stopImmediatePropagation shims', () => {
      element = new LynxElement(fakeRef);
      let received: any;
      const cb = vi.fn((event: any) => {
        received = event;
      });

      element.addEventListener('bindtap', cb);
      registeredListener()({ type: 'tap' });

      expect(typeof received.stopPropagation).toBe('function');
      expect(typeof received.preventDefault).toBe('function');
      expect(typeof received.stopImmediatePropagation).toBe('function');
      // Shims are no-ops (Lynx controls propagation via the bind/catch prefix,
      // not at runtime) — they must not throw.
      expect(() => received.preventDefault()).not.toThrow();
      expect(() => received.stopImmediatePropagation()).not.toThrow();
    });

    it('does not clobber event methods that already exist', () => {
      // In main-thread-script contexts Lynx provides a real stopPropagation —
      // we must preserve it rather than replace it with a no-op.
      element = new LynxElement(fakeRef);
      const realStop = vi.fn();
      const cb = vi.fn((event: any) => event.stopPropagation());

      element.addEventListener('catchtap', cb);
      registeredListener()({ type: 'tap', stopPropagation: realStop });

      expect(realStop).toHaveBeenCalledTimes(1);
    });

    it('does not clobber preventDefault or stopImmediatePropagation when they already exist', () => {
      // Same rationale as stopPropagation: main-thread-script contexts expose
      // real preventDefault / stopImmediatePropagation implementations that
      // the shim must not overwrite.
      element = new LynxElement(fakeRef);
      const realPrevent = vi.fn();
      const realStopImmediate = vi.fn();
      const cb = vi.fn((event: any) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      });

      element.addEventListener('bindtap', cb);
      registeredListener()({
        type: 'tap',
        stopPropagation: () => {},
        preventDefault: realPrevent,
        stopImmediatePropagation: realStopImmediate,
      });

      expect(realPrevent).toHaveBeenCalledTimes(1);
      expect(realStopImmediate).toHaveBeenCalledTimes(1);
    });

    it('returns the handler return value (Angular return-false path)', () => {
      element = new LynxElement(fakeRef);
      const cb = vi.fn(() => false);

      element.addEventListener('bindtap', cb);

      expect(registeredListener()({ type: 'tap' })).toBe(false);
    });

    it('tolerates non-object event payloads', () => {
      element = new LynxElement(fakeRef);
      const cb = vi.fn();

      element.addEventListener('bindtap', cb);

      expect(() => registeredListener()(undefined)).not.toThrow();
      expect(cb).toHaveBeenCalledWith(undefined);
    });
  });
});

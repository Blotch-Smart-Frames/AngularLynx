/**
 * Tests for the PAPI polyfills installed by setup.ts.
 *
 * setup.ts runs once before all tests via vitest setupFiles.
 * These tests verify that the globals it installs behave correctly.
 */

import { describe, it, expect, vi } from 'vitest';

describe('runWorklet', () => {
  it('calls the function with spread params', () => {
    const fn = vi.fn();
    (globalThis as any).runWorklet(fn, [1, 2, 3]);
    expect(fn).toHaveBeenCalledWith(1, 2, 3);
  });

  it('does nothing when the value is not a function', () => {
    expect(() =>
      (globalThis as any).runWorklet('not-a-function', []),
    ).not.toThrow();
    expect(() => (globalThis as any).runWorklet(null, [])).not.toThrow();
  });
});

describe('__GetParent', () => {
  it('returns the parent element', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    expect((globalThis as any).__GetParent(child)).toBe(parent);
  });

  it('returns null for an element with no parent', () => {
    const el = document.createElement('div');
    expect((globalThis as any).__GetParent(el)).toBeNull();
  });
});

describe('__NextElement', () => {
  it('returns the next sibling element', () => {
    const parent = document.createElement('div');
    const first = document.createElement('span');
    const second = document.createElement('em');
    parent.appendChild(first);
    parent.appendChild(second);
    expect((globalThis as any).__NextElement(first)).toBe(second);
  });

  it('returns null when there is no next sibling', () => {
    const parent = document.createElement('div');
    const only = document.createElement('span');
    parent.appendChild(only);
    expect((globalThis as any).__NextElement(only)).toBeNull();
  });
});

describe('__QuerySelector', () => {
  it('finds the first matching descendant', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    child.className = 'target';
    parent.appendChild(child);
    expect((globalThis as any).__QuerySelector(parent, '.target')).toBe(child);
  });

  it('returns null when nothing matches', () => {
    const parent = document.createElement('div');
    expect((globalThis as any).__QuerySelector(parent, '.missing')).toBeNull();
  });
});

describe('__QuerySelectorAll', () => {
  it('returns all matching descendants as a plain array', () => {
    const parent = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('span');
      el.className = 'item';
      parent.appendChild(el);
    }
    const results = (globalThis as any).__QuerySelectorAll(parent, '.item');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3);
  });

  it('returns an empty array when nothing matches', () => {
    const parent = document.createElement('div');
    expect(
      (globalThis as any).__QuerySelectorAll(parent, 'nonexistent'),
    ).toEqual([]);
  });
});

describe('__GetEvents', () => {
  it('returns an empty object when the element has no eventMap', () => {
    const el = document.createElement('div');
    expect((globalThis as any).__GetEvents(el)).toEqual({});
  });

  it('returns the eventMap stored on the element', () => {
    const el: any = document.createElement('div');
    const handler = () => {};
    el.eventMap = { 'bindEvent:tap': handler };
    expect((globalThis as any).__GetEvents(el)).toBe(el.eventMap);
  });
});

describe('__SetEvents', () => {
  it('stores events as a keyed map on the element', () => {
    const el: any = document.createElement('div');
    const handler = () => {};
    (globalThis as any).__SetEvents(el, [
      { type: 'bindEvent', name: 'tap', jsFunction: handler },
    ]);
    expect(el.eventMap).toEqual({ 'bindEvent:tap': handler });
  });

  it('overwrites a previous eventMap', () => {
    const el: any = document.createElement('div');
    const h1 = () => {};
    const h2 = () => {};
    (globalThis as any).__SetEvents(el, [
      { type: 'bindEvent', name: 'tap', jsFunction: h1 },
    ]);
    (globalThis as any).__SetEvents(el, [
      { type: 'bindEvent', name: 'tap', jsFunction: h2 },
    ]);
    expect(el.eventMap['bindEvent:tap']).toBe(h2);
  });
});

describe('__AddClass / __GetClasses', () => {
  it('adds a class to an element', () => {
    const el = document.createElement('div');
    (globalThis as any).__AddClass(el, 'my-class');
    expect(el.classList.contains('my-class')).toBe(true);
  });

  it('returns all classes as an array', () => {
    const el = document.createElement('div');
    el.classList.add('a', 'b', 'c');
    expect((globalThis as any).__GetClasses(el)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array when the element has no classes', () => {
    const el = document.createElement('div');
    expect((globalThis as any).__GetClasses(el)).toEqual([]);
  });
});

describe('__SetConfig', () => {
  it('is a no-op that does not throw', () => {
    expect(() =>
      (globalThis as any).__SetConfig({ theme: 'dark' }),
    ).not.toThrow();
    expect(() => (globalThis as any).__SetConfig()).not.toThrow();
  });
});

describe('element creator polyfills', () => {
  for (const tag of ['block', 'for', 'frame', 'if']) {
    const fnName = `__Create${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;

    it(`${fnName} creates a <${tag}> element`, () => {
      const el = (globalThis as any)[fnName](0);
      expect(el).toBeTruthy();
      expect(el.tagName.toLowerCase()).toBe(tag);
    });
  }

  it('__CreateNonElement creates a <non-element> element', () => {
    const el = (globalThis as any).__CreateNonElement();
    expect(el).toBeTruthy();
    expect(el.tagName.toLowerCase()).toBe('non-element');
  });
});

describe('lynxTestingEnv', () => {
  it('is installed on globalThis', () => {
    expect((globalThis as any).lynxTestingEnv).toBeDefined();
  });

  it('exposes a switchToMainThread method', () => {
    expect(typeof (globalThis as any).lynxTestingEnv.switchToMainThread).toBe(
      'function',
    );
  });

  it('exposes a reset method', () => {
    expect(typeof (globalThis as any).lynxTestingEnv.reset).toBe('function');
  });
});

describe('Node global', () => {
  it('is exposed on globalThis for @testing-library/dom element detection', () => {
    expect((globalThis as any).Node).toBeDefined();
    expect((globalThis as any).Node).toBe(globalThis.window.Node);
  });
});

describe('thread switches keep their writes off the jsdom window', () => {
  // Vitest 5's jsdom environment defines window properties on the global as
  // accessors whose setter writes through to the window, and jsdom 30's
  // `window.document` has no setter. Simulate that for one thread global.
  it('replaces a write-through accessor with a data property before writing', () => {
    const env = (globalThis as any).lynxTestingEnv;
    const windowSide: unknown[] = [];
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      get: () => undefined,
      set: (value: unknown) => {
        windowSide.push(value);
        throw new TypeError('Cannot set property which has only a getter');
      },
      configurable: true,
      enumerable: true,
    });

    expect(() => env.switchToMainThread()).not.toThrow();

    expect(windowSide).toEqual([]);
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'requestAnimationFrame',
    );
    expect(descriptor?.set).toBeUndefined();
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.enumerable).toBe(true);
    expect(globalThis.requestAnimationFrame).toBe(
      env.mainThread.globalThis.requestAnimationFrame,
    );
  });

  it('does the same on a switch to the background thread', () => {
    const env = (globalThis as any).lynxTestingEnv;
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      get: () => undefined,
      set: () => {
        throw new TypeError('Cannot set property which has only a getter');
      },
      configurable: true,
    });

    expect(() => env.switchToBackgroundThread()).not.toThrow();
    expect(globalThis.cancelAnimationFrame).toBe(
      env.backgroundThread.globalThis.cancelAnimationFrame,
    );
    env.switchToMainThread();
  });

  it('leaves the jsdom window that Vitest tears down intact', () => {
    // The thread globals include `_globalProxy`, the object jsdom returns as
    // `dom.window`. Writing it through made Vitest's teardown call `close()`
    // on a thread global ("dom.window.close is not a function").
    const dom = (globalThis as any).jsdom;
    expect(typeof dom.window.close).toBe('function');
    expect(dom.window.document).toBe(document);
  });
});

// A text field's `value` (LynxElement's setProperty), and UI methods called
// before native has made the element's UI (LynxElement's invoke), issue #339.
//
// firstRenderPending is module-global, starts true and flips once (see
// settle-flush.test.ts), and Vitest isolates module state per file: the
// first-render cases come first, then a test flips it for the rest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markFirstRenderComplete,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

/**
 * What iOS and Android answer a UI method on an element with no UI yet.
 */
const NO_UI_FOR_NODE = 6;

type InvokeCallback = (result: { code: number; data?: unknown }) => void;

/**
 * The native handler the element registered for `name` (see __AddEvent).
 */
const handlerFor = (name: string): ((event: unknown) => unknown) => {
  const calls = (globalThis.__AddEvent as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls.findLast(([, , eventName]) => eventName === name);
  if (!call) throw new Error(`no handler for ${name}`);
  return (call[3] as { value: (event: unknown) => unknown }).value;
};

/**
 * Answers every UI method with `code`, at once, as iOS and Android do.
 */
const answerWith = (code: number): void => {
  (globalThis.__InvokeUIMethod as ReturnType<typeof vi.fn>).mockImplementation(
    (_el: unknown, _method: string, _params: unknown, cb: InvokeCallback) =>
      cb({ code }),
  );
};

let uid = 0;
const field = (tagName = 'input'): LynxElement => {
  const el = new LynxElement({ uid: ++uid } as unknown as ElementRef);
  el.tagName = tagName;
  return el;
};

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

beforeEach(() => {
  vi.stubGlobal('__WEB__', false);
  vi.stubGlobal('__PROFILE__', false);
  vi.stubGlobal(
    '__GetElementUniqueID',
    vi.fn((ref: { uid: number }) => ref.uid),
  );
  vi.stubGlobal('__SetAttribute', vi.fn());
  vi.stubGlobal('__SetDataset', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn());
  vi.stubGlobal('__InvokeUIMethod', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn());
  setInsideChangeDetection(false);
});

afterEach(async () => {
  // A settle flush scheduled by a test runs before the next one starts.
  await flushMicrotasks();
  vi.unstubAllGlobals();
});

describe('LynxElement invoke during the first render', () => {
  it('calls a UI method again once the first render is flushed', async () => {
    vi.useFakeTimers();
    try {
      answerWith(NO_UI_FOR_NODE);
      const el = field();

      el.invoke('focus');
      expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(1);

      // Native flushes the first render once renderPage returns, and the
      // runtime goes on after it in a macrotask (see lynx-render-lifecycle).
      answerWith(0);
      markFirstRenderComplete();
      vi.runAllTimers();

      expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(2);
      expect(globalThis.__InvokeUIMethod).toHaveBeenLastCalledWith(
        el.element,
        'focus',
        {},
        expect.any(Function),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a text field's value", () => {
  it('goes to a UI made already with setValue, and to one made later as its default-value', () => {
    const el = field();

    el.setProperty('value', 'Ada');

    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledWith(
      el.element,
      'setValue',
      { value: 'Ada' },
      expect.any(Function),
    );
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      el.element,
      'default-value',
      'Ada',
    );
    // Not as an attribute: Lynx's fields have none for their text.
    expect(globalThis.__SetAttribute).not.toHaveBeenCalledWith(
      el.element,
      'value',
      expect.anything(),
    );
  });

  it("goes to a <textarea>'s text too", () => {
    const el = field('textarea');

    el.setProperty('value', 'Leeds');

    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      el.element,
      'default-value',
      'Leeds',
    );
  });

  it('takes no answer from setValue, whether native made the UI or not', () => {
    // A field with no UI yet gets its text as its default-value, so setValue
    // isn't called again after the flush, as another UI method would be.
    answerWith(NO_UI_FOR_NODE);
    const el = field();

    el.setProperty('value', 'Ada');
    LynxElement.commitPendingInvokes();

    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(1);
  });

  it('is no text for null or undefined, and text for anything else', () => {
    const el = field();

    el.setProperty('value', 42);
    el.setProperty('value', null);

    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      el.element,
      'default-value',
      '42',
    );
    expect(globalThis.__SetAttribute).toHaveBeenLastCalledWith(
      el.element,
      'default-value',
      '',
    );
  });

  it('leaves the field alone when it has the text already', () => {
    const el = field();
    el.setProperty('value', 'Ada');
    vi.clearAllMocks();

    el.setProperty('value', 'Ada');

    expect(globalThis.__InvokeUIMethod).not.toHaveBeenCalled();
    expect(globalThis.__SetAttribute).not.toHaveBeenCalled();
  });

  it('leaves the field alone when it is set to what the user typed, and sets it after', () => {
    const el = field();
    el.setProperty('value', 'Ada');
    const input = handlerFor('input');
    vi.clearAllMocks();

    // A model bound to the field gets what's typed, and hands it back.
    input({ detail: { value: 'Ada L' } });
    el.setProperty('value', 'Ada L');
    expect(globalThis.__InvokeUIMethod).not.toHaveBeenCalled();

    // The app taking the field back to its old text.
    el.setProperty('value', 'Ada');
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledWith(
      el.element,
      'setValue',
      { value: 'Ada' },
      expect.any(Function),
    );
  });

  it('hears what the user types in a field the app has no listener on', () => {
    const el = field();

    el.setProperty('value', 'Ada');
    el.setProperty('value', 'Grace');

    // The runtime's own, once.
    const inputs = (
      globalThis.__AddEvent as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([, , name]) => name === 'input');
    expect(inputs).toHaveLength(1);
    expect(handlerFor('input')({ detail: { value: 'x' } })).toBeUndefined();
  });

  it("doesn't take an input event without text for what's typed", () => {
    const el = field();
    el.setProperty('value', 'Ada');
    handlerFor('input')({});
    vi.clearAllMocks();

    el.setProperty('value', 'Ada');

    expect(globalThis.__InvokeUIMethod).not.toHaveBeenCalled();
  });

  it("sets the text whatever it was while a main-thread directive has the field's input", () => {
    const el = field();
    el.setProperty('value', 'Ada');
    el.holdNativeEvent('input');
    vi.clearAllMocks();

    // What's typed goes to the directive's handler, not the element's.
    el.setProperty('value', 'Ada');

    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(1);
  });

  it('counts a setValue the app calls itself as the text the field has', () => {
    const el = field();
    el.setProperty('value', 'Ada');

    el.invoke('setValue', { value: 'Grace' });
    vi.clearAllMocks();
    el.setProperty('value', 'Grace');
    expect(globalThis.__InvokeUIMethod).not.toHaveBeenCalled();

    el.invoke('setValue', {});
    vi.clearAllMocks();
    el.setProperty('value', '');
    expect(globalThis.__InvokeUIMethod).not.toHaveBeenCalled();
  });

  it('is only setValue on Lynx for Web, whose fields take it at once', () => {
    vi.stubGlobal('__WEB__', true);
    const el = field();

    el.setProperty('value', 'Ada');

    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledWith(
      el.element,
      'setValue',
      { value: 'Ada' },
      expect.any(Function),
    );
    expect(globalThis.__SetAttribute).not.toHaveBeenCalled();
  });

  it("is an attribute on an element that isn't a text field", () => {
    const el = field('view');

    el.setProperty('value', 'x');

    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      el.element,
      'value',
      'x',
    );
    expect(globalThis.__InvokeUIMethod).not.toHaveBeenCalled();
  });
});

describe('LynxElement invoke on an element native has no UI for yet', () => {
  it('calls it again after the change detection flush', () => {
    answerWith(NO_UI_FOR_NODE);
    const el = field();
    setInsideChangeDetection(true);

    el.invoke('scrollIntoView', { block: 'center' });
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(1);

    // LynxRendererFactory2.end(), right after its flush.
    answerWith(0);
    LynxElement.commitPendingInvokes();

    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(2);
    expect(globalThis.__InvokeUIMethod).toHaveBeenLastCalledWith(
      el.element,
      'scrollIntoView',
      { block: 'center' },
      expect.any(Function),
    );
    // Not again at the next one.
    LynxElement.commitPendingInvokes();
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(2);
  });

  it('flushes outside change detection, and calls it again after', async () => {
    answerWith(NO_UI_FOR_NODE);
    const el = field();

    el.invoke('focus');
    answerWith(0);
    await flushMicrotasks();

    expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(1);
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(2);
  });

  it('calls it again only once', () => {
    answerWith(NO_UI_FOR_NODE);
    const el = field();
    setInsideChangeDetection(true);

    el.invoke('focus');
    LynxElement.commitPendingInvokes();
    LynxElement.commitPendingInvokes();

    // Still no UI after the flush: the element isn't on the page.
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(2);
  });

  it("doesn't call a method native ran, or answered otherwise", () => {
    answerWith(0);
    const el = field();
    setInsideChangeDetection(true);

    el.invoke('focus');
    answerWith(1);
    el.invoke('blur');
    LynxElement.commitPendingInvokes();

    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledTimes(2);
  });
});

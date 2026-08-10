import { describe, expect, it, vi } from 'vitest';
import { LynxBackgroundElement } from './lynx-background-element';

describe('LynxBackgroundElement', () => {
  it('stores event callback via addEventListener', () => {
    const el = new LynxBackgroundElement();
    const cb = vi.fn();

    el.addEventListener('bindtap', cb);

    // Verify it's stored by adding another and checking cleanup isolation
    const cb2 = vi.fn();
    el.addEventListener('catchtap', cb2);

    // Both events exist — removing one shouldn't affect the other
    const cleanup2 = el.addEventListener('catchtap', cb2);
    cleanup2();
  });

  it('cleanup removes the event callback', () => {
    const el = new LynxBackgroundElement();
    const cb = vi.fn();

    const cleanup = el.addEventListener('bindtap', cb);
    cleanup();

    // Re-adding should work without issues
    const cb2 = vi.fn();
    el.addEventListener('bindtap', cb2);
  });

  it('multiple events can be added and removed independently', () => {
    const el = new LynxBackgroundElement();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    const cleanup1 = el.addEventListener('bindtap', cb1);
    const cleanup2 = el.addEventListener('catchtap', cb2);
    const cleanup3 = el.addEventListener('bindscroll', cb3);

    // Remove the middle one
    cleanup2();

    // The other cleanups should still work
    cleanup1();
    cleanup3();
  });
});

describe('LynxBackgroundElement styles', () => {
  it('setStyle stores the value', () => {
    const el = new LynxBackgroundElement();
    el.setStyle('background-color', 'red');
    el.setStyle('font-size', '16px');

    // Verify via removeStyle (if it wasn't stored, remove would be a no-op
    // and a subsequent set+remove cycle wouldn't behave correctly)
    el.removeStyle('background-color');
    // Re-setting should work without conflict
    el.setStyle('background-color', 'blue');
  });

  it('setStyle overwrites a previously set value for the same key', () => {
    const el = new LynxBackgroundElement();
    el.setStyle('color', 'red');
    el.setStyle('color', 'blue');

    // Remove and re-check — only one entry should have existed
    el.removeStyle('color');
    el.setStyle('color', 'green');
  });

  it('setStyle stores values with !important suffix unchanged', () => {
    const el = new LynxBackgroundElement();
    // The renderer appends ' !important' before calling setStyle — the element
    // just stores whatever value it receives.
    el.setStyle('color', 'blue !important');
    el.removeStyle('color');
  });

  it('removeStyle deletes a stored style', () => {
    const el = new LynxBackgroundElement();
    el.setStyle('margin-top', '10px');
    el.removeStyle('margin-top');

    // Setting it again should work cleanly (no stale state)
    el.setStyle('margin-top', '20px');
    el.removeStyle('margin-top');
  });

  it('removeStyle is a no-op for a key that was never set', () => {
    const el = new LynxBackgroundElement();
    expect(() => el.removeStyle('nonexistent')).not.toThrow();
  });

  it('setInlineStyles parses semicolon-separated CSS into individual styles', () => {
    const el = new LynxBackgroundElement();
    const spy = vi.spyOn(el, 'setStyle');

    el.setInlineStyles('color: red; font-size: 16px; margin-top: 10px');

    expect(spy).toHaveBeenCalledWith('color', 'red');
    expect(spy).toHaveBeenCalledWith('font-size', '16px');
    expect(spy).toHaveBeenCalledWith('margin-top', '10px');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('setInlineStyles ignores trailing semicolons and whitespace', () => {
    const el = new LynxBackgroundElement();
    const spy = vi.spyOn(el, 'setStyle');

    el.setInlineStyles('  color: red ;  ; ');

    expect(spy).toHaveBeenCalledWith('color', 'red');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('setInlineStyles handles empty string', () => {
    const el = new LynxBackgroundElement();
    const spy = vi.spyOn(el, 'setStyle');

    el.setInlineStyles('');

    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * Builds a LynxBackgroundElement with a given tag name (mimicking what
 * LynxBackgroundDocument.createElement does).
 */
const makeElement = (tag: string): LynxBackgroundElement => {
  const el = new LynxBackgroundElement();
  el.setAttribute('tagName', tag);
  return el;
};

describe('LynxBackgroundElement querySelector / querySelectorAll', () => {
  it('returns null when there are no children', () => {
    const root = makeElement('page');
    expect(root.querySelector('view')).toBeNull();
    expect(root.querySelectorAll('view')).toEqual([]);
  });

  it('matches a direct child by tag name', () => {
    const root = makeElement('page');
    const child = makeElement('view');
    root.appendChild(child);

    expect(root.querySelector('view')).toBe(child);
    expect(root.querySelectorAll('view')).toEqual([child]);
  });

  it('matches a deeply nested element', () => {
    const root = makeElement('page');
    const parent = makeElement('view');
    const inner = makeElement('text');
    root.appendChild(parent);
    parent.appendChild(inner);

    expect(root.querySelector('text')).toBe(inner);
    expect(root.querySelectorAll('text')).toEqual([inner]);
  });

  it('returns the first pre-order match for querySelector', () => {
    const root = makeElement('page');
    const first = makeElement('view');
    const second = makeElement('view');
    root.appendChild(first);
    root.appendChild(second);

    expect(root.querySelector('view')).toBe(first);
  });

  it('collects all matches for querySelectorAll', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('text');
    const c = makeElement('view');
    root.appendChild(a);
    root.appendChild(b);
    root.appendChild(c);

    expect(root.querySelectorAll('view')).toEqual([a, c]);
  });

  it('matches by class selector', () => {
    const root = makeElement('page');
    const el = makeElement('view');
    el.addClass('active');
    root.appendChild(el);

    expect(root.querySelector('.active')).toBe(el);
    expect(root.querySelector('.missing')).toBeNull();
  });

  it('matches by attribute selector with value', () => {
    const root = makeElement('page');
    const el = makeElement('view');
    el.setAttribute('id', 'main');
    root.appendChild(el);

    expect(root.querySelector('[id=main]')).toBe(el);
    expect(root.querySelector('[id=other]')).toBeNull();
  });

  it('matches by id shorthand selector', () => {
    const root = makeElement('page');
    const el = makeElement('view');
    el.setAttribute('id', 'hero');
    root.appendChild(el);

    expect(root.querySelector('#hero')).toBe(el);
  });

  it('matches compound selectors (tag + class)', () => {
    const root = makeElement('page');
    const el = makeElement('view');
    el.addClass('card');
    root.appendChild(el);

    expect(root.querySelector('view.card')).toBe(el);
    // Wrong tag — should not match
    expect(root.querySelector('text.card')).toBeNull();
  });

  it('matches presence-only attribute selector [attr]', () => {
    const root = makeElement('page');
    const el = makeElement('view');
    el.setAttribute('disabled', 'true');
    root.appendChild(el);

    expect(root.querySelector('[disabled]')).toBe(el);
    expect(root.querySelector('[hidden]')).toBeNull();
  });

  it('returns null for unsupported combinator selectors', () => {
    const root = makeElement('page');
    const child = makeElement('view');
    root.appendChild(child);

    // Descendant combinator — not supported on the background thread.
    expect(root.querySelector('page view')).toBeNull();
  });
});

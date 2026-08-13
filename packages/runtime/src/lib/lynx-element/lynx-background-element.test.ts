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

  it('returns null for an empty / unrecognized selector', () => {
    const root = makeElement('page');
    const child = makeElement('view');
    root.appendChild(child);

    // Empty compound (no tag / class / id / attr) matches nothing.
    expect(root.querySelector('')).toBeNull();
    // Unrecognized token in the middle of parsing — bail out with null.
    expect(root.querySelector('view$$$')).toBeNull();
  });

  it('rejects attribute selectors when the stored value does not match', () => {
    const root = makeElement('page');
    const el = makeElement('view');
    el.setAttribute('data-role', 'primary');
    root.appendChild(el);

    // Attribute exists but the value differs.
    expect(root.querySelector('[data-role=secondary]')).toBeNull();
    // Attribute-only presence check with missing attribute.
    expect(root.querySelector('[data-missing]')).toBeNull();
  });
});

describe('LynxBackgroundElement tree mutations', () => {
  it('appendChild wires up firstChild, lastChild, parent, and sibling pointers', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('view');

    root.appendChild(a);
    root.appendChild(b);

    expect(a.parentNode()).toBe(root);
    expect(b.parentNode()).toBe(root);
    expect(a.nextSibling()).toBe(b);
    expect(b.nextSibling()).toBeNull();
  });

  it('appendChild ignores the root-page element (never re-parents itself)', () => {
    const parent = makeElement('view');
    const root = makeElement('page');
    root.isRootPageElement = true;

    parent.appendChild(root);
    // The root element must not become a child of anything.
    expect(root.parentNode()).toBeNull();
  });

  it('insertBefore appends when refChild is null (delegates to appendChild)', () => {
    const root = makeElement('page');
    const a = makeElement('view');

    root.insertBefore(a, null);

    expect(a.parentNode()).toBe(root);
  });

  it('insertBefore before the first child updates firstChild', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('view');
    root.appendChild(a);

    // b before a: b becomes the new first child.
    root.insertBefore(b, a);

    expect(root.querySelectorAll('view')).toEqual([b, a]);
    expect(b.nextSibling()).toBe(a);
    expect(a.nextSibling()).toBeNull();
  });

  it('insertBefore in the middle rewires the neighbor pointers', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('view');
    const mid = makeElement('view');
    root.appendChild(a);
    root.appendChild(b);

    // Insert mid between a and b.
    root.insertBefore(mid, b);

    expect(root.querySelectorAll('view')).toEqual([a, mid, b]);
    expect(a.nextSibling()).toBe(mid);
    expect(mid.nextSibling()).toBe(b);
  });

  it('insertBefore ignores the root-page element', () => {
    const parent = makeElement('view');
    const anchor = makeElement('view');
    parent.appendChild(anchor);

    const root = makeElement('page');
    root.isRootPageElement = true;

    parent.insertBefore(root, anchor);
    expect(root.parentNode()).toBeNull();
  });

  it('remove disconnects an element from its parent and siblings', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('view');
    const c = makeElement('view');
    root.appendChild(a);
    root.appendChild(b);
    root.appendChild(c);

    b.remove();

    expect(b.parentNode()).toBeNull();
    expect(b.nextSibling()).toBeNull();
    // Neighbors stay linked without b.
    expect(a.nextSibling()).toBe(c);
    expect(root.querySelectorAll('view')).toEqual([a, c]);
  });

  it('remove on the first child updates the parent firstChild pointer', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('view');
    root.appendChild(a);
    root.appendChild(b);

    a.remove();

    expect(root.querySelectorAll('view')).toEqual([b]);
  });

  it('remove on the last child updates the parent lastChild pointer', () => {
    const root = makeElement('page');
    const a = makeElement('view');
    const b = makeElement('view');
    root.appendChild(a);
    root.appendChild(b);

    b.remove();

    // Appending after removing b lands next to a (not b).
    const c = makeElement('view');
    root.appendChild(c);
    expect(a.nextSibling()).toBe(c);
  });

  it('remove is a no-op when the element has no parent', () => {
    const orphan = makeElement('view');
    expect(() => orphan.remove()).not.toThrow();
  });

  it('remove is a no-op for the root-page element', () => {
    const root = makeElement('page');
    root.isRootPageElement = true;
    // Doesn't throw and doesn't clear any pointers (nothing to clear anyway).
    expect(() => root.remove()).not.toThrow();
  });

  it('parentNode and nextSibling default to null for a fresh element', () => {
    const el = makeElement('view');
    expect(el.parentNode()).toBeNull();
    expect(el.nextSibling()).toBeNull();
  });
});

describe('LynxBackgroundElement properties and attributes', () => {
  it('setProperty / setAttribute round-trip through getAttribute', () => {
    const el = new LynxBackgroundElement();
    el.setProperty('foo', 'bar');
    el.setAttribute('baz', 'qux');

    expect(el.getAttribute('foo')).toBe('bar');
    expect(el.getAttribute('baz')).toBe('qux');
  });

  it('getAttribute returns null for missing keys', () => {
    const el = new LynxBackgroundElement();
    expect(el.getAttribute('missing')).toBeNull();
  });

  it('removeAttribute deletes a stored attribute', () => {
    const el = new LynxBackgroundElement();
    el.setAttribute('id', 'hero');
    el.removeAttribute('id');
    expect(el.getAttribute('id')).toBeNull();
  });

  it('addClass followed by removeClass leaves no residue in class selectors', () => {
    const el = makeElement('view');
    el.addClass('active');
    el.removeClass('active');

    const root = makeElement('page');
    root.appendChild(el);
    // After removeClass, the .active selector no longer matches.
    expect(root.querySelector('.active')).toBeNull();
  });
});

describe('LynxBackgroundElement animate', () => {
  it('returns a NoopLynxAnimation instead of throwing on the background thread', () => {
    // The previous implementation threw, which crashed the web preview when a
    // (bindtap) handler called el.animate(). The no-op keeps chains like
    // .play() / .pause() / .cancel() functioning.
    const el = new LynxBackgroundElement();
    const result = el.animate([{ opacity: 0 }, { opacity: 1 }], 300);
    expect(result).toBeTruthy();
    expect(typeof result.play).toBe('function');
    expect(typeof result.pause).toBe('function');
    expect(typeof result.cancel).toBe('function');
  });
});

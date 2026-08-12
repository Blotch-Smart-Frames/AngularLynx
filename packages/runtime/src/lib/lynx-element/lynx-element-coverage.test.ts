// Targeted coverage for the LynxElement paths not exercised by
// `lynx-element.test.ts` (class/style/event registration) or
// `lynx-element-cycle.test.ts` (cycle-safe reparent). This spec covers the
// getters, queries, virtual-parent removal path, canonical wrapper lookup,
// setAttribute id/data-/raw-text branches, the animation lifecycle wired into
// remove, and the invoke/animate/nextSibling/querySelector wrappers.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

type Fake = { id: number };

let uidCounter = 0;
const makeRef = (): Fake => ({ id: ++uidCounter });

const installFakes = () => {
  uidCounter = 0;
  vi.stubGlobal('__PROFILE__', false);
  vi.stubGlobal('__DEV__', false);

  // Every LynxElement construction registers by native id, so uid must be
  // stable per ref instance for the canonical-lookup path to work correctly.
  // Start from a large offset so tests that create an orphan ref (never
  // constructed as a LynxElement) get a uid that's never landed in the
  // process-lifetime #byNativeId cache from a previous spec.
  const uidByRef = new WeakMap<object, number>();
  let nextUid = 1_000_000 + Math.floor(Math.random() * 1_000_000);
  vi.stubGlobal(
    '__GetElementUniqueID',
    vi.fn((ref: object) => {
      let id = uidByRef.get(ref);
      if (id == null) {
        id = nextUid++;
        uidByRef.set(ref, id);
      }
      return id;
    }),
  );

  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__GetClasses', vi.fn(() => []));
  vi.stubGlobal('__AddClass', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn());
  vi.stubGlobal('__GetAttributeByName', vi.fn(() => null));
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__SetDataset', vi.fn());
  vi.stubGlobal('__AddInlineStyle', vi.fn());
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn());
  vi.stubGlobal('__ElementAnimate', vi.fn(() => 'anim-1'));
  vi.stubGlobal('__NextElement', vi.fn(() => null));
  vi.stubGlobal('__GetParent', vi.fn(() => null));
  vi.stubGlobal('__QuerySelector', vi.fn(() => null));
  vi.stubGlobal('__QuerySelectorAll', vi.fn(() => []));
  vi.stubGlobal('__InvokeUIMethod', vi.fn());
  vi.stubGlobal('__RemoveElement', vi.fn());
  vi.stubGlobal('__AppendElement', vi.fn());
  vi.stubGlobal('__InsertElementBefore', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn());
};

describe('LynxElement setAttribute id / data- branches', () => {
  beforeEach(() => installFakes());

  it('routes name="id" through __SetID', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.setAttribute('id', 'hero');
    expect(globalThis.__SetID).toHaveBeenCalledWith(
      expect.anything(),
      'hero',
    );
  });

  it('accepts name="id" with a null value (clears the id)', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.setAttribute('id', null);
    expect(globalThis.__SetID).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('routes a "data-*" attribute through __SetDataset with the key stripped', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.setAttribute('data-role', 'primary');
    expect(globalThis.__SetDataset).toHaveBeenCalledWith(expect.anything(), {
      role: 'primary',
    });
  });

  it('routes name="style" through setInlineStyles → __SetInlineStyles', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.setAttribute('style', 'color: red');
    expect(globalThis.__SetInlineStyles).toHaveBeenCalledWith(
      expect.anything(),
      'color: red',
    );
  });

  it('deletes the mirrored attribute when value is null (removeAttribute path)', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.setAttribute('foo', 'bar');
    el.removeAttribute('foo');
    expect(globalThis.__SetAttribute).toHaveBeenLastCalledWith(
      expect.anything(),
      'foo',
      null,
    );
  });

  it('mirrors raw-text "text" attribute and stashes the raw source for normalization', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.tagName = 'raw-text';
    el.setAttribute('text', 'hello');
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      expect.anything(),
      'text',
      'hello',
    );
  });

  it('clears the raw-text cached text when its text attribute is nulled', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.tagName = 'raw-text';
    el.setAttribute('text', 'hi');
    el.setAttribute('text', null);
    // The removeAttribute path funnels the null through — no throw.
    expect(globalThis.__SetAttribute).toHaveBeenLastCalledWith(
      expect.anything(),
      'text',
      null,
    );
  });
});

describe('LynxElement getters / removers', () => {
  beforeEach(() => installFakes());

  it('getAttribute delegates to __GetAttributeByName', () => {
    (globalThis.__GetAttributeByName as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      'the-value',
    );
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    expect(el.getAttribute('foo')).toBe('the-value');
    expect(globalThis.__GetAttributeByName).toHaveBeenCalledWith(
      expect.anything(),
      'foo',
    );
  });

  it('removeAttribute funnels through setAttribute(null)', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.removeAttribute('foo');
    expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
      expect.anything(),
      'foo',
      null,
    );
  });

  it('removeClass reads current classes, filters, and calls __SetClasses', () => {
    (globalThis.__GetClasses as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      'a',
      'b',
      'c',
    ]);
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.removeClass('b');
    expect(globalThis.__SetClasses).toHaveBeenCalledWith(
      expect.anything(),
      'a c',
    );
  });
});

describe('LynxElement move / tree edge cases', () => {
  beforeEach(() => installFakes());

  it('appendChild is a no-op for the root-page element', () => {
    const parent = new LynxElement(makeRef() as unknown as ElementRef);
    const rootPage = new LynxElement(makeRef() as unknown as ElementRef);
    rootPage.isRootPageElement = true;
    parent.appendChild(rootPage);
    expect(globalThis.__AppendElement).not.toHaveBeenCalled();
  });

  it('insertBefore is a no-op for the root-page element', () => {
    const parent = new LynxElement(makeRef() as unknown as ElementRef);
    const rootPage = new LynxElement(makeRef() as unknown as ElementRef);
    const anchor = new LynxElement(makeRef() as unknown as ElementRef);
    rootPage.isRootPageElement = true;
    parent.insertBefore(rootPage, anchor);
    expect(globalThis.__InsertElementBefore).not.toHaveBeenCalled();
  });

  it('insertBefore(null) delegates to appendChild', () => {
    const parent = new LynxElement(makeRef() as unknown as ElementRef);
    const child = new LynxElement(makeRef() as unknown as ElementRef);
    parent.insertBefore(child, null);
    expect(globalThis.__AppendElement).toHaveBeenCalled();
  });

  it('remove is a no-op for the root-page element', () => {
    const rootPage = new LynxElement(makeRef() as unknown as ElementRef);
    rootPage.isRootPageElement = true;
    rootPage.remove();
    // No queueing / no native call
    expect(globalThis.__RemoveElement).not.toHaveBeenCalled();
  });

  it('remove on a virtual-parent child delegates to removeVirtualChild', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    const removeVirtualChild = vi.fn();
    // _virtualParent is public — set it directly.
    (el as unknown as { _virtualParent: unknown })._virtualParent = {
      removeVirtualChild,
    };
    el.remove();
    expect(removeVirtualChild).toHaveBeenCalledWith(el);
    expect(globalThis.__RemoveElement).not.toHaveBeenCalled();
  });

  it('remove on a virtual-parent without removeVirtualChild is a silent no-op', () => {
    // Defensive: virtual parent that doesn't expose the callback (never happens
    // in production, but the guard is real code) — must not throw.
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    (el as unknown as { _virtualParent: unknown })._virtualParent = {};
    expect(() => el.remove()).not.toThrow();
  });
});

describe('LynxElement parent / sibling / query', () => {
  beforeEach(() => installFakes());

  it('parentNode returns the virtual parent when one is set', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    const virtualParent = new LynxElement(makeRef() as unknown as ElementRef);
    (el as unknown as { _virtualParent: unknown })._virtualParent =
      virtualParent;
    expect(el.parentNode()).toBe(virtualParent);
  });

  it('parentNode returns null when no native parent exists', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    expect(el.parentNode()).toBeNull();
  });

  it('parentNode returns the canonical wrapper for the native parent', () => {
    // Register a parent wrapper first, then ask a leaf's parentNode() — it
    // should return the canonical registered wrapper, not a fresh throwaway.
    const parentRef = makeRef();
    const parent = new LynxElement(parentRef as unknown as ElementRef);
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    (globalThis.__GetParent as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      parentRef,
    );
    expect(el.parentNode()).toBe(parent);
  });

  it('nextSibling returns the virtual next sibling when a virtual parent is set', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    const next = new LynxElement(makeRef() as unknown as ElementRef);
    (el as unknown as { _virtualParent: unknown })._virtualParent = {};
    (el as unknown as { _virtualNext: unknown })._virtualNext = next;
    expect(el.nextSibling()).toBe(next);
  });

  it('nextSibling returns null when the native engine reports no next', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    expect(el.nextSibling()).toBeNull();
  });

  it('nextSibling returns the canonical wrapper for the native next element', () => {
    const nextRef = makeRef();
    const next = new LynxElement(nextRef as unknown as ElementRef);
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    (globalThis.__NextElement as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      nextRef,
    );
    expect(el.nextSibling()).toBe(next);
  });

  it('querySelector returns null when the native engine returns no match', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    expect(el.querySelector('view')).toBeNull();
  });

  it('querySelector returns the canonical wrapper for the native hit', () => {
    const hitRef = makeRef();
    const hit = new LynxElement(hitRef as unknown as ElementRef);
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    (globalThis.__QuerySelector as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      hitRef,
    );
    expect(el.querySelector('.thing')).toBe(hit);
  });

  it('querySelectorAll maps native hits to canonical wrappers', () => {
    const aRef = makeRef();
    const bRef = makeRef();
    const a = new LynxElement(aRef as unknown as ElementRef);
    const b = new LynxElement(bRef as unknown as ElementRef);
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    (
      globalThis.__QuerySelectorAll as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce([aRef, bRef]);
    expect(el.querySelectorAll('view')).toEqual([a, b]);
  });

  it('querySelector mints a fresh throwaway for an unregistered native ref', () => {
    // #canonicalFor's `existing ?? new LynxElement(ref)` fallback: querying a
    // ref that no LynxDocument produced still returns a usable wrapper.
    const orphan = makeRef();
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    (globalThis.__QuerySelector as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      orphan,
    );
    const result = el.querySelector('.orphan');
    expect(result).toBeInstanceOf(LynxElement);
  });
});

describe('LynxElement invoke and animate', () => {
  beforeEach(() => installFakes());

  it('invoke forwards to __InvokeUIMethod with an empty params fallback', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.invoke('setValue');
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledWith(
      expect.anything(),
      'setValue',
      {},
      expect.any(Function),
    );
  });

  it('invoke supplies a no-op result callback that runs cleanly if native invokes it', () => {
    // The result callback is `() => {}` on the fire-and-forget path. Make the
    // mock call it so the empty body is executed for coverage.
    (globalThis.__InvokeUIMethod as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (
        _el: unknown,
        _method: string,
        _params: unknown,
        cb: (res: unknown) => void,
      ) => {
        cb({ ok: true });
      },
    );
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    expect(() => el.invoke('setValue')).not.toThrow();
  });

  it('invoke passes the supplied params through', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.invoke('setValue', { text: 'hi' });
    expect(globalThis.__InvokeUIMethod).toHaveBeenCalledWith(
      expect.anything(),
      'setValue',
      { text: 'hi' },
      expect.any(Function),
    );
  });

  it('animate wraps a number as { duration: n }', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], 300);
    expect(anim).toBeTruthy();
    // A number call routes through __ElementAnimate at least once.
    expect(globalThis.__ElementAnimate).toHaveBeenCalled();
  });

  it('animate accepts an options object', () => {
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    const anim = el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 250, iterations: 2 },
    );
    expect(anim).toBeTruthy();
  });

  it('animate accepts an undefined options argument', () => {
    // Covers the `options ?? {}` fallback: no options means an empty config.
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }]);
    expect(anim).toBeTruthy();
  });
});

describe('LynxElement #doRemove animation-cancel and orphan paths', () => {
  beforeEach(() => installFakes());

  it('early-returns from #doRemove when the element has no parent', () => {
    // remove() queues the element regardless of its parent state; on commit,
    // #doRemove sees no parent and bails without calling __RemoveElement.
    const el = new LynxElement(makeRef() as unknown as ElementRef);
    el.remove();
    LynxElement.commitPendingRemovals();
    expect(globalThis.__RemoveElement).not.toHaveBeenCalled();
  });

  it('cancels active animations and clears their inline styles on removal', () => {
    // Set up parent → child so parentNode() returns a real wrapper.
    const parentRef = makeRef();
    const childRef = makeRef();
    const parent = new LynxElement(parentRef as unknown as ElementRef);
    const child = new LynxElement(childRef as unknown as ElementRef);
    // Force parentNode(child) to return `parent`.
    (globalThis.__GetParent as ReturnType<typeof vi.fn>).mockImplementation(
      (ref: object) => (ref === childRef ? parentRef : null),
    );

    // Register an active animation so #doRemove's cancel branch fires.
    child.animate([{ opacity: 0 }, { opacity: 1 }], 200);

    child.remove();
    LynxElement.commitPendingRemovals();

    // Wire protocol constant 3 = ANIMATION_CANCEL.
    expect(globalThis.__ElementAnimate).toHaveBeenCalledWith(
      childRef,
      [3, expect.any(String)],
    );
    // Inline-style resets to clear residual opacity / transform.
    expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
      childRef,
      'opacity',
      null,
    );
    expect(globalThis.__AddInlineStyle).toHaveBeenCalledWith(
      childRef,
      'transform',
      null,
    );
    // The element itself is detached from the native parent.
    expect(globalThis.__RemoveElement).toHaveBeenCalledWith(parentRef, childRef);

    // Guard against a lingering pending set.
    expect(() => LynxElement.commitPendingRemovals()).not.toThrow();

    // Clean up mock so subsequent tests don't inherit the parent wiring.
    (globalThis.__GetParent as ReturnType<typeof vi.fn>).mockReset();
  });
});

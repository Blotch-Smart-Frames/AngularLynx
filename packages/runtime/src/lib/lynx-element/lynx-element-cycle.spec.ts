// Cycle-safety harness for LynxElement's reparent paths. Lynx's element APIs do
// NOT guard against attaching a node into its own subtree — the native layout
// pass would then walk child→child forever — so LynxElement guards every
// attach with wouldFormCycle(). This exercises those paths against a faithful
// in-memory native tree that will actually build a cycle if the renderer asks
// for one, and asserts the renderer never does.
//
// Context: the on-device `LynxTransition` panel freeze that originally motivated
// these guards was NOT a genuine tree cycle (that would stack-overflow instantly,
// not trip the 5s watchdog). Its real cause was the renderer's old "parking"
// mechanism — detaching a removed element's children and stashing them elsewhere
// to survive re-projection — which has since been removed entirely (see #doRemove
// in lynx-element.ts). The wouldFormCycle guards remain valid defensive code for
// the separate, real cyclic-attach hazard that a reorder/re-projection can still
// request.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeNativeGlobal } from '../testing/fake-native-global';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

// --- Faithful fake native tree ------------------------------------------------
// Unlike a defensive fake, __AppendElement/__InsertElementBefore here build
// EXACTLY what they're told — including a cycle — so a missing guard surfaces as
// a detectable cycle rather than being silently absorbed.
type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  classes: Set<string>;
  styles: Map<string, unknown>;
};

let nextId = 1;
let pageRoot: FakeEl;

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  classes: new Set(),
  styles: new Map(),
});

const detach = (child: FakeEl): void => {
  const p = child.parent;
  if (!p) return;
  const i = p.children.indexOf(child);
  if (i >= 0) p.children.splice(i, 1);
  child.parent = null;
};

const installNativeFakes = (): void => {
  nextId = 1;
  pageRoot = makeEl('page');
  const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;

  g.__GetElementUniqueID = (n: FakeEl) => n.id;
  g.__GetTag = (n: FakeEl) => n.tag;
  g.__GetParent = (n: FakeEl) => n.parent ?? null;
  g.__GetChildren = (n: FakeEl) => n.children.slice();

  // Deliberately NO cycle guard — mirrors the real engine, which happily builds
  // a self-referential tree. detach-then-attach mirrors Lynx auto-reparenting.
  g.__AppendElement = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    parent.children.push(child);
    child.parent = parent;
    return child;
  };
  g.__InsertElementBefore = (parent: FakeEl, child: FakeEl, ref: FakeEl) => {
    detach(child);
    const i = parent.children.indexOf(ref);
    parent.children.splice(i < 0 ? parent.children.length : i, 0, child);
    child.parent = parent;
    return child;
  };
  g.__RemoveElement = (parent: FakeEl, child: FakeEl) => {
    const i = parent.children.indexOf(child);
    if (i >= 0) parent.children.splice(i, 1);
    child.parent = null;
    return child;
  };

  g.__GetClasses = (n: FakeEl) => [...n.classes];
  g.__SetClasses = (n: FakeEl, s: string | undefined) => {
    n.classes = new Set((s ?? '').split(/\s+/).filter(Boolean));
  };
  g.__AddInlineStyle = (n: FakeEl, key: string, value: unknown) => {
    if (value == null) n.styles.delete(key);
    else n.styles.set(key, value);
  };
  g.__ElementAnimate = () => {};
};

/**
 * Walks the tree cycle-safely; throws if any node is reached twice (the native
 * failure the wouldFormCycle guards prevent). Returns the reachable node count.
 */
const assertAcyclic = (): number => {
  const seen = new Set<FakeEl>();
  let count = 0;
  const walk = (n: FakeEl): void => {
    for (const c of n.children) {
      if (seen.has(c)) {
        throw new Error(
          `CYCLE: #${c.id} <${c.tag}> reachable twice in the native tree`,
        );
      }
      seen.add(c);
      count++;
      walk(c);
    }
  };
  walk(pageRoot);
  return count;
};

const wrap = (fake: FakeEl, tag: string): LynxElement => {
  const el = new LynxElement(fake as unknown as ElementRef);
  el.tagName = tag;
  return el;
};

describe('LynxElement reparent cycle safety', () => {
  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    installNativeFakes();
  });

  it('refuses appendChild of an element into its own descendant', () => {
    const parentFake = makeEl('view');
    const childFake = makeEl('view');
    const parent = wrap(parentFake, 'view');
    const child = wrap(childFake, 'view');

    wrap(pageRoot, 'page').appendChild(parent);
    parent.appendChild(child); // page > parent > child

    // Asking to append the parent under its own child would form a cycle.
    child.appendChild(parent);

    expect(() => assertAcyclic()).not.toThrow();
    // parent was NOT moved under child.
    expect(childFake.children).not.toContain(parentFake);
  });

  it('refuses insertBefore of an element into its own descendant', () => {
    const parentFake = makeEl('view');
    const aFake = makeEl('view');
    const bFake = makeEl('view');
    const parent = wrap(parentFake, 'view');
    const a = wrap(aFake, 'view');
    const b = wrap(bFake, 'view');

    const page = wrap(pageRoot, 'page');
    page.appendChild(parent);
    parent.appendChild(a);
    parent.appendChild(b); // page > parent > [a, b]

    // Insert parent before b, but into a (parent's own child) → would cycle.
    a.insertBefore(parent, b);

    expect(() => assertAcyclic()).not.toThrow();
    expect(aFake.children).not.toContain(parentFake);
  });

  it('still performs a normal (non-cyclic) reparent', () => {
    const aFake = makeEl('view');
    const bFake = makeEl('view');
    const childFake = makeEl('view');
    const page = wrap(pageRoot, 'page');
    const a = wrap(aFake, 'view');
    const b = wrap(bFake, 'view');
    const child = wrap(childFake, 'view');

    page.appendChild(a);
    page.appendChild(b);
    a.appendChild(child); // page > a > child, page > b

    // Move child from a to b — a legitimate reparent, must go through.
    b.appendChild(child);

    expect(childFake.parent).toBe(bFake);
    expect(aFake.children).not.toContain(childFake);
    expect(() => assertAcyclic()).not.toThrow();
  });
});

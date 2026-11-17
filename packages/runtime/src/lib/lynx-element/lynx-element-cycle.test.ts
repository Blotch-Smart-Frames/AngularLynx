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
import { setPageElementRef } from '../lynx-document/page-ref';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';
import { noteNativeTreeChanged } from './tree-version';

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
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;

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

  it('refuses appendChild of an element without children into itself', () => {
    const leafFake = makeEl('view');
    const leaf = wrap(leafFake, 'view');

    leaf.appendChild(leaf);

    expect(leafFake.children).toEqual([]);
    expect(leafFake.parent).toBeNull();
  });

  it('still inserts an element with children that is in no tree yet', () => {
    // An embedded view's root, built with its children before Angular
    // inserts it: the walk runs, and finds no cycle.
    const page = wrap(pageRoot, 'page');
    const container = wrap(makeEl('view'), 'view');
    page.appendChild(container);
    const rootFake = makeEl('view');
    const root = wrap(rootFake, 'view');
    root.appendChild(wrap(makeEl('view'), 'view'));

    container.appendChild(root);

    expect(rootFake.parent).toBe(container.element);
    expect(() => assertAcyclic()).not.toThrow();
  });
});

// Angular appends each element right after creating it, before its children,
// and an @for reorder moves rows within their parent: neither can form a
// cycle, which wouldFormCycle answers without walking the new parent's
// ancestors (two native reads a level, each __GetParent a new handle).
describe('LynxElement cycle check cost', () => {
  const counts = { parent: 0, uid: 0, first: 0 };

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    installNativeFakes();
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const { __GetParent, __GetElementUniqueID, __FirstElement } = g;
    g.__GetParent = (n) => (counts.parent++, __GetParent(n));
    g.__GetElementUniqueID = (n) => (counts.uid++, __GetElementUniqueID(n));
    g.__FirstElement = (n) => (counts.first++, __FirstElement(n));
  });

  /**
   * A chain of `depth` views under the page; returns the deepest.
   */
  const chain = (depth: number): LynxElement => {
    let bottom = wrap(pageRoot, 'page');
    for (let i = 0; i < depth; i++) {
      const next = wrap(makeEl('view'), 'view');
      bottom.appendChild(next);
      bottom = next;
    }
    return bottom;
  };

  const resetCounts = (): void => {
    counts.parent = 0;
    counts.uid = 0;
    counts.first = 0;
  };

  it('appends new elements 20 levels down with a few native reads each', () => {
    const bottom = chain(20);
    const text = wrap(makeEl('text'), 'text');
    bottom.appendChild(text);
    const views = Array.from({ length: 100 }, () =>
      wrap(makeEl('view'), 'view'),
    );
    const runs = Array.from({ length: 100 }, () =>
      wrap(makeEl('raw-text'), 'raw-text'),
    );
    resetCounts();

    // A view's children go through #flowInsert and #attach, a <text>'s
    // through #append.
    for (const view of views) bottom.appendChild(view);
    for (const run of runs) text.appendChild(run);

    // One __GetParent each, for #removeIfMoveWouldBeLost: the ancestors are
    // never walked, and the child's checks run once, not twice. It was 23
    // each. Each wrapper reads its unique id once, when it's made, so the
    // check reads none.
    expect(counts.parent).toBe(200);
    expect(counts.first).toBe(200);
    expect(counts.uid).toBe(0);
    expect((bottom.element as unknown as FakeEl).children.length).toBe(101);
    expect((text.element as unknown as FakeEl).children.length).toBe(100);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('reorders elements with children within their parent without walking its ancestors', () => {
    const bottom = chain(20);
    const rows = Array.from({ length: 3 }, () => {
      const row = wrap(makeEl('view'), 'view');
      bottom.appendChild(row);
      row.appendChild(wrap(makeEl('view'), 'view'));
      return row;
    });
    const [a, b, c] = rows as [LynxElement, LynxElement, LynxElement];
    resetCounts();

    bottom.insertBefore(c, a);
    bottom.appendChild(a);

    // Per move, one for #removeIfMoveWouldBeLost and one for the cycle
    // check's look at the row's parent. The walk cost 21 more.
    expect(counts.parent).toBe(4);
    expect((bottom.element as unknown as FakeEl).children).toEqual([
      c.element,
      b.element,
      a.element,
    ]);
    expect(() => assertAcyclic()).not.toThrow();
  });
});

// What LynxDocument makes is new: in no tree, with nothing in it
// (markUnattached). Building a screen inserts thousands of those, and the
// wrappers answer the checks themselves rather than asking native, which costs
// a call out of JavaScript each (#444).
describe('LynxElement inserting new elements', () => {
  const counts = { parent: 0, uid: 0, first: 0 };

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    installNativeFakes();
    setPageElementRef(pageRoot as unknown as ElementRef);
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const { __GetParent, __GetElementUniqueID, __FirstElement } = g;
    g.__GetParent = (n) => (counts.parent++, __GetParent(n));
    g.__GetElementUniqueID = (n) => (counts.uid++, __GetElementUniqueID(n));
    g.__FirstElement = (n) => (counts.first++, __FirstElement(n));
  });

  /**
   * A new element, as LynxDocument makes one.
   */
  const make = (tag: string): LynxElement => {
    const el = wrap(makeEl(tag), tag);
    el.markUnattached();
    return el;
  };

  const resetCounts = (): void => {
    counts.parent = 0;
    counts.uid = 0;
    counts.first = 0;
  };

  /**
   * A chain of `depth` views under the page; returns the deepest.
   */
  const chain = (depth: number): LynxElement => {
    let bottom = wrap(pageRoot, 'page');
    for (let i = 0; i < depth; i++) {
      const next = make('view');
      bottom.appendChild(next);
      bottom = next;
    }
    return bottom;
  };

  it('inserts new elements without reading the native tree', () => {
    const bottom = chain(20);
    const anchor = make('comment');
    bottom.appendChild(anchor);
    const views = Array.from({ length: 100 }, () => make('view'));
    resetCounts();

    // As an `@for` adds its rows: the anchor's parent, then each row before it.
    for (const view of views) anchor.parentNode()!.insertBefore(view, anchor);

    // The anchor's parent is read once; nothing else is.
    expect(counts.parent).toBe(1);
    expect(counts.first).toBe(0);
    expect(counts.uid).toBe(1);
    expect((bottom.element as unknown as FakeEl).children.length).toBe(101);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it("walks the parent's ancestry once for new elements with children", () => {
    const bottom = chain(20);
    // `<text>{{ i }}</text>` rows: each text has its run before it's inserted.
    const texts = Array.from({ length: 100 }, () => {
      const text = make('text');
      text.appendChild(make('raw-text'));
      return text;
    });
    resetCounts();

    for (const text of texts) bottom.appendChild(text);

    // The 20 levels once, and the page's id to know the walk reached it.
    expect(counts.parent).toBe(21);
    expect(counts.uid).toBe(21);
    expect(counts.first).toBe(0);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('refuses to insert a new element into its own descendant', () => {
    const outer = make('view');
    const inner = make('view');
    outer.appendChild(inner);

    inner.appendChild(outer);

    expect((inner.element as unknown as FakeEl).children).toEqual([]);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('finds a cycle after a move changes an ancestry it walked before', () => {
    const page = wrap(pageRoot, 'page');
    const a = make('view');
    const b = make('view');
    page.appendChild(a);
    page.appendChild(b);
    // Walks b's ancestry, the page alone, for a new element with children.
    const row = make('view');
    row.appendChild(make('view'));
    b.appendChild(row);

    // b moves under a, so a is one of b's ancestors now.
    a.appendChild(b);
    b.appendChild(a);

    expect((a.element as unknown as FakeEl).parent).toBe(pageRoot);
    expect((b.element as unknown as FakeEl).children).not.toContain(a.element);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('reads the parent again once the tree changes shape', () => {
    const page = wrap(pageRoot, 'page');
    const a = make('view');
    const b = make('view');
    const child = make('view');
    page.appendChild(a);
    page.appendChild(b);
    expect(child.parentNode()).toBeNull();

    a.appendChild(child);
    expect(child.parentNode()).toBe(a);
    b.appendChild(child);
    expect(child.parentNode()).toBe(b);
    // A list's updates, which take items out natively, come with a flush.
    (child.element as unknown as FakeEl).parent = null;
    noteNativeTreeChanged();
    expect(child.parentNode()).toBeNull();
  });
});

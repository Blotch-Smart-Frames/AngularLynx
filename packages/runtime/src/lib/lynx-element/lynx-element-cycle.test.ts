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
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;
  g.__NextElement = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;

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
  g.__AddClass = (n: FakeEl, name: string) => {
    n.classes.add(name);
  };
  g.__SetInlineStyles = () => {};
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

  // The refused insert still marks the parent as one whose loose text and
  // inline tags regroup at the end of the cycle (#flowInsert), though it
  // never took the child, so it has no children to regroup.
  it('regroups a childless element an inline tag was refused from', () => {
    const spanFake = makeEl('text');
    const viewFake = makeEl('view');
    const span = wrap(spanFake, 'text');
    span.markWebText(true);
    const view = wrap(viewFake, 'view');

    wrap(pageRoot, 'page').appendChild(span);
    span.appendChild(view); // page > span > view

    // The <span> under its own child would form a cycle.
    view.appendChild(span);

    expect(() => LynxElement.commitPendingFlow()).not.toThrow();
    expect(() => assertAcyclic()).not.toThrow();
    expect(viewFake.children).toEqual([]);
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

  /**
   * A view in no tree with `size` views under it, the last `depth` of them
   * a chain under the first ones (a fan of siblings, then the chain); returns
   * the root and the bottom of the chain.
   */
  const detachedTree = (
    siblings: number,
    depth: number,
  ): { root: LynxElement; bottom: LynxElement } => {
    const root = wrap(makeEl('view'), 'view');
    for (let i = 0; i < siblings; i++) {
      root.appendChild(wrap(makeEl('view'), 'view'));
    }
    let bottom = root;
    for (let i = 0; i < depth; i++) {
      const next = wrap(makeEl('view'), 'view');
      bottom.appendChild(next);
      bottom = next;
    }
    return { root, bottom };
  };

  it('refuses an element in no tree under an element of its small subtree', () => {
    // Found by searching down from the element, which stops short of its
    // limit.
    const { root, bottom } = detachedTree(2, 3);

    bottom.appendChild(root);

    expect((bottom.element as unknown as FakeEl).children).toEqual([]);
    expect((root.element as unknown as FakeEl).parent).toBeNull();
  });

  it('refuses an element in no tree under an element deep in its large subtree', () => {
    // More elements than the search down looks at come before it, so the
    // walk up from the new parent finds the element.
    const { root, bottom } = detachedTree(20, 10);

    bottom.insertBefore(root, null as unknown as LynxElement);

    expect((bottom.element as unknown as FakeEl).children).toEqual([]);
    expect((root.element as unknown as FakeEl).parent).toBeNull();
  });

  it('still inserts an element in no tree with a large subtree', () => {
    const page = wrap(pageRoot, 'page');
    const container = wrap(makeEl('view'), 'view');
    page.appendChild(container);
    const anchor = wrap(makeEl('view'), 'view');
    container.appendChild(anchor);
    const { root } = detachedTree(20, 10);

    container.insertBefore(root, anchor);

    expect((container.element as unknown as FakeEl).children).toEqual([
      root.element,
      anchor.element,
    ]);
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
    // each.
    expect(counts.parent).toBe(200);
    expect(counts.first).toBe(200);
    expect(counts.uid).toBe(400);
    expect((bottom.element as unknown as FakeEl).children.length).toBe(101);
    expect((text.element as unknown as FakeEl).children.length).toBe(100);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('inserts new rows with children 20 levels down without walking its ancestors', () => {
    // An @for row, built with its children before Angular inserts it before
    // the @for's anchor.
    const bottom = chain(20);
    const anchor = wrap(makeEl('view'), 'view');
    bottom.appendChild(anchor);
    const rows = Array.from({ length: 100 }, () => {
      const row = wrap(makeEl('text'), 'text');
      row.appendChild(wrap(makeEl('raw-text'), 'raw-text'));
      return row;
    });
    resetCounts();

    for (const row of rows) bottom.insertBefore(row, anchor);

    // Per row, one for #removeIfMoveWouldBeLost and one for the cycle
    // check's look at the row's parent. Walking up from the new parent
    // cost 20 more each.
    expect(counts.parent).toBe(200);
    expect((bottom.element as unknown as FakeEl).children).toHaveLength(101);
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

    // A move within its parent reads nothing: each wrapper knows its parent
    // is this one. The walk cost 21 more per move, and before that, the
    // checks read the row's parent twice (issue #878).
    expect(counts.parent).toBe(0);
    expect((bottom.element as unknown as FakeEl).children).toEqual([
      c.element,
      b.element,
      a.element,
    ]);
    expect(() => assertAcyclic()).not.toThrow();
  });
});

// LynxDocument marks each element it makes (markNew, or markUnplaced for a
// raw-text or an anchor): its native element is in no tree until the first
// insert, so that insert asks native nothing about where it is. These are an
// @for's rows, each a native read or more the less on PrimJS.
describe('LynxElement inserts of new elements', () => {
  const counts = { parent: 0, uid: 0, first: 0, next: 0 };

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    installNativeFakes();
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const { __GetParent, __GetElementUniqueID, __FirstElement, __NextElement } =
      g;
    g.__GetParent = (n) => (counts.parent++, __GetParent(n));
    g.__GetElementUniqueID = (n) => (counts.uid++, __GetElementUniqueID(n));
    g.__FirstElement = (n) => (counts.first++, __FirstElement(n));
    g.__NextElement = (n) => (counts.next++, __NextElement(n));
  });

  const reads = (): number =>
    counts.parent + counts.uid + counts.first + counts.next;

  const resetCounts = (): void => {
    counts.parent = 0;
    counts.uid = 0;
    counts.first = 0;
    counts.next = 0;
  };

  /**
   * An element as LynxDocument makes it.
   */
  const made = (tag: string): LynxElement => {
    const el = wrap(makeEl(tag), tag);
    if (tag === 'raw-text' || tag === 'comment') el.markUnplaced();
    else el.markNew();
    return el;
  };

  /**
   * A chain of `depth` views under the page; returns the deepest.
   */
  const chain = (depth: number): LynxElement => {
    let bottom = wrap(pageRoot, 'page');
    for (let i = 0; i < depth; i++) {
      const next = made('view');
      bottom.appendChild(next);
      bottom = next;
    }
    return bottom;
  };

  it('puts new views and <text> rows before an anchor with no native reads', () => {
    const bottom = chain(20);
    const anchor = made('comment');
    bottom.appendChild(anchor);
    resetCounts();

    // A view row, and a <text> row built with its raw-text first, as
    // Angular builds `<text>{{ i }}</text>`.
    for (let i = 0; i < 50; i++) {
      bottom.insertBefore(made('view'), anchor);
      const text = made('text');
      text.appendChild(made('raw-text'));
      bottom.insertBefore(text, anchor);
    }

    // Each made element's registration reads its id, and nothing else is
    // read. A view was 7 reads, and a <text> row 16.
    expect(counts.uid).toBe(150);
    expect(reads()).toBe(150);
    expect((bottom.element as unknown as FakeEl).children).toHaveLength(101);
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('gives the parent an element was put in, and removes it from there, with no native reads', () => {
    // Angular asks for the parent of every view it inserts, and a list's
    // rebound row removes a view: each read a parent from native (#878).
    const bottom = chain(20);
    const row = made('view');
    bottom.appendChild(row);
    const run = made('raw-text');
    const text = made('text');
    text.appendChild(run);
    row.appendChild(text);
    resetCounts();

    expect(row.parentNode()).toBe(bottom);
    expect(run.parentNode()).toBe(text);
    row.remove();
    LynxElement.commitPendingRemovals();

    expect(reads()).toBe(0);
    expect((row.element as unknown as FakeEl).parent).toBeNull();
    expect(row.parentNode()).toBeNull();
  });

  it("asks native for the parent of an element it didn't put anywhere, and removes it from there", () => {
    // A hydrated element, or a query's hit: native put it in its parent.
    const page = wrap(pageRoot, 'page');
    const nativeChild = makeEl('view');
    (globalThis as unknown as FakeNativeGlobal<FakeEl>).__AppendElement(
      pageRoot,
      nativeChild,
    );
    const child = wrap(nativeChild, 'view');
    resetCounts();

    expect(child.parentNode()).toBe(page);
    child.remove();
    LynxElement.commitPendingRemovals();

    expect(counts.parent).toBe(2);
    expect(nativeChild.parent).toBeNull();
  });

  it('refuses a new element into itself', () => {
    const leaf = made('view');
    const text = made('text');
    const run = made('raw-text');
    text.appendChild(run);

    leaf.appendChild(leaf);
    text.insertBefore(text, run);

    expect((leaf.element as unknown as FakeEl).children).toEqual([]);
    expect((text.element as unknown as FakeEl).children).toEqual([run.element]);
  });

  it('refuses a new element into its raw-text', () => {
    const text = made('text');
    const run = made('raw-text');
    text.appendChild(run);

    run.appendChild(text);

    expect((run.element as unknown as FakeEl).children).toEqual([]);
    expect((text.element as unknown as FakeEl).parent).toBeNull();
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('refuses a new element into an element of its subtree, searching native', () => {
    // A row with an element in it isn't one the wrappers answer for: its
    // children's own children may be native only. Only the row's parent
    // isn't read, as it has none.
    const row = made('view');
    const inner = made('view');
    row.appendChild(inner);
    const run = made('raw-text');
    inner.appendChild(run);
    resetCounts();

    inner.appendChild(row);

    expect(counts.parent).toBe(0);
    expect(counts.first).toBeGreaterThan(0);
    expect((inner.element as unknown as FakeEl).children).toEqual([
      run.element,
    ]);
    expect((row.element as unknown as FakeEl).parent).toBeNull();
  });

  it('refuses a new element into a native child its wrapper does not list', () => {
    // A static block's elements and a list's items are put in natively.
    for (const [tag, block] of [
      ['view', true],
      ['list', false],
    ] as const) {
      const root = made(tag);
      if (block) root.setStaticBlock([], '', false);
      const nativeChild = makeEl('view');
      (globalThis as unknown as FakeNativeGlobal<FakeEl>).__AppendElement(
        root.element as unknown as FakeEl,
        nativeChild,
      );
      const child = wrap(nativeChild, 'view');

      child.appendChild(root);

      expect(nativeChild.children).toEqual([]);
      expect((root.element as unknown as FakeEl).parent).toBeNull();
    }
  });

  it('reads where an element a list took is before moving it', () => {
    // The list puts the element in the native list itself, so a later move
    // may be one native would lose (see #removeIfMoveWouldBeLost).
    const page = wrap(pageRoot, 'page');
    const list = made('view');
    page.appendChild(list);
    const item = made('view');
    list.adoptVirtualChild(item);
    (globalThis as unknown as FakeNativeGlobal<FakeEl>).__AppendElement(
      list.element as unknown as FakeEl,
      item.element as unknown as FakeEl,
    );
    const other = made('view');
    page.appendChild(other);
    resetCounts();

    other.appendChild(item);

    expect(counts.parent).toBeGreaterThan(0);
    expect((item.element as unknown as FakeEl).parent).toBe(other.element);
    expect(() => assertAcyclic()).not.toThrow();
  });
});

// An element inserted before anchors that end its parent's children is
// appended natively, and the anchors go back to the end before anything
// reads the order and at the end of the cycle (see LynxElement's
// #appendsBeforeTail). Lynx searches the parent's children from the first
// for an insert's reference element, so `@for` building N rows before its
// anchor searched about N² children (issue #444).
//
// The fake keeps one native tree and fails a test on what Lynx would log as
// an error: removing an element from a parent it isn't in, inserting before
// an element that isn't a child, or inserting an element that has a parent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setInsideChangeDetection } from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  name: string;
};

let nextId = 1;
/**
 * Every structural call, as `insert`, `append` or `remove` and a name.
 */
let calls: string[];

const makeEl = (tag: string, name: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  name,
});

const take = (parent: FakeEl, child: FakeEl): void => {
  const i = parent.children.indexOf(child);
  if (i < 0) throw new Error(`${child.name} isn't in ${parent.name}`);
  parent.children.splice(i, 1);
  child.parent = null;
};

const place = (parent: FakeEl, child: FakeEl, index: number): FakeEl => {
  if (child.parent) throw new Error(`${child.name} is in ${child.parent.name}`);
  parent.children.splice(index, 0, child);
  child.parent = parent;
  return child;
};

const installNativeFakes = (): void => {
  nextId = 1;
  calls = [];
  const g = globalThis as Record<string, unknown>;
  g['__GetElementUniqueID'] = (n: FakeEl) => n.id;
  g['__GetTag'] = (n: FakeEl) => n.tag;
  g['__GetParent'] = (n: FakeEl) => n.parent;
  g['__GetChildren'] = (n: FakeEl) => n.children.slice();
  g['__FirstElement'] = (n: FakeEl) => n.children[0] ?? null;
  g['__NextElement'] = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;
  g['__CreateView'] = () => makeEl('view', 'view');
  g['__CreateRawText'] = () => makeEl('raw-text', 'raw-text');
  g['__AppendElement'] = (parent: FakeEl, child: FakeEl) => {
    calls.push(`append ${child.name}`);
    return place(parent, child, parent.children.length);
  };
  g['__InsertElementBefore'] = (parent: FakeEl, child: FakeEl, ref: FakeEl) => {
    calls.push(`insert ${child.name}`);
    const i = parent.children.indexOf(ref);
    if (i < 0) throw new Error(`${ref.name} isn't in ${parent.name}`);
    return place(parent, child, i);
  };
  g['__RemoveElement'] = (parent: FakeEl, child: FakeEl) => {
    calls.push(`remove ${child.name}`);
    take(parent, child);
    return child;
  };
  g['__SetClasses'] = () => {};
  g['__AddInlineStyle'] = () => {};
  g['__SetInlineStyles'] = () => {};
  g['__AddEvent'] = () => {};
};

const element = (tag: string, name: string): LynxElement => {
  const el = new LynxElement(makeEl(tag, name) as unknown as ElementRef);
  el.tagName = tag;
  el.markNew();
  return el;
};

/**
 * An `@if`/`@for` anchor: a hidden view, as LynxDocument makes one.
 */
const anchor = (name: string): LynxElement => {
  const el = new LynxElement(makeEl('view', name) as unknown as ElementRef);
  el.tagName = 'comment';
  el.markUnplaced();
  return el;
};

const fake = (el: LynxElement): FakeEl => el.element as unknown as FakeEl;

/**
 * The names of `el`'s native children, in native order.
 */
const native = (el: LynxElement): string[] =>
  fake(el).children.map((child) => child.name);

/**
 * The end of a change detection cycle, as end() runs it before its flush.
 */
const endCycle = (): void => {
  setInsideChangeDetection(false);
  LynxElement.commitPendingClasses();
  LynxElement.commitPendingRemovals();
};

describe('inserts before the anchors that end a parent (issue #444)', () => {
  let parent: LynxElement;
  let forAnchor: LynxElement;
  let caseAnchor: LynxElement;

  beforeEach(() => {
    installNativeFakes();
    // A container holding a `@switch` case's `@for`: the `@for`'s anchor,
    // then the `@switch`'s, as Angular puts them in.
    parent = element('view', 'container');
    caseAnchor = anchor('case-anchor');
    forAnchor = anchor('for-anchor');
    parent.appendChild(caseAnchor);
    parent.insertBefore(forAnchor, caseAnchor);
    calls = [];
    setInsideChangeDetection(true);
  });

  afterEach(() => {
    setInsideChangeDetection(false);
  });

  const rows = (count: number, from = 1): LynxElement[] =>
    Array.from({ length: count }, (_, i) => {
      const row = element('view', `row${from + i}`);
      parent.insertBefore(row, forAnchor);
      return row;
    });

  it('appends each row, and puts the anchors back at the end once', () => {
    rows(3);

    expect(calls).toEqual(['append row1', 'append row2', 'append row3']);
    endCycle();

    expect(native(parent)).toEqual([
      'row1',
      'row2',
      'row3',
      'for-anchor',
      'case-anchor',
    ]);
    expect(calls.slice(3)).toEqual([
      'remove for-anchor',
      'append for-anchor',
      'remove case-anchor',
      'append case-anchor',
    ]);
  });

  it('appends the rows of a later cycle too, after the ones there', () => {
    rows(2);
    endCycle();
    setInsideChangeDetection(true);
    calls = [];

    rows(2, 3);
    endCycle();

    expect(calls.filter((call) => call.startsWith('insert'))).toEqual([]);
    expect(native(parent)).toEqual([
      'row1',
      'row2',
      'row3',
      'row4',
      'for-anchor',
      'case-anchor',
    ]);
  });

  it('inserts before the anchor outside change detection', () => {
    setInsideChangeDetection(false);

    rows(2);

    expect(calls).toEqual(['insert row1', 'insert row2']);
    expect(native(parent)).toEqual([
      'row1',
      'row2',
      'for-anchor',
      'case-anchor',
    ]);
  });

  it('inserts before an anchor that an element follows', () => {
    const footer = element('view', 'footer');
    parent.appendChild(footer);
    calls = [];

    rows(1);

    expect(calls).toEqual(['insert row1']);
    expect(native(parent)).toEqual([
      'row1',
      'for-anchor',
      'case-anchor',
      'footer',
    ]);
  });

  describe('with elements after the anchors (issue #908)', () => {
    it('appends the rows after the first, and puts the anchors and a new footer back at the end once', () => {
      const footer = element('view', 'footer');
      parent.appendChild(footer);
      calls = [];

      rows(3);

      // The first goes in before the anchor, as an `@if`'s one element does.
      expect(calls).toEqual(['insert row1', 'append row2', 'append row3']);
      endCycle();

      expect(native(parent)).toEqual([
        'row1',
        'row2',
        'row3',
        'for-anchor',
        'case-anchor',
        'footer',
      ]);
      expect(calls.slice(3)).toEqual([
        'remove for-anchor',
        'append for-anchor',
        'remove case-anchor',
        'append case-anchor',
        'remove footer',
        'append footer',
      ]);
    });

    it('inserts every row before an anchor that a flushed footer follows', () => {
      const footer = element('view', 'footer');
      parent.appendChild(footer);
      // The cycle that made it ends, and its flush draws the footer.
      endCycle();
      setInsideChangeDetection(true);
      calls = [];

      rows(3);
      endCycle();

      expect(calls).toEqual(['insert row1', 'insert row2', 'insert row3']);
      expect(native(parent)).toEqual([
        'row1',
        'row2',
        'row3',
        'for-anchor',
        'case-anchor',
        'footer',
      ]);
    });

    it('inserts every row before an anchor that more than four elements follow', () => {
      for (let i = 1; i <= 5; i++) {
        parent.appendChild(element('view', `after${i}`));
      }
      calls = [];

      rows(3);

      expect(calls).toEqual(['insert row1', 'insert row2', 'insert row3']);
    });

    it('appends the rows before an anchor that four elements follow', () => {
      for (let i = 1; i <= 4; i++) {
        parent.appendChild(element('view', `after${i}`));
      }
      calls = [];

      rows(3);
      endCycle();

      expect(calls.slice(0, 3)).toEqual([
        'insert row1',
        'append row2',
        'append row3',
      ]);
      expect(native(parent)).toEqual([
        'row1',
        'row2',
        'row3',
        'for-anchor',
        'case-anchor',
        'after1',
        'after2',
        'after3',
        'after4',
      ]);
    });

    it('inserts every row before an anchor that an element made elsewhere follows', () => {
      // A wrapper of a native element LynxDocument didn't make, such as a
      // query's hit: nothing says it hasn't been flushed.
      const found = new LynxElement(
        makeEl('view', 'found') as unknown as ElementRef,
      );
      found.tagName = 'view';
      parent.appendChild(found);
      calls = [];

      rows(2);

      expect(calls).toEqual(['insert row1', 'insert row2']);
    });

    it("answers nextSibling() in Angular's order", () => {
      const footer = element('view', 'footer');
      parent.appendChild(footer);
      const [, , row3] = rows(3);

      expect(row3!.nextSibling()).toBe(forAnchor);
      expect(caseAnchor.nextSibling()).toBe(footer);
      expect(footer.nextSibling()).toBeNull();
    });

    it('moves a footer of the tail before the anchor, where it stays', () => {
      const footer = element('view', 'footer');
      parent.appendChild(footer);
      rows(1);

      // The footer is the tail's own, so appending it would leave it in the
      // tail, which goes back after the anchors.
      parent.insertBefore(footer, forAnchor);
      rows(1, 2);
      endCycle();

      expect(native(parent)).toEqual([
        'row1',
        'footer',
        'row2',
        'for-anchor',
        'case-anchor',
      ]);
    });

    it('moves an anchor of the tail before the first, where it stays', () => {
      rows(1);

      parent.insertBefore(caseAnchor, forAnchor);
      endCycle();

      expect(native(parent)).toEqual(['row1', 'case-anchor', 'for-anchor']);
    });

    it('puts the footer back before a child of it moves into a row', () => {
      const footer = element('view', 'footer');
      const button = element('view', 'button');
      footer.appendChild(button);
      parent.appendChild(footer);
      const [, row2] = rows(2);
      calls = [];

      // The row comes before the footer in the tree the flush walks, so
      // native would lose the move (see LynxElement's
      // #removeIfMoveWouldBeLost): the button is removed and rebuilt, as it
      // is with the footer in its place. Read with the footer still before
      // the rows, the move would have been kept.
      row2!.appendChild(button);
      endCycle();

      expect(calls).toEqual([
        'remove for-anchor',
        'append for-anchor',
        'remove case-anchor',
        'append case-anchor',
        'remove footer',
        'append footer',
        'remove button',
        'append view',
      ]);
      expect(native(parent)).toEqual([
        'row1',
        'row2',
        'for-anchor',
        'case-anchor',
        'footer',
      ]);
    });
  });

  it('inserts before an element, which is no anchor', () => {
    const [row1] = rows(1);
    const row0 = element('view', 'row0');
    calls = [];

    parent.insertBefore(row0, row1!);

    // The anchors go back first, as for any insert but one before them.
    expect(calls).toEqual([
      'remove for-anchor',
      'append for-anchor',
      'remove case-anchor',
      'append case-anchor',
      'insert row0',
    ]);
    expect(native(parent)).toEqual([
      'row0',
      'row1',
      'for-anchor',
      'case-anchor',
    ]);
  });

  it('puts the anchors back before an insert between them', () => {
    rows(1);
    // Another case's first element, before the `@switch`'s anchor.
    const other = element('view', 'other');

    parent.insertBefore(other, caseAnchor);
    endCycle();

    expect(native(parent)).toEqual([
      'row1',
      'for-anchor',
      'other',
      'case-anchor',
    ]);
  });

  it('puts the anchors back before an element is appended after them', () => {
    rows(1);
    const footer = element('view', 'footer');

    parent.appendChild(footer);
    endCycle();

    expect(native(parent)).toEqual([
      'row1',
      'for-anchor',
      'case-anchor',
      'footer',
    ]);
  });

  it('puts the anchors back before one of them is removed', () => {
    rows(2);

    forAnchor.remove();
    endCycle();

    expect(native(parent)).toEqual(['row1', 'row2', 'case-anchor']);
  });

  it('keeps a row removed in the same cycle out', () => {
    const [row1] = rows(2);

    row1!.remove();
    endCycle();

    expect(native(parent)).toEqual(['row2', 'for-anchor', 'case-anchor']);
  });

  it('puts the anchors back before one of them moves to another parent', () => {
    rows(1);
    const other = element('view', 'other-parent');

    other.appendChild(forAnchor);
    endCycle();

    expect(native(parent)).toEqual(['row1', 'case-anchor']);
    expect(native(other)).toEqual(['for-anchor']);
  });

  it('moves a row to the end before the anchors', () => {
    const [row1] = rows(3);
    endCycle();
    setInsideChangeDetection(true);

    // An `@for` reorder that makes the first row the last.
    parent.insertBefore(row1!, forAnchor);
    endCycle();

    expect(native(parent)).toEqual([
      'row2',
      'row3',
      'row1',
      'for-anchor',
      'case-anchor',
    ]);
  });

  it("answers nextSibling() in Angular's order", () => {
    const [, row2] = rows(2);

    expect(row2!.nextSibling()).toBe(forAnchor);
    expect(forAnchor.nextSibling()).toBe(caseAnchor);
  });

  it("inserts before an anchor a hydrated parent's snapshot holds", () => {
    // The snapshot's elements are in the native tree, and in no wrapper's
    // children (hydration inserts nothing).
    const hydrated = new LynxElement(
      makeEl('view', 'hydrated') as unknown as ElementRef,
    );
    hydrated.tagName = 'view';
    const snapshotAnchor = new LynxElement(
      makeEl('view', 'snapshot-anchor') as unknown as ElementRef,
    );
    snapshotAnchor.tagName = 'comment';
    place(fake(hydrated), fake(snapshotAnchor), 0);

    hydrated.insertBefore(element('view', 'row'), snapshotAnchor);
    // And once the parent has children of its own.
    hydrated.insertBefore(anchor('new-anchor'), snapshotAnchor);
    hydrated.insertBefore(element('view', 'row2'), snapshotAnchor);

    expect(calls).toEqual(['insert row', 'insert new-anchor', 'insert row2']);
    expect(native(hydrated)).toEqual([
      'row',
      'new-anchor',
      'row2',
      'snapshot-anchor',
    ]);
  });

  /**
   * A parent the snapshot hydrated, holding `names` natively, none of them
   * in its #children (hydration inserts nothing).
   */
  const hydratedParent = (...names: string[]): LynxElement[] => {
    const hydrated = new LynxElement(
      makeEl('view', 'hydrated') as unknown as ElementRef,
    );
    hydrated.tagName = 'view';
    const children = names.map((name) => {
      const child = new LynxElement(
        makeEl('view', name) as unknown as ElementRef,
      );
      child.tagName = name.endsWith('anchor') ? 'comment' : 'view';
      place(fake(hydrated), fake(child), fake(hydrated).children.length);
      return child;
    });
    return [hydrated, ...children];
  };

  it("inserts before an anchor that a hydrated parent's snapshot children follow", () => {
    const [hydrated, snapshotAnchor] = hydratedParent('snapshot-anchor');
    const newAnchor = anchor('new-anchor');
    hydrated!.insertBefore(newAnchor, snapshotAnchor!);
    calls = [];

    // newAnchor ends the parent's #children, but not its native children.
    hydrated!.insertBefore(element('view', 'row'), newAnchor);
    endCycle();

    expect(calls).toEqual(['insert row']);
    expect(native(hydrated!)).toEqual(['row', 'new-anchor', 'snapshot-anchor']);
  });

  it("inserts before anchors that a hydrated parent's snapshot child is among", () => {
    const [hydrated, snapshotRow] = hydratedParent('snapshot-row');
    const firstAnchor = anchor('first-anchor');
    hydrated!.insertBefore(firstAnchor, snapshotRow!);
    hydrated!.appendChild(anchor('last-anchor'));
    calls = [];

    // The anchors end #children, and the last of them ends the native
    // children, but the snapshot's child is between them natively.
    hydrated!.insertBefore(element('view', 'row'), firstAnchor);
    endCycle();

    expect(calls).toEqual(['insert row']);
    expect(native(hydrated!)).toEqual([
      'row',
      'first-anchor',
      'snapshot-row',
      'last-anchor',
    ]);
  });

  it("answers nextSibling() of a hydrated parent's snapshot child in Angular's order", () => {
    const [hydrated, snapshotRow] = hydratedParent('snapshot-row');
    const newAnchor = anchor('new-anchor');
    hydrated!.appendChild(newAnchor);
    const row = element('view', 'row');

    hydrated!.insertBefore(row, newAnchor);

    // The snapshot's child has no parent the runtime put it in, so it's
    // native that knows what follows it.
    expect(snapshotRow!.nextSibling()).toBe(row);
  });

  it('inserts before the anchors in a <text>, which keeps its order', () => {
    const text = element('text', 'text');
    const textAnchor = anchor('text-anchor');
    text.appendChild(textAnchor);
    calls = [];

    text.insertBefore(element('raw-text', 'run'), textAnchor);

    expect(calls).toEqual(['insert run']);
  });
});

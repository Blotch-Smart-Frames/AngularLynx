// Moves to another parent against a fake of native Lynx 4.1's flush, which
// loses a move when it reaches the new parent before the old one (see
// LynxElement.#removeIfMoveWouldBeLost). The fake keeps two trees, as Lynx
// does: the element tree the element functions change at once, and the
// rendered (layout and painting) tree, which each parent's queued insertions
// and removals change only at a flush, parent by parent in pre-order. So a
// test can see what would be on screen after the flush.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

type FakeAction = {
  readonly type: 'insert' | 'remove';
  readonly child: FakeEl;
};

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  /** The parent in the rendered tree, as of the last flush. */
  renderParent: FakeEl | null;
  renderChildren: FakeEl[];
  /** Insertions and removals waiting for the next flush. */
  actions: FakeAction[];
  classes: string;
};

let nextId = 1;
let page: FakeEl;

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  renderParent: null,
  renderChildren: [],
  actions: [],
  classes: '',
});

/**
 * Takes `child` out of its element-tree parent, queuing the removal there.
 */
const detach = (child: FakeEl): void => {
  const parent = child.parent;
  if (!parent) return;
  parent.children.splice(parent.children.indexOf(child), 1);
  parent.actions.push({ type: 'remove', child });
  child.parent = null;
};

const attach = (parent: FakeEl, child: FakeEl, index: number): FakeEl => {
  detach(child);
  parent.children.splice(index, 0, child);
  child.parent = parent;
  parent.actions.push({ type: 'insert', child });
  return child;
};

/**
 * Lynx 4.1's flush: each element's queued actions, in pre-order. An insertion
 * of a child the rendered tree still has elsewhere links it in without taking
 * it out of the old parent, and a removal from a parent the child no longer
 * renders under does nothing (`HandleInsertChildAction` and
 * `HandleRemoveChildAction` in `fiber_element.cc`).
 */
const flush = (el: FakeEl = page): void => {
  for (const { type, child } of el.actions) {
    if (type === 'insert') {
      el.renderChildren.push(child);
      child.renderParent = el;
    } else if (child.renderParent === el) {
      el.renderChildren.splice(el.renderChildren.indexOf(child), 1);
      child.renderParent = null;
    }
  }
  el.actions = [];
  for (const child of el.children) flush(child);
};

/**
 * The rendered parent of each element reachable on screen, by class.
 */
const rendered = (): Map<string, FakeEl[]> => {
  const out = new Map<string, FakeEl[]>();
  const walk = (el: FakeEl): void => {
    for (const child of el.renderChildren) {
      out.set(child.classes, [...(out.get(child.classes) ?? []), el]);
      walk(child);
    }
  };
  walk(page);
  return out;
};

const installNativeFakes = (): void => {
  nextId = 1;
  page = makeEl('page');
  const g = globalThis as Record<string, unknown>;
  g['__GetElementUniqueID'] = (n: FakeEl) => n.id;
  g['__GetTag'] = (n: FakeEl) => n.tag;
  g['__GetParent'] = (n: FakeEl) => n.parent;
  g['__GetChildren'] = (n: FakeEl) => n.children.slice();
  g['__CreateView'] = () => makeEl('view');
  g['__AppendElement'] = (parent: FakeEl, child: FakeEl) =>
    attach(parent, child, parent.children.length);
  g['__InsertElementBefore'] = (parent: FakeEl, child: FakeEl, ref: FakeEl) => {
    detach(child);
    return attach(parent, child, parent.children.indexOf(ref));
  };
  g['__RemoveElement'] = (_parent: FakeEl, child: FakeEl) => {
    detach(child);
    return child;
  };
  g['__SetClasses'] = (n: FakeEl, classes: string) => {
    n.classes = classes;
  };
  g['__AddEvent'] = () => {};
};

/**
 * A view with `cls` as its class, in the element tree under `parent`.
 */
const view = (cls: string, parent?: LynxElement): LynxElement => {
  const el = new LynxElement(makeEl('view') as unknown as ElementRef);
  el.tagName = 'view';
  el.setAttribute('class', cls);
  parent?.appendChild(el);
  return el;
};

const fake = (el: LynxElement): FakeEl => el.element as unknown as FakeEl;

describe('LynxElement moves to another parent', () => {
  let root: LynxElement;

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    vi.stubGlobal('__WEB__', false);
    installNativeFakes();
    root = new LynxElement(page as unknown as ElementRef);
    root.tagName = 'page';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The page of a context menu: an element in the page, and the overlay
   * after it that it lifts into.
   */
  const lifted = () => {
    const home = view('home', root);
    const overlay = view('overlay', root);
    const slot = view('slot', overlay);
    const card = view('card', home);
    view('title', card);
    flush();
    return { home, slot, card };
  };

  it('keeps an element it moves to a parent the flush reaches later', () => {
    const { slot, card } = lifted();
    const before = fake(card);

    slot.appendChild(card);
    flush();

    // A native move: the same element, under the slot only.
    expect(card.element).toBe(before);
    expect(rendered().get('card')).toEqual([fake(slot)]);
  });

  it('rebuilds an element it moves back to a parent the flush reaches first', () => {
    const { home, slot, card } = lifted();
    slot.appendChild(card);
    flush();
    const inSlot = fake(card);

    home.appendChild(card);
    flush();

    // Native Lynx would leave it under neither: the home lays out empty.
    // Rebuilt instead, it's under the home only, with its content.
    expect(card.element).not.toBe(inSlot);
    expect(rendered().get('card')).toEqual([fake(home)]);
    expect(rendered().get('title')).toEqual([fake(card)]);
    expect(inSlot.parent).toBeNull();
  });

  it('rebuilds an element inserted before a sibling in an earlier parent', () => {
    const { home, slot, card } = lifted();
    const other = view('other', home);
    slot.appendChild(card);
    flush();

    home.insertBefore(card, other);
    flush();

    expect(rendered().get('card')).toEqual([fake(home)]);
    expect(fake(home).children.map((child) => child.classes)).toEqual([
      'card',
      'other',
    ]);
  });

  it('rebuilds an element it moves up to an ancestor of its parent', () => {
    const outer = view('outer', root);
    const inner = view('inner', outer);
    const card = view('card', inner);
    flush();

    outer.appendChild(card);
    flush();

    expect(rendered().get('card')).toEqual([fake(outer)]);
  });

  it('keeps an element it moves down into its parent subtree', () => {
    const outer = view('outer', root);
    const inner = view('inner', outer);
    const card = view('card', outer);
    flush();
    const before = fake(card);

    inner.appendChild(card);
    flush();

    expect(card.element).toBe(before);
    expect(rendered().get('card')).toEqual([fake(inner)]);
  });

  it('keeps an element it moves within its parent', () => {
    const list = view('list', root);
    const first = view('first', list);
    const second = view('second', list);
    flush();
    const before = fake(second);

    list.insertBefore(second, first);
    flush();

    expect(second.element).toBe(before);
    expect(fake(list).children.map((child) => child.classes)).toEqual([
      'second',
      'first',
    ]);
  });

  it('keeps an element it moves out of a subtree that is not on the page', () => {
    const detached = view('detached');
    const card = view('card', detached);
    const target = view('target', root);
    const before = fake(card);

    target.appendChild(card);
    flush();

    expect(card.element).toBe(before);
    expect(rendered().get('card')).toEqual([fake(target)]);
  });

  it("leaves a list item's moves to the list", () => {
    const { home, slot, card } = lifted();
    slot.appendChild(card);
    flush();
    const inSlot = fake(card);
    card._virtualParent = slot;

    home.appendChild(card);

    expect(card.element).toBe(inSlot);
  });

  it('moves the element as it is on Lynx for Web, which moves DOM nodes', () => {
    const { home, slot, card } = lifted();
    slot.appendChild(card);
    flush();
    const inSlot = fake(card);
    vi.stubGlobal('__WEB__', true);

    home.appendChild(card);

    expect(card.element).toBe(inSlot);
  });
});

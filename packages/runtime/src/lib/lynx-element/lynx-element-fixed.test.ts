// Removals of elements holding a `position: fixed` element, against a fake of
// how native Lynx 4.1 draws one (issue #345). Lynx draws a fixed element from
// the page, not from its parent. When something holding one is removed from
// a parent on the page, Lynx queues the fixed element's removal from the page
// on that parent, and runs it when the parent flushes; a parent that has
// left the page queues nothing (`TreeResolver::NotifyNodeRemoved`, and
// `FiberElement::RemovedFrom` and `PrepareAndGenerateChildrenActions` in
// `fiber_element.cc`). The flush reaches only what is on the page, so a
// removal queued on a parent that leaves the page before the flush is lost,
// and the page goes on drawing the fixed element. Native Lynx then crashes
// in its layout once the element is freed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  /** Styled `position: fixed`. */
  fixed: boolean;
  /** Fixed elements to take off the page when this element flushes. */
  queued: FakeEl[];
  classes: string;
};

let nextId = 1;
let page: FakeEl;
/** The fixed elements the page draws, as of the last flush. */
let drawn: Set<FakeEl>;
/** Every `__RemoveElement` call's child, by class, in order. */
let removals: string[];

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  fixed: false,
  queued: [],
  classes: '',
});

const onPage = (el: FakeEl): boolean => {
  let node: FakeEl | null = el;
  while (node && node !== page) node = node.parent;
  return node === page;
};

const descendants = (el: FakeEl): FakeEl[] =>
  el.children.flatMap((child) => [child, ...descendants(child)]);

/**
 * Takes `child` out of `parent`. A parent on the page queues the removal of
 * every fixed element in it (the child itself included, through the
 * parent's own removal action); one that has left the page queues none.
 */
const detach = (parent: FakeEl, child: FakeEl): void => {
  if (onPage(parent)) {
    parent.queued.push(
      ...[child, ...descendants(child)].filter((el) => el.fixed),
    );
  }
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parent = null;
};

/**
 * Lynx 4.1's flush: what is on the page runs its queued removals, then the
 * page draws every fixed element it holds.
 */
const flush = (): void => {
  const walk = (el: FakeEl): void => {
    for (const fixed of el.queued) drawn.delete(fixed);
    el.queued = [];
    if (el.fixed) drawn.add(el);
    for (const child of el.children) walk(child);
  };
  walk(page);
};

/**
 * Fixed elements the page draws that are no longer on it.
 */
const stranded = (): string[] =>
  [...drawn].filter((el) => !onPage(el)).map((el) => el.classes);

const installNativeFakes = (): void => {
  nextId = 1;
  page = makeEl('page');
  drawn = new Set();
  removals = [];
  const g = globalThis as Record<string, unknown>;
  g['__GetElementUniqueID'] = (n: FakeEl) => n.id;
  g['__GetTag'] = (n: FakeEl) => n.tag;
  g['__GetParent'] = (n: FakeEl) => n.parent;
  g['__GetChildren'] = (n: FakeEl) => n.children.slice();
  g['__AppendElement'] = (parent: FakeEl, child: FakeEl) => {
    if (child.parent) detach(child.parent, child);
    parent.children.push(child);
    child.parent = parent;
    return child;
  };
  g['__RemoveElement'] = (parent: FakeEl, child: FakeEl) => {
    removals.push(child.classes);
    detach(parent, child);
    return child;
  };
  g['__SetClasses'] = (n: FakeEl, classes: string) => {
    n.classes = classes;
  };
};

const view = (cls: string, parent?: LynxElement): LynxElement => {
  const el = new LynxElement(makeEl('view') as unknown as ElementRef);
  el.tagName = 'view';
  el.setAttribute('class', cls);
  parent?.appendChild(el);
  return el;
};

/**
 * An `<overlay>` styled `position: fixed`, as ui-menu's is for the web.
 */
const overlay = (parent: LynxElement): LynxElement => {
  const el = view('overlay', parent);
  (el.element as unknown as FakeEl).fixed = true;
  return el;
};

describe('LynxElement removals around a fixed element', () => {
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
   * A card of a row whose menu holds an overlay: the console's Pages tab.
   */
  const pagesTab = () => {
    const card = view('card', root);
    const row = view('row', card);
    const menu = view('menu', row);
    overlay(menu);
    flush();
    expect([...drawn].map((el) => el.classes)).toEqual(['overlay']);
    return { card, row, menu };
  };

  it("takes a fixed element off the page when its holder's parent goes too, inner first", () => {
    const { card, menu } = pagesTab();

    // A row's @if drops its menu, and then, in a second pass of the same
    // change detection, the @if around the list drops the card.
    menu.remove();
    card.remove();
    LynxElement.commitPendingRemovals();
    flush();

    expect(stranded()).toEqual([]);
    expect(drawn.size).toBe(0);
  });

  it('removes an element before the elements inside it', () => {
    const { card, row, menu } = pagesTab();

    menu.remove();
    row.remove();
    card.remove();
    LynxElement.commitPendingRemovals();

    expect(removals).toEqual(['card', 'row', 'menu']);
  });

  it("keeps Angular's order between elements at one depth", () => {
    const { card, row } = pagesTab();
    const aside = view('aside', root);
    const footer = view('footer', root);
    flush();

    row.remove();
    footer.remove();
    card.remove();
    aside.remove();
    LynxElement.commitPendingRemovals();

    expect(removals).toEqual(['footer', 'card', 'aside', 'row']);
  });

  it('takes a fixed element off the page when only its holder goes', () => {
    const { menu } = pagesTab();

    menu.remove();
    LynxElement.commitPendingRemovals();
    flush();

    expect(drawn.size).toBe(0);
  });
});

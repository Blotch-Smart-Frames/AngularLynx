// A <blur-view> inserted before a sibling of a plain element draws nothing
// on iOS, so LynxElement appends it and moves the siblings after it instead
// (see insertHidesBlurView). Run against a fake element tree that records
// which element function built each child order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
};

let nextId = 1;

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
});

const detach = (child: FakeEl): void => {
  const parent = child.parent;
  if (!parent) return;
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parent = null;
};

const attach = (parent: FakeEl, child: FakeEl, index: number): void => {
  detach(child);
  parent.children.splice(index, 0, child);
  child.parent = parent;
};

/** The element functions the insert calls, as they're called. */
const append = vi.fn((parent: FakeEl, child: FakeEl) =>
  attach(parent, child, parent.children.length),
);
const insertBefore = vi.fn((parent: FakeEl, child: FakeEl, ref: FakeEl) => {
  detach(child);
  attach(parent, child, parent.children.indexOf(ref));
});

const installNativeFakes = (): void => {
  nextId = 1;
  append.mockClear();
  insertBefore.mockClear();
  const g = globalThis as Record<string, unknown>;
  g['__GetElementUniqueID'] = (n: FakeEl) => n.id;
  g['__GetParent'] = (n: FakeEl) => n.parent;
  g['__GetChildren'] = (n: FakeEl) => n.children.slice();
  g['__NextElement'] = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;
  g['__AppendElement'] = append;
  g['__InsertElementBefore'] = insertBefore;
  g['__SetClasses'] = () => {};
  g['__AddEvent'] = () => {};
};

const element = (tag: string, parent?: LynxElement): LynxElement => {
  const el = new LynxElement(makeEl(tag) as unknown as ElementRef);
  el.tagName = tag;
  parent?.appendChild(el);
  return el;
};

/**
 * The tags of `el`'s children in the element tree, in order.
 */
const order = (el: LynxElement): string[] =>
  (el.element as unknown as FakeEl).children.map(
    (child) => `${child.tag}${child.id}`,
  );

describe('LynxElement inserting a blur-view before a sibling', () => {
  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    vi.stubGlobal('__WEB__', false);
    vi.stubGlobal('SystemInfo', { platform: 'iOS' });
    installNativeFakes();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A row of a text and the anchor of an `@if` block after it, as Angular
   * leaves them before it inserts the block's content before the anchor.
   */
  const row = () => {
    const parent = element('view');
    const text = element('text', parent);
    const anchor = element('view', parent);
    const after = element('text', parent);
    insertBefore.mockClear();
    append.mockClear();
    return { parent, text, anchor, after };
  };

  it('appends it on iOS, and moves the siblings it goes before to the end after it', () => {
    const { parent, anchor } = row();
    const glass = element('blur-view');

    parent.insertBefore(glass, anchor);

    expect(order(parent)).toEqual(['text2', 'blur-view5', 'view3', 'text4']);
    expect(insertBefore).not.toHaveBeenCalled();
    expect(append.mock.calls.map(([, child]) => child.id)).toEqual([5, 3, 4]);
    // Angular finds the sibling it inserted before right after it.
    expect(glass.nextSibling()).toBe(anchor);
  });

  it('moves a blur-view already among the children without counting it twice', () => {
    const { parent, text } = row();
    const glass = element('blur-view', parent);
    append.mockClear();

    parent.insertBefore(glass, text);

    expect(order(parent)).toEqual(['blur-view5', 'text2', 'view3', 'text4']);
    expect(append.mock.calls.map(([, child]) => child.id)).toEqual([
      5, 2, 3, 4,
    ]);
  });

  it('inserts it in place inside another blur-view, which draws it either way', () => {
    const group = element('blur-view');
    const anchor = element('view', group);
    const glass = element('blur-view');

    group.insertBefore(glass, anchor);

    expect(insertBefore).toHaveBeenCalledWith(
      group.element,
      glass.element,
      anchor.element,
    );
    expect(order(group)).toEqual(['blur-view3', 'view2']);
  });

  it('inserts any other element in place', () => {
    const { parent, anchor } = row();
    const card = element('view');

    parent.insertBefore(card, anchor);

    expect(insertBefore).toHaveBeenCalledOnce();
    expect(order(parent)).toEqual(['text2', 'view5', 'view3', 'text4']);
  });

  it('inserts it in place on Android, which draws it', () => {
    vi.stubGlobal('SystemInfo', { platform: 'Android' });
    const { parent, anchor } = row();
    const glass = element('blur-view');

    parent.insertBefore(glass, anchor);

    expect(insertBefore).toHaveBeenCalledOnce();
    expect(order(parent)).toEqual(['text2', 'blur-view5', 'view3', 'text4']);
  });

  it('inserts it in place on the web', () => {
    vi.stubGlobal('__WEB__', true);
    const { parent, anchor } = row();
    const glass = element('blur-view');

    parent.insertBefore(glass, anchor);

    expect(insertBefore).toHaveBeenCalledOnce();
  });

  it('reads the platform from lynx.SystemInfo on the native main thread', () => {
    vi.stubGlobal('SystemInfo', undefined);
    vi.stubGlobal('lynx', { SystemInfo: { platform: 'iOS' } });
    const { parent, anchor } = row();
    const glass = element('blur-view');

    parent.insertBefore(glass, anchor);

    expect(insertBefore).not.toHaveBeenCalled();
  });

  it('inserts it in place where no SystemInfo says the platform', () => {
    vi.stubGlobal('SystemInfo', undefined);
    const { parent, anchor } = row();
    const glass = element('blur-view');

    parent.insertBefore(glass, anchor);

    expect(insertBefore).toHaveBeenCalledOnce();
  });
});

// An element's classes: what reaches native, and the class string it keeps
// to write again when it's rebuilt (see #recreateSubtree). The element keeps
// a set of its class names beside that string (#classNames), so that adding
// a class doesn't split and join the whole string; neither what native gets
// nor the string may change for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';

type FakeEl = {
  id: number;
  parent: FakeEl | null;
  children: FakeEl[];
  classes: string[];
};

let nextId = 1;
/** The class calls native got, in order: [call, element id, argument]. */
let log: unknown[][] = [];

const makeEl = (): FakeEl => ({
  id: nextId++,
  parent: null,
  children: [],
  classes: [],
});

const installNativeFakes = (): void => {
  nextId = 1;
  log = [];
  const detach = (child: FakeEl): void => {
    const parent = child.parent;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(child), 1);
    child.parent = null;
  };
  const g = globalThis as Record<string, unknown>;
  g['__GetElementUniqueID'] = (n: FakeEl) => n.id;
  g['__GetParent'] = (n: FakeEl) => n.parent;
  g['__FirstElement'] = (n: FakeEl) => n.children[0] ?? null;
  g['__CreateView'] = () => makeEl();
  g['__AppendElement'] = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    parent.children.push(child);
    child.parent = parent;
  };
  g['__RemoveElement'] = (_parent: FakeEl, child: FakeEl) => detach(child);
  // Native keeps each name once, as an element's class list does.
  g['__AddClass'] = (n: FakeEl, name: string) => {
    log.push(['add', n.id, name]);
    if (!n.classes.includes(name)) n.classes.push(name);
  };
  g['__SetClasses'] = (n: FakeEl, classes: string) => {
    log.push(['set', n.id, classes]);
    n.classes = classes.split(/\s+/).filter(Boolean);
  };
  g['__GetClasses'] = (n: FakeEl) => {
    log.push(['get', n.id]);
    return n.classes.slice();
  };
};

const view = (): LynxElement => {
  const el = new LynxElement(makeEl() as unknown as ElementRef);
  el.tagName = 'view';
  return el;
};

/**
 * The class string `el` is rebuilt with: it's removed for good, then put
 * back, which makes it a new native element (see #recreateIfDead).
 */
const rebuiltClasses = (el: LynxElement, parent: LynxElement): unknown => {
  parent.appendChild(el);
  el.remove();
  LynxElement.commitPendingRemovals();
  log = [];
  parent.appendChild(el);
  expect(log).toHaveLength(1);
  return log[0]![2];
};

describe('LynxElement classes', () => {
  let parent: LynxElement;

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    installNativeFakes();
    parent = view();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the same calls to native, and keeps the same class string', () => {
    const el = view();
    const id = (el.element as unknown as FakeEl).id;

    el.addScopeClass('_ngcontent-x');
    el.setAttribute('class', 'a  b a');
    el.addClass('c');
    el.addClass('c');
    el.addClass('a');
    el.removeClass('b');
    el.addClass('d');
    el.addClass('x y');
    el.addClass('e');

    expect(log).toEqual([
      ['add', id, '_ngcontent-x'],
      ['set', id, 'a b _ngcontent-x'],
      ['add', id, 'c'],
      ['add', id, 'c'],
      ['add', id, 'a'],
      ['get', id],
      ['set', id, 'a _ngcontent-x c'],
      ['add', id, 'd'],
      ['add', id, 'x y'],
      ['add', id, 'e'],
    ]);
    // A name with a space in it is split, as it always was.
    expect(rebuiltClasses(el, parent)).toBe('a _ngcontent-x c d x y e');
  });

  it('keeps a class native holds twice as native has it, until the next one', () => {
    // Native's list is the truth for a removal (see removeClass).
    (globalThis as Record<string, unknown>)['__AddClass'] = (
      n: FakeEl,
      name: string,
    ) => n.classes.push(name);
    const twice = view();
    twice.addClass('a');
    twice.addClass('a');
    twice.addClass('b');
    twice.removeClass('b');
    expect(rebuiltClasses(twice, parent)).toBe('a a');

    const next = view();
    next.addClass('a');
    next.addClass('a');
    next.removeClass('b');
    next.addClass('c');
    expect(rebuiltClasses(next, parent)).toBe('a c');
  });

  it('adds a class after Angular cleared them', () => {
    const el = view();
    el.setAttribute('class', null);
    el.addClass('a');

    expect(rebuiltClasses(el, parent)).toBe('a');
  });

  it('keeps an odd runtime class with the classes Angular writes', () => {
    const el = view();
    el.setRuntimeClass('odd name', true);
    el.setAttribute('class', 'a');
    el.addClass('b');

    expect(rebuiltClasses(el, parent)).toBe('a odd name b');
  });

  it('adds classes without splitting the class string again', () => {
    // Angular adds a [class] binding's classes one at a time.
    const el = view();
    el.setAttribute('class', 'static');
    const split = vi.spyOn(String.prototype, 'split');

    for (let i = 0; i < 12; i++) el.addClass(`bound-${i}`);
    const splits = split.mock.calls.length;
    split.mockRestore();

    expect(splits).toBe(0);
    expect(rebuiltClasses(el, parent)).toBe(
      ['static', ...Array.from({ length: 12 }, (_, i) => `bound-${i}`)].join(
        ' ',
      ),
    );
  });
});

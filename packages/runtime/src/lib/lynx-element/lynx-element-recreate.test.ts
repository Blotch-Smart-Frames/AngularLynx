// What an element keeps to rebuild itself (see #recreateSubtree), and what
// that costs one that keeps nothing. Every view, text, raw-text and anchor is
// a LynxElement, and most never get attributes, styles or listeners, so the
// collections that hold them are made on their first write.
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
/** The writes native got, in order: [call, element id, ...arguments]. */
let log: unknown[][] = [];

const makeEl = (): FakeEl => ({
  id: nextId++,
  parent: null,
  children: [],
  classes: [],
});

/** The native handler registered for each `<id>|<event>`. */
const handlers = new Map<string, (event: object) => unknown>();

const installNativeFakes = (): void => {
  nextId = 1;
  log = [];
  handlers.clear();
  const detach = (child: FakeEl): void => {
    const parent = child.parent;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(child), 1);
    child.parent = null;
  };
  const write =
    (call: string) =>
    (n: FakeEl, ...args: unknown[]): void => {
      log.push([call, n.id, ...args]);
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
  g['__AddClass'] = (n: FakeEl, name: string) => n.classes.push(name);
  g['__GetClasses'] = (n: FakeEl) => n.classes.slice();
  g['__SetClasses'] = write('__SetClasses');
  g['__SetID'] = write('__SetID');
  g['__SetDataset'] = write('__SetDataset');
  g['__SetAttribute'] = write('__SetAttribute');
  g['__SetInlineStyles'] = write('__SetInlineStyles');
  g['__AddInlineStyle'] = write('__AddInlineStyle');
  g['__AddEvent'] = (
    n: FakeEl,
    type: string,
    name: string,
    handler: { value: (event: object) => unknown },
  ) => {
    log.push(['__AddEvent', n.id, type, name]);
    handlers.set(`${n.id}|${name}`, handler.value);
  };
};

const view = (): LynxElement => {
  const el = new LynxElement(makeEl() as unknown as ElementRef);
  el.tagName = 'view';
  return el;
};

const id = (el: LynxElement): number => (el.element as unknown as FakeEl).id;

/**
 * Removes `el` for good, then puts it back, which rebuilds it (see
 * #recreateIfDead), and returns what native got for the new element.
 */
const rebuild = (el: LynxElement, parent: LynxElement): unknown[][] => {
  parent.appendChild(el);
  el.remove();
  LynxElement.commitPendingRemovals();
  log = [];
  parent.appendChild(el);
  return log.filter((call) => call[1] === id(el));
};

describe('LynxElement rebuilt from what it keeps', () => {
  let parent: LynxElement;

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    installNativeFakes();
    parent = view();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes no Maps or Sets for elements that hold nothing yet', () => {
    const RealMap = Map;
    const RealSet = Set;
    let made = 0;
    globalThis.Map = class extends RealMap<unknown, unknown> {
      constructor(entries?: Iterable<readonly [unknown, unknown]> | null) {
        super(entries);
        made++;
      }
    } as MapConstructor;
    globalThis.Set = class extends RealSet<unknown> {
      constructor(values?: Iterable<unknown> | null) {
        super(values);
        made++;
      }
    } as SetConstructor;
    try {
      for (let i = 0; i < 10_000; i++) view();
    } finally {
      globalThis.Map = RealMap;
      globalThis.Set = RealSet;
    }

    // Each made five Maps and a Set: attributes, [style.x] styles, CSS
    // variables, held events, native handlers and attribute removals.
    expect(made).toBe(0);
  });

  it('gives a rebuilt element everything it was given', () => {
    const el = view();
    el.setAttribute('id', 'hero');
    el.setAttribute('data-role', 'card');
    el.setAttribute('accessibility-label', 'Hero');
    el.setAttribute('class', 'card big');
    el.setAttribute('style', 'color: red');
    el.setStyle('opacity', '0.5');
    el.setStyle('--tint', 'blue');
    const tap = vi.fn();
    el.addEventListener('bindtap', tap);

    const calls = rebuild(el, parent);

    expect(calls).toEqual([
      ['__SetID', id(el), 'hero'],
      ['__SetDataset', id(el), { role: 'card' }],
      ['__SetAttribute', id(el), 'accessibility-label', 'Hero'],
      ['__SetClasses', id(el), 'card big'],
      ['__SetInlineStyles', id(el), 'color: red; --tint: blue'],
      ['__AddInlineStyle', id(el), 'opacity', '0.5'],
      ['__AddEvent', id(el), 'bindEvent', 'tap'],
    ]);
    handlers.get(`${id(el)}|tap`)!({ type: 'tap' });
    expect(tap).toHaveBeenCalledOnce();
  });

  it('rebuilds an element that was given nothing as a bare one', () => {
    const el = view();

    expect(rebuild(el, parent)).toEqual([]);
  });
});

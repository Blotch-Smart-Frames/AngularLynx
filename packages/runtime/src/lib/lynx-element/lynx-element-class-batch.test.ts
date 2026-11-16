// Classes changed during change detection reach native at the end of the
// cycle, one __SetClasses per element, rather than a call for each change
// (see LynxElement's #pendingClasses). Native has to end up with the class
// list it had from a call for each change, in the same order, with the same
// names twice or once, on Lynx's own elements (iOS, Android) and Lynx for
// Web's, whose lists differ for a name added twice.
import { Injector, runInInjectionContext } from '@angular/core';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LynxAccessibility } from '../accessibility/accessibility';
import { installCanvasGlobals } from '../canvas/dom-globals';
import { LynxDocument } from '../lynx-document';
import {
  handOverPageToNextApp,
  setPageElementRef,
} from '../lynx-document/page-ref';
import {
  bindListItem,
  markFirstRenderComplete,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import { MainThreadElement } from '../main-thread/main-thread-element';
import { LynxRendererFactory2 } from '../renderer/lynx-renderer-factory2';
import { LYNX_DOCUMENT } from '../renderer/token';
import { LynxHydrateDocument } from '../ssr/hydrate-document';
import { OpcodeRecorder } from '../ssr/opcodes';
import { serializeElementTree } from '../ssr/serialize-tree';
import type { ElementRef } from '../types/lynx';
import { LynxElement, scheduleSettleFlush } from './lynx-element';
import { ANONYMOUS_TEXT_CLASS } from './text-flow';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  classes: string[];
};

/**
 * How native keeps an element's classes. iOS and Android (`lynx`) add a
 * name to the end of the list whether it's there or not, and split a whole
 * class string on spaces alone. Lynx for Web (`web`), and the testing
 * library's jsdom, keep a DOM class list: each name once, split on any
 * whitespace, and a name with whitespace in it can't be added.
 */
type Semantics = 'lynx' | 'web';
let semantics: Semantics = 'lynx';

const namesOf = (classes: string): string[] =>
  semantics === 'lynx'
    ? classes.split(' ').filter(Boolean)
    : [...new Set(classes.split(/[ \t\n\f\r]+/).filter(Boolean))];

const addTo = (list: string[], name: string): void => {
  if (semantics === 'lynx') {
    list.push(name);
    return;
  }
  if (name === '' || /[ \t\n\f\r]/.test(name)) {
    throw new Error('InvalidCharacterError');
  }
  if (!list.includes(name)) list.push(name);
};

let nextId = 1;
/**
 * The class calls native got, in order: [call, element id, argument].
 */
let log: unknown[][] = [];
let page: FakeEl;

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  classes: [],
});

const detach = (child: FakeEl): void => {
  const parent = child.parent;
  if (!parent) return;
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parent = null;
};

const walk = (root: FakeEl): FakeEl[] => [
  root,
  ...root.children.flatMap((child) => walk(child)),
];

const installNativeFakes = (): void => {
  nextId = 1;
  log = [];
  page = makeEl('page');
  const g = globalThis as Record<string, unknown>;
  g['__CreatePage'] = () => page;
  g['__CreateView'] = () => makeEl('view');
  g['__CreateText'] = () => makeEl('text');
  g['__CreateRawText'] = () => makeEl('raw-text');
  g['__GetElementUniqueID'] = (n: FakeEl) => n.id;
  g['__GetTag'] = (n: FakeEl) => n.tag;
  g['__GetParent'] = (n: FakeEl) => n.parent;
  g['__GetChildren'] = (n: FakeEl) => n.children.slice();
  g['__FirstElement'] = (n: FakeEl) => n.children[0] ?? null;
  g['__NextElement'] = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;
  g['__AppendElement'] = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    parent.children.push(child);
    child.parent = parent;
  };
  g['__InsertElementBefore'] = (
    parent: FakeEl,
    child: FakeEl,
    ref: FakeEl | null,
  ) => {
    detach(child);
    const at = ref ? parent.children.indexOf(ref) : -1;
    parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
    child.parent = parent;
  };
  g['__RemoveElement'] = (_parent: FakeEl, child: FakeEl) => detach(child);
  g['__AddClass'] = (n: FakeEl, name: string) => {
    log.push(['add', n.id, name]);
    addTo(n.classes, name);
  };
  g['__SetClasses'] = (n: FakeEl, classes: string) => {
    log.push(['set', n.id, classes]);
    n.classes = namesOf(classes ?? '');
  };
  g['__GetClasses'] = (n: FakeEl) => {
    log.push(['get', n.id]);
    return n.classes.slice();
  };
  // Lynx for Web reads `class` from the DOM element.
  g['__GetAttributeByName'] = (n: FakeEl, name: string) =>
    name === 'class' ? n.classes.join(' ') : undefined;
  g['__GetAttributeNames'] = (n: FakeEl) => (n.classes.length ? ['class'] : []);
  g['__QuerySelector'] = (root: FakeEl, selector: string) =>
    walk(root).find((n) => n.classes.includes(selector.slice(1))) ?? null;
  g['__QuerySelectorAll'] = (root: FakeEl, selector: string) =>
    walk(root).filter((n) => n.classes.includes(selector.slice(1)));
  g['__FlushElementTree'] = () => log.push(['flush']);
  for (const name of [
    '__SetAttribute',
    '__SetInlineStyles',
    '__AddInlineStyle',
    '__SetID',
    '__SetDataset',
    '__AddEvent',
    '__MarkTemplateElement',
    '__MarkPartElement',
  ]) {
    g[name] = () => {};
  }
  g['__GetAttributes'] = () => ({});
  g['__GetInlineStyles'] = () => '';
  setPageElementRef(null);
};

const fake = (el: LynxElement): FakeEl => el.element as unknown as FakeEl;

/**
 * The class calls `el`'s native element got.
 */
const callsOn = (el: LynxElement): unknown[][] =>
  log.filter((entry) => entry[1] === fake(el).id);

let doc: LynxDocument;
let factory: LynxRendererFactory2;

/**
 * Runs `fn` inside a change detection, as Angular does.
 */
const cycle = (fn: () => void): void => {
  factory.begin!();
  try {
    fn();
  } finally {
    factory.end!();
  }
};

/**
 * A view as LynxDocument makes one: its native element has no classes.
 */
const view = (): LynxElement => doc.createElement('view') as LynxElement;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.stubGlobal('__PROFILE__', false);
  vi.stubGlobal('__MAIN_THREAD__', true);
  vi.stubGlobal('SystemInfo', { platform: 'iOS' });
  semantics = 'lynx';
  installNativeFakes();
  doc = new LynxDocument();
  factory = runInInjectionContext(
    Injector.create({ providers: [{ provide: LYNX_DOCUMENT, useValue: doc }] }),
    () => new LynxRendererFactory2(),
  );
});

afterEach(async () => {
  await settle();
  vi.unstubAllGlobals();
});

// The first render's latch is module-level and only ever flips once, so
// these go before the tests that flip it.
describe('during the first render', () => {
  it("writes a cycle's classes, though native makes the flush", () => {
    const el = view();
    cycle(() => {
      el.setAttribute('class', 'a b');
      el.addClass('c');
      expect(log).toEqual([]);
    });

    expect(log).toEqual([['set', fake(el).id, 'a b c']]);
    expect(fake(el).classes).toEqual(['a', 'b', 'c']);
  });
});

describe('class changes during change detection', () => {
  beforeAll(() => {
    markFirstRenderComplete();
  });

  it('write each element once, at the end of the cycle, before the flush', () => {
    /**
     * A variant's 15 classes. A host switching variants: Angular applies a
     * [class] binding's change one class at a time, removing the old
     * variant's and adding the new.
     */
    const variant = (prefix: string): string[] =>
      Array.from({ length: 15 }, (_, i) => `${prefix}-${i}`);
    const host = view();
    cycle(() => {
      host.addScopeClass('_nghost-c1');
      for (const name of variant('primary')) host.addClass(name);
    });
    expect(log).toEqual([
      ['set', fake(host).id, ['_nghost-c1', ...variant('primary')].join(' ')],
      ['flush'],
    ]);

    log = [];
    cycle(() => {
      for (const name of variant('primary')) host.removeClass(name);
      for (const name of variant('ghost')) host.addClass(name);
      // Nothing reaches native until the end of the cycle.
      expect(log).toEqual([]);
    });

    expect(log).toEqual([
      ['set', fake(host).id, ['_nghost-c1', ...variant('ghost')].join(' ')],
      ['flush'],
    ]);
  });

  it('leave no write for a class added and removed again', () => {
    const el = view();
    cycle(() => el.setAttribute('class', 'a'));
    log = [];

    cycle(() => {
      el.addClass('b');
      el.removeClass('b');
      // Angular removes a false [class.x] binding's class, there or not.
      el.removeClass('c');
    });
    cycle(() => {
      el.removeClass('a');
      el.addClass('a');
    });

    expect(log).toEqual([['flush'], ['flush']]);
  });

  it("keep a class native has twice on iOS and Android, as Lynx for Web's once", () => {
    // `class="a"` with `[class.a]`: Angular adds the name it wrote already.
    for (const each of ['lynx', 'web'] as const) {
      semantics = each;
      const el = view();
      cycle(() => {
        el.setAttribute('class', 'a b');
        el.addClass('c');
        el.addClass('a');
        el.addClass('d');
      });

      // What waited goes first, so the name's added where it always was.
      expect(callsOn(el)).toEqual([
        ['set', fake(el).id, 'a b c'],
        ['add', fake(el).id, 'a'],
        ['add', fake(el).id, 'd'],
      ]);
      expect(fake(el).classes).toEqual(
        each === 'lynx' ? ['a', 'b', 'c', 'a', 'd'] : ['a', 'b', 'c', 'd'],
      );

      // From native's own list, as always: both go.
      cycle(() => el.removeClass('a'));
      expect(fake(el).classes).toEqual(['b', 'c', 'd']);
      // That list has each name once, so the next changes wait again.
      log = [];
      cycle(() => {
        el.addClass('e');
        el.removeClass('b');
      });
      expect(callsOn(el)).toEqual([['set', fake(el).id, 'c d e']]);
    }
  });

  it('add a name with a space in it at once, as Lynx keeps it whole', () => {
    const el = view();
    cycle(() => {
      el.setAttribute('class', 'a');
      el.addClass('x y');
      el.addClass('b');
    });

    expect(callsOn(el)).toEqual([
      ['set', fake(el).id, 'a'],
      ['add', fake(el).id, 'x y'],
      ['add', fake(el).id, 'b'],
    ]);
    expect(fake(el).classes).toEqual(['a', 'x y', 'b']);
  });

  it('write a class string with an odd runtime class at once', () => {
    const el = view();
    cycle(() => {
      el.addClass('a');
      el.setRuntimeClass('odd name', true);
      el.setAttribute('class', 'b');
    });

    expect(callsOn(el)).toEqual([
      ['set', fake(el).id, 'a'],
      ['add', fake(el).id, 'odd name'],
      ['set', fake(el).id, 'b odd name'],
    ]);
  });

  it('write the classes of a list item being built before its own flush', () => {
    const el = view();
    bindListItem(() => {
      cycle(() => el.addClass('item'));
      // componentAtIndex flushes the item next.
      expect(log).toEqual([['set', fake(el).id, 'item']]);
    });
  });

  it('write before the flush that the next event leaves out', async () => {
    // The commit comes before markTreeFlushed: an event that changes
    // nothing has nothing to flush for them after it (see #dispatch).
    const el = view();
    let tap: (event: object) => unknown = () => undefined;
    vi.stubGlobal(
      '__AddEvent',
      (
        _ref: unknown,
        _type: string,
        name: string,
        handler: { value: never },
      ) => {
        if (name === 'tap') tap = handler.value;
      },
    );
    el.addEventListener('bindtap', () => {});
    cycle(() => el.addClass('a'));
    await settle();
    log = [];

    tap({ type: 'tap' });
    await settle();

    expect(log).toEqual([]);
  });

  it('go to native at once outside change detection, as before', async () => {
    const el = view();
    el.setAttribute('class', 'a b');
    el.addClass('c');
    el.removeClass('a');

    expect(callsOn(el)).toEqual([
      ['set', fake(el).id, 'a b'],
      ['add', fake(el).id, 'c'],
      ['get', fake(el).id],
      ['set', fake(el).id, 'b c'],
    ]);
    await settle();
    expect(log[log.length - 1]).toEqual(['flush']);
  });

  it('keep a class a raw __AddClass gave outside change detection', () => {
    const el = view();
    el.setAttribute('class', 'a b');
    (globalThis as { __AddClass: (n: unknown, c: string) => void }).__AddClass(
      el.element,
      'raw',
    );
    el.removeClass('a');
    expect(fake(el).classes).toEqual(['b', 'raw']);

    // Native's list, read back, is the element's from here: the next cycle
    // keeps it.
    log = [];
    cycle(() => el.addClass('c'));
    expect(callsOn(el)).toEqual([['set', fake(el).id, 'b raw c']]);
  });

  it('go to native at once on Lynx for Web, during change detection too', () => {
    // A web element's layout is read from the DOM at once, from the classes
    // it has then.
    vi.stubGlobal('__WEB__', true);
    const el = view();
    const dom = fake(el) as FakeEl & { getBoundingClientRect(): DOMRect };
    dom.getBoundingClientRect = () =>
      ({ width: dom.classes.includes('w-10') ? 40 : 0 }) as DOMRect;
    const widths: number[] = [];
    cycle(() => {
      el.setAttribute('class', 'a');
      el.addClass('w-10');
      widths.push(el.getBoundingClientRect().width);
      el.removeClass('w-10');
      widths.push(el.clientWidth);
    });

    expect(widths).toEqual([40, 0]);
    expect(callsOn(el)).toEqual([
      ['set', fake(el).id, 'a'],
      ['add', fake(el).id, 'w-10'],
      ['get', fake(el).id],
      ['set', fake(el).id, 'a'],
    ]);
  });

  it('nest: a detectChanges inside a cycle writes what waited', () => {
    const el = view();
    cycle(() => {
      el.addClass('a');
      cycle(() => el.addClass('b'));
      // The inner end() ended the cycle: the rest goes at once.
      el.addClass('c');
      el.removeClass('a');
    });

    expect(fake(el).classes).toEqual(['b', 'c']);
  });

  it("follow the page's dark class", () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Light' } });
    const root = doc.createRootElement();
    cycle(() => root.setAttribute('class', 'app'));
    log = [];

    // An app's own choice, made during change detection.
    cycle(() => {
      root.setRuntimeClass('dark', true);
      expect(log).toEqual([]);
    });
    expect(callsOn(root)).toEqual([['set', page.id, 'app dark']]);

    // The device's, outside it.
    log = [];
    root.setRuntimeClass('dark', false);
    expect(callsOn(root)).toEqual([
      ['get', page.id],
      ['set', page.id, 'app'],
    ]);
  });

  it('keep the classes of a page taken over from the app before', () => {
    vi.stubGlobal('lynx', { __globalProps: { theme: 'Light' } });
    // A hot update's re-bootstrap renders into the page the old app drew.
    page.classes = ['old', 'dark'];
    setPageElementRef(page as unknown as ElementRef);
    handOverPageToNextApp();
    const root = new LynxDocument().createRootElement();
    log = [];

    cycle(() => root.setRuntimeClass('dark', true));
    expect(log).toEqual([['add', page.id, 'dark'], ['flush']]);
    expect(page.classes).toEqual(['old', 'dark', 'dark']);
  });

  it('reach a rebuilt element, which gets them once', () => {
    const parent = view();
    const el = view();
    cycle(() => {
      parent.appendChild(el);
      el.setAttribute('class', 'a b');
    });
    cycle(() => el.remove());
    const removed = fake(el);
    log = [];

    // Changed before and after it's put back, which rebuilds it.
    cycle(() => {
      el.addClass('c');
      parent.appendChild(el);
      el.addClass('d');
    });
    expect(fake(el)).not.toBe(removed);
    expect(log).toEqual([
      ['set', fake(el).id, 'a b c'],
      ['set', fake(el).id, 'a b c d'],
      ['flush'],
    ]);
    expect(fake(el).classes).toEqual(['a', 'b', 'c', 'd']);

    // A rebuild has what waited, so nothing's written again.
    cycle(() => el.remove());
    log = [];
    cycle(() => {
      el.addClass('e');
      parent.appendChild(el);
    });
    expect(log).toEqual([['set', fake(el).id, 'a b c d e'], ['flush']]);
  });

  it('are what a class selector or a read of `class` finds meanwhile', () => {
    const parent = view();
    const el = view();
    cycle(() => parent.appendChild(el));

    cycle(() => {
      el.addClass('found');
      expect(parent.querySelector('.found')).toBe(el);
      el.addClass('all');
      expect(parent.querySelectorAll('.all')).toEqual([el]);
      el.addClass('read');
      expect(el.getAttribute('class')).toBe('found all read');
    });
  });

  it("are what a main-thread script's element reads meanwhile", () => {
    const parent = view();
    const el = view();
    cycle(() => parent.appendChild(el));
    const script = new MainThreadElement(parent.element);
    const own = new MainThreadElement(el.element);

    cycle(() => {
      el.addClass('found');
      expect(script.querySelector('.found')).not.toBeNull();
      el.addClass('all');
      expect(script.querySelectorAll('.all')).toHaveLength(1);
      el.addClass('read');
      expect(own.getAttribute('class')).toBe('found all read');
    });
    const fresh = view();
    cycle(() => {
      fresh.addClass('named');
      expect(new MainThreadElement(fresh.element).getAttributeNames()).toEqual([
        'class',
      ]);
    });
  });

  it('are where requestFocus looks for its element meanwhile', async () => {
    vi.stubGlobal('__GetPageElement', () => page);
    const focused: number[] = [];
    vi.stubGlobal(
      '__InvokeUIMethod',
      (
        n: FakeEl,
        _method: string,
        _params: unknown,
        done: (r: object) => void,
      ) => {
        focused.push(n.id);
        done({ code: 0, data: null });
      },
    );
    const root = doc.createRootElement();
    const el = view();
    cycle(() => root.appendChild(el));

    let focus: Promise<void> | undefined;
    cycle(() => {
      el.addClass('first-error');
      focus = new LynxAccessibility().requestFocus('.first-error');
    });

    await expect(focus).resolves.toBeUndefined();
    expect(focused).toEqual([fake(el).id]);
  });

  it('are on native before an animation has it lay out the tree', () => {
    // __ElementAnimate resolves and lays out the tree as it is at once.
    const seen: unknown[][] = [];
    vi.stubGlobal('__ElementAnimate', (n: FakeEl, args: unknown[]) => {
      seen.push([args[0], n.classes.join(' ')]);
    });
    const el = view();
    cycle(() => {
      el.setAttribute('class', 'a');
      const animation = el.animate([{ opacity: 0 }, { opacity: 1 }], 100);
      el.addClass('b');
      animation.pause();
      el.addClass('c');
      animation.play();
      el.addClass('d');
      animation.cancel();
      // A main-thread script's animation too.
      el.addClass('e');
      new MainThreadElement(el.element).animate([{ opacity: 1 }], 100);
    });

    expect(seen).toEqual([
      [0, 'a'],
      [2, 'a b'],
      [1, 'a b c'],
      [3, 'a b c d'],
      [0, 'a b c d e'],
    ]);
  });

  it('are what getComputedStyle reads meanwhile', () => {
    // The testing library's DOM runs these code paths, and its styles follow
    // the DOM element's classes.
    const el = view();
    const dom = fake(el) as FakeEl & { ownerDocument: object };
    dom.ownerDocument = {
      defaultView: {
        getComputedStyle: (node: FakeEl) => ({
          display: node.classes.includes('hidden') ? 'none' : 'flex',
        }),
      },
    };
    const target: Record<string, any> = { getComputedStyle: () => ({}) };
    installCanvasGlobals(target);

    let display = '';
    cycle(() => {
      el.addClass('hidden');
      display = target['getComputedStyle'](el).display;
    });

    expect(display).toBe('none');
  });

  it('are in a snapshot a server render takes meanwhile', () => {
    const el = view();
    cycle(() => {
      el.setAttribute('class', 'a');
      el.addClass('b');
      const recorder = new OpcodeRecorder();
      serializeElementTree(el.element, recorder);
      expect(recorder.opcodes).toContain('a b');
    });
  });

  it("are written for a loose text's anonymous <text>", () => {
    const parent = view();
    const raw = doc.createText('Hi');
    cycle(() => {
      parent.appendChild(raw);
      parent.appendChild(view());
    });

    const text = fake(parent).children[0]!;
    expect(text.tag).toBe('text');
    expect(text.classes).toEqual([ANONYMOUS_TEXT_CLASS]);
  });

  it("keep a hydrated element's snapshot classes, as before", () => {
    // A server render's elements have classes only native knows.
    const hostRef = makeEl('view');
    hostRef.classes = ['_nghost-s', 'snap'];
    const staticRef = makeEl('view');
    staticRef.classes = ['_ngcontent-s', 'card'];
    const hydrate = new LynxHydrateDocument(
      page as unknown as ElementRef,
      [hostRef, staticRef] as unknown as ElementRef[],
    );
    const host = hydrate.createElement('view') as LynxElement;
    const card = hydrate.createElement('view') as LynxElement;
    log = [];

    cycle(() => {
      host.addClass('bound');
      card.setAttribute('class', 'card');
    });
    // Added to native's list, and the whole string written, at once.
    expect(log).toEqual([
      ['add', hostRef.id, 'bound'],
      ['set', staticRef.id, 'card'],
      ['flush'],
    ]);
    expect(hostRef.classes).toEqual(['_nghost-s', 'snap', 'bound']);

    // A removal reads native's list, and keeps the snapshot's classes. The
    // list has each name once, so the next change waits for the end.
    log = [];
    cycle(() => {
      host.removeClass('bound');
      host.addClass('later');
      card.addClass('wide');
    });
    expect(log).toEqual([
      ['get', hostRef.id],
      ['set', hostRef.id, '_nghost-s snap'],
      ['set', hostRef.id, '_nghost-s snap later'],
      ['set', staticRef.id, 'card wide'],
      ['flush'],
    ]);
  });

  it('wait in a cycle a settle flush ends, if no end() did', async () => {
    const el = view();
    factory.begin!();
    el.addClass('a');
    // Ended without end(), as nothing in Angular does.
    setInsideChangeDetection(false);
    scheduleSettleFlush();
    await settle();

    expect(log).toEqual([['set', fake(el).id, 'a'], ['flush']]);
  });

  describe('leave native as a call for each change did', () => {
    /**
     * What native and the element's class string were before: a call for
     * each change, __AddClass to add and native's list read back to remove
     * (the code these tests replaced). `scope` is the element's scope and
     * runtime classes, which a class string keeps.
     */
    type Model = { native: string[]; classes: string; scope: string[] };
    const before = {
      setAttribute(m: Model, value: string | null): void {
        const names = new Set(
          String(value ?? '')
            .split(/\s+/)
            .filter(Boolean),
        );
        for (const scope of m.scope) names.add(scope);
        m.classes = [...names].join(' ');
        m.native = namesOf(m.classes);
      },
      addClass(m: Model, name: string): void {
        addTo(m.native, name);
        m.classes = [
          ...new Set([...m.classes.split(/\s+/).filter(Boolean), name]),
        ].join(' ');
      },
      removeClass(m: Model, name: string): void {
        m.classes = m.native.filter((c) => c !== name).join(' ');
        m.native = namesOf(m.classes);
      },
      setRuntimeClass(m: Model, name: string, on: boolean): void {
        const index = m.scope.indexOf(name);
        if (on === (index !== -1)) return;
        if (on) {
          m.scope.push(name);
          before.addClass(m, name);
        } else {
          m.scope.splice(index, 1);
          before.removeClass(m, name);
        }
      },
    };

    /**
     * A small seeded generator, so a failure can be replayed.
     */
    const random = (seed: number) => () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    /**
     * The class string the element is rebuilt with (see #recreateSubtree).
     */
    const rebuiltClasses = (el: LynxElement, parent: LynxElement): unknown => {
      cycle(() => parent.appendChild(el));
      cycle(() => el.remove());
      log = [];
      cycle(() => parent.appendChild(el));
      const set = log.find((entry) => entry[0] === 'set');
      return set ? set[2] : '';
    };

    for (const each of ['lynx', 'web'] as const) {
      for (const hydrated of [false, true]) {
        it(`on ${each === 'lynx' ? 'iOS and Android' : 'Lynx for Web'}${hydrated ? ', from a snapshot' : ''}`, () => {
          for (let seed = 1; seed <= 60; seed++) {
            semantics = each;
            const next = random(seed);
            const pick = <T>(list: readonly T[]): T =>
              list[Math.floor(next() * list.length)]!;
            // Lynx for Web can't add a name with whitespace in it, or none.
            const pool =
              each === 'lynx'
                ? ['a', 'b', 'c', 'd', 'x y', '']
                : ['a', 'b', 'c', 'd'];
            const runtime = each === 'lynx' ? ['dark', 'odd name'] : ['dark'];
            const snapshot = hydrated ? ['snap', 'a'] : [];
            let el: LynxElement;
            if (hydrated) {
              const ref = makeEl('view');
              ref.classes = snapshot.slice();
              el = new LynxElement(ref as unknown as ElementRef);
              el.tagName = 'view';
            } else {
              el = view();
            }
            const model: Model = {
              native: snapshot.slice(),
              classes: '',
              scope: [],
            };
            const step = (): void => {
              const roll = next();
              if (roll < 0.15) {
                const value = Array.from(
                  { length: Math.floor(next() * 4) },
                  () => pick(['a', 'b', 'c', 'd']),
                ).join(pick([' ', '  ', '\t']));
                el.setAttribute('class', value);
                before.setAttribute(model, value);
              } else if (roll < 0.55) {
                const name = pick(pool);
                el.addClass(name);
                before.addClass(model, name);
              } else if (roll < 0.85) {
                const name = pick(pool);
                el.removeClass(name);
                before.removeClass(model, name);
              } else {
                const name = pick(runtime);
                const on = next() < 0.5;
                el.setRuntimeClass(name, on);
                before.setRuntimeClass(model, name, on);
              }
            };
            for (let round = 0; round < 8; round++) {
              if (next() < 0.7) {
                cycle(() => {
                  for (let i = Math.floor(next() * 6); i > 0; i--) step();
                });
              } else {
                step();
              }
              expect(fake(el).classes, `seed ${seed}`).toEqual(model.native);
            }
            expect(rebuiltClasses(el, view()), `seed ${seed}`).toBe(
              model.classes,
            );
          }
        });
      }
    }
  });
});

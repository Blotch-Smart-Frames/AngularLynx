// @vitest-environment jsdom
// Drives `*lynxListFor` through the real renderer (LynxDocument, LynxElement,
// LynxListElement and the list callbacks create-list-element.ts registers)
// against an in-memory fake of the native element tree and of the native
// list: a test plays native's part, asking for items by index
// (componentAtIndex) and letting their elements go (enqueueComponent), and
// reads back what the list told native (update-list-info) and what each
// element shows.
import '@angular/compiler';
import {
  ApplicationRef,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Directive,
  type Injector,
  provideZonelessChangeDetection,
  RendererFactory2,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { afterNextFlush, LynxElement } from '../lynx-element/lynx-element';
import {
  type ListSlot,
  LynxListElement,
} from '../lynx-element/lynx-list-element';
import { LynxDocument } from '../lynx-document';
import { setPageElementRef } from '../lynx-document/page-ref';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { LynxRendererFactory2 } from '../renderer/lynx-renderer-factory2';
import { LYNX_DOCUMENT } from '../renderer/token';
import type { FakeNativeGlobal } from '../testing/fake-native-global';
import { seededBelow, untrimmedListDiff } from '../testing/untrimmed-list-diff';
import { LynxListFor, type LynxListItemAttributes } from './list-for';

vi.mock('../lynx-element/collect-garbage', () => ({
  noteReleased: vi.fn(),
  scheduleCollection: vi.fn(),
}));

// --- Fake native tree ---------------------------------------------------------

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  text?: string;
  attrs: Map<string, unknown>;
  classes: Set<string>;
};

type InsertAction = { position: number; 'item-key': string; type: string };
type ListInfo = {
  insertAction: InsertAction[];
  removeAction: number[];
  updateAction: Array<InsertAction & { from: number; to: number }>;
};

type ComponentAtIndex = (
  list: FakeEl,
  listId: number,
  index: number,
  operationId: number,
  enableReuseNotification?: boolean,
) => number | undefined;
type EnqueueComponent = (list: FakeEl, listId: number, sign: number) => void;
type ComponentAtIndexes = (
  list: FakeEl,
  listId: number,
  indexes: number[],
  operationIds: number[],
  enableReuseNotification: boolean,
  asyncFlush: boolean,
) => void;

/** A native list: its callbacks, and the item keys it was told about. */
type FakeList = FakeEl & {
  componentAtIndex: ComponentAtIndex;
  enqueueComponent: EnqueueComponent;
  componentAtIndexes: ComponentAtIndexes;
  keys: string[];
  updates: ListInfo[];
};

let nextId = 1;
let pageRoot: FakeEl;
const created: FakeEl[] = [];
const lists: FakeList[] = [];
/** Every __FlushElementTree call: the element flushed, and the options. */
const flushes: Array<{ element: FakeEl | undefined; options: any }> = [];
let operationId = 1;

const makeEl = (tag: string, text?: string): FakeEl => {
  const el: FakeEl = {
    id: nextId++,
    tag,
    parent: null,
    children: [],
    text,
    attrs: new Map(),
    classes: new Set(),
  };
  created.push(el);
  return el;
};

const detach = (child: FakeEl): void => {
  const parent = child.parent;
  if (!parent) return;
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parent = null;
};

const installNativeFakes = (): void => {
  nextId = 1;
  created.length = 0;
  lists.length = 0;
  flushes.length = 0;
  pageRoot = makeEl('page');
  const g = globalThis as unknown as FakeNativeGlobal<FakeEl> &
    Record<string, unknown>;
  g.__CreatePage = () => pageRoot;
  g.__CreateView = () => makeEl('view');
  g.__CreateText = () => makeEl('text');
  g.__CreateScrollView = () => makeEl('scroll-view');
  g.__CreateImage = () => makeEl('image');
  g.__CreateRawText = (text: string) => makeEl('raw-text', text);
  g.__CreateElement = (tag: string) => makeEl(tag);
  g.__CreateWrapperElement = () => makeEl('wrapper');
  g.__GetElementUniqueID = (n: FakeEl) => n.id;
  g.__GetTag = (n: FakeEl) => n.tag;
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
    detach(child);
    return child;
  };
  g.__GetParent = (n: FakeEl) => n.parent;
  g.__GetChildren = (n: FakeEl) => n.children.slice();
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;
  g.__LastElement = (n: FakeEl) => n.children.at(-1) ?? null;
  g.__NextElement = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;
  g.__SetClasses = (n: FakeEl, s: string | undefined) => {
    n.classes = new Set((s ?? '').split(/\s+/).filter(Boolean));
  };
  g.__GetClasses = (n: FakeEl) => [...n.classes];
  g.__AddClass = (n: FakeEl, name: string) => n.classes.add(name);
  g.__SetAttribute = (n: FakeEl, name: string, value: unknown) => {
    if (name === 'update-list-info') applyListInfo(n as FakeList, value);
    n.attrs.set(name, value);
  };
  g.__GetAttributeByName = (n: FakeEl, name: string) => n.attrs.get(name);
  g.__SetID = (n: FakeEl, id: string) => n.attrs.set('id', id);
  g.__SetDataset = () => {};
  g.__SetConfig = () => {};
  g.__AddInlineStyle = () => {};
  g.__SetInlineStyles = () => {};
  g.__AddEvent = () => {};
  g.__ElementAnimate = () => {};
  g.__FlushElementTree = ((element?: FakeEl, options?: unknown) => {
    flushes.push({ element, options });
  }) as () => void;
  g.__CreateList = (
    _pageId: number,
    componentAtIndex: ComponentAtIndex,
    enqueueComponent: EnqueueComponent,
    _info: unknown,
    componentAtIndexes: ComponentAtIndexes,
  ) => {
    const list = Object.assign(makeEl('list'), {
      componentAtIndex,
      enqueueComponent,
      componentAtIndexes,
      keys: [] as string[],
      updates: [] as ListInfo[],
    });
    lists.push(list);
    return list;
  };
  g.__UpdateListCallbacks = (
    list: FakeList,
    componentAtIndex: ComponentAtIndex,
    enqueueComponent: EnqueueComponent,
    componentAtIndexes: ComponentAtIndexes,
  ) => {
    Object.assign(list, {
      componentAtIndex,
      enqueueComponent,
      componentAtIndexes,
    });
  };
  setPageElementRef(pageRoot as never);
};

/**
 * Applies an update to the list's keys as native does: removals at their
 * old indices, from the last, then insertions at their final positions in
 * ascending order, then updates in place.
 */
const applyListInfo = (list: FakeList, info: ListInfo): void => {
  list.updates.push(info);
  for (const index of [...info.removeAction].reverse()) {
    list.keys.splice(index, 1);
  }
  for (const action of info.insertAction) {
    list.keys.splice(action.position, 0, action['item-key']);
  }
  for (const action of info.updateAction) {
    list.keys[action.from] = action['item-key'];
  }
};

const theList = (): FakeList => lists[0]!;

/**
 * Native asks for the item at `index`, as its layout pass does.
 */
const show = (index: number, reuseNotification = false): number | undefined =>
  theList().componentAtIndex(
    theList(),
    theList().id,
    index,
    operationId++,
    reuseNotification,
  );

/**
 * Native lets go of an item's element, as when it scrolls away.
 */
const hide = (sign: number): void =>
  theList().enqueueComponent(theList(), theList().id, sign);

const byId = (id: number): FakeEl => created.find((el) => el.id === id)!;

/**
 * The text an element shows, its raw texts' in order.
 */
const textOf = (el: FakeEl): string =>
  el.tag === 'raw-text'
    ? String(el.attrs.get('text') ?? el.text ?? '')
    : el.children.map(textOf).join('');

/**
 * The text of the row's `.name` <text> in the item element `sign`.
 */
const nameIn = (sign: number): string => {
  const find = (el: FakeEl): FakeEl | undefined =>
    el.classes.has('name') ? el : el.children.map(find).find(Boolean);
  return textOf(find(byId(sign))!).trim();
};
const metaIn = (sign: number): string => {
  const find = (el: FakeEl): FakeEl | undefined =>
    el.classes.has('meta') ? el : el.children.map(find).find(Boolean);
  return textOf(find(byId(sign))!).trim();
};

/**
 * How many item views have been built: one `<list-item>` each.
 */
const built = (): number =>
  created.filter((el) => el.tag === 'list-item').length;

// --- Hosts ----------------------------------------------------------------------

type Row = { id: number; name: string; kind?: string };
const rowsOf = (count: number, from = 1): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: from + i,
    name: `Row ${from + i}`,
  }));

/**
 * Sets an Angular InputSignal's value through its reactive node. JIT mode
 * (these tests compile templates at runtime) doesn't wire signal inputs to
 * template bindings, so the tests set the directive's inputs themselves.
 */
const setInputSignal = (signalFn: unknown, value: unknown): void => {
  const symbol = Object.getOwnPropertySymbols(signalFn).find(
    (s) => s.toString() === 'Symbol(SIGNAL)',
  )!;
  const node = (signalFn as Record<symbol, any>)[symbol];
  Object.getPrototypeOf(node).applyValueToInputSignal(node, value);
};

/** Each LynxListFor instance, as its first check finds it. */
const directives: Array<LynxListFor<Row>> = [];

@Component({
  selector: 'rows-host',
  imports: [LynxListFor],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  encapsulation: ViewEncapsulation.None,
  template: `
    <list>
      <list-item
        *lynxListFor="
          let row of rows;
          let i = index;
          let count = count;
          let first = first;
          let last = last;
          let even = even;
          let odd = odd
        "
      >
        <text class="name">{{ row.name }}{{ suffix() }}</text>
        <text class="meta"
          >{{ i }}/{{ count }} {{ first ? 'first' : '' }}
          {{ last ? 'last' : '' }} {{ even ? 'even' : '' }}
          {{ odd ? 'odd' : '' }}</text
        >
      </list-item>
    </list>
  `,
})
class RowsHost {
  // Bound only so the directive's selector matches: the tests set its
  // inputs themselves (see setInputSignal).
  readonly rows = [];
  // Read by every item, to tell which views change detection reaches.
  readonly suffix = signal('');
}

type Fixture = {
  componentRef: { injector: Injector };
  detectChanges(): void;
  whenStable(): Promise<unknown>;
};

/**
 * Checks the host again, which checks the directive (its ngDoCheck): the
 * host's own view is marked, as a signal it reads would mark it.
 */
const update = async (fixture: Fixture) => {
  fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
  fixture.detectChanges();
  await fixture.whenStable();
};

/** The directive's inputs, as a template would bind them. */
type Inputs = {
  rows?: Iterable<Row> | null;
  trackBy?: ((index: number, row: Row) => unknown) | undefined;
  attributes?:
    | ((row: Row, index: number) => LynxListItemAttributes)
    | undefined;
};

const setInputs = (directive: LynxListFor<Row>, inputs: Inputs): void => {
  if ('rows' in inputs) setInputSignal(directive.lynxListForOf, inputs.rows);
  if ('trackBy' in inputs) {
    setInputSignal(directive.lynxListForTrackBy, inputs.trackBy);
  }
  if ('attributes' in inputs) {
    setInputSignal(directive.lynxListForItemAttributes, inputs.attributes);
  }
};

/**
 * Renders RowsHost with 100 rows keyed by id, and returns a `set` that sets
 * the directive's inputs and checks it again.
 */
const render = async (inputs: Inputs = {}) => {
  const fixture = TestBed.createComponent(RowsHost);
  fixture.detectChanges();
  const directive = directives.at(-1)!;
  setInputs(directive, {
    rows: rowsOf(100),
    trackBy: (_: number, row: Row) => row.id,
    ...inputs,
  });
  await update(fixture);
  const set = async (next: Inputs) => {
    setInputs(directive, next);
    await update(fixture);
  };
  return { fixture, directive, set };
};

describe('*lynxListFor', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    directives.length = 0;
    const check = LynxListFor.prototype.ngDoCheck;
    vi.spyOn(LynxListFor.prototype, 'ngDoCheck').mockImplementation(function (
      this: LynxListFor<Row>,
    ) {
      if (!directives.includes(this)) directives.push(this);
      check.call(this);
    });
    markFirstRenderComplete();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LYNX_DOCUMENT, useValue: new LynxDocument() },
        LynxRendererFactory2,
        { provide: RendererFactory2, useExisting: LynxRendererFactory2 },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('tells native about every item, and builds none until it asks', async () => {
    await render();

    expect(built()).toBe(0);
    expect(theList().keys).toEqual(rowsOf(100).map((row) => String(row.id)));
    expect(theList().updates.at(-1)!.insertAction[0]).toEqual({
      position: 0,
      type: 'list-item',
      'item-key': '1',
    });
  });

  it('builds an item when native asks for it, and flushes it with its operation id', async () => {
    await render();
    flushes.length = 0;

    const sign = show(4)!;

    expect(built()).toBe(1);
    expect(byId(sign).tag).toBe('list-item');
    expect(byId(sign).parent).toBe(theList());
    expect(nameIn(sign)).toBe('Row 5');
    expect(metaIn(sign)).toMatch(/^4\/100\s+even$/);
    // The item's flush is the only one: anything else would re-enter
    // native's layout pass.
    expect(flushes).toEqual([
      {
        element: byId(sign),
        options: {
          triggerLayout: true,
          operationID: operationId - 1,
          elementID: sign,
          listID: theList().id,
        },
      },
    ]);
  });

  it('gives the first and last items their context', async () => {
    await render({ rows: rowsOf(3) });

    expect(metaIn(show(0)!)).toMatch(/^0\/3 first\s+even$/);
    expect(metaIn(show(2)!)).toMatch(/^2\/3\s+last even$/);
  });

  it("doesn't flush the whole tree after an item for a cycle that changes nothing", async () => {
    const { fixture } = await render();
    show(4);
    flushes.length = 0;

    // Angular runs a cycle like this after most binds: one for the views a
    // rebound item's `@if` detached, which refreshes no view.
    fixture.componentRef.injector.get(ApplicationRef).tick();

    // The item's own flush committed what it wrote.
    expect(flushes).toEqual([]);
  });

  it('still flushes after an item what was waiting from before it', async () => {
    const { fixture } = await render();
    // A write outside the item, from before it was built, which leaves its
    // flush to whoever made it.
    new LynxElement(makeEl('view') as never).setAttribute('id', 'header');
    show(4);
    flushes.length = 0;

    fixture.componentRef.injector.get(ApplicationRef).tick();

    expect(flushes).toEqual([{ element: undefined, options: undefined }]);
  });

  it('reuses the view of an item native let go of for the next item it asks for', async () => {
    await render();
    const signs = [0, 1, 2, 3, 4].map((i) => show(i)!);
    hide(signs[0]!);
    hide(signs[1]!);

    const reused = show(5)!;

    expect(built()).toBe(5);
    // The oldest it let go of, as React Lynx's recycle map does.
    expect(reused).toBe(signs[0]);
    expect(nameIn(reused)).toBe('Row 6');
    expect(metaIn(reused)).toMatch(/^5\/100\s+odd$/);
    expect(show(6)).toBe(signs[1]);
    expect(built()).toBe(5);
  });

  it('tells native an element shows another item when it asked to hear it', async () => {
    await render();
    const sign = show(0)!;
    hide(sign);
    flushes.length = 0;

    show(1, true);

    expect(flushes[0]!.options.listReuseNotification).toEqual({
      listElement: theList(),
      itemKey: '2',
    });
  });

  it('gives an item its own view back when native asks for it before reusing it', async () => {
    await render();
    const sign = show(3)!;
    hide(sign);
    flushes.length = 0;

    expect(show(3, true)).toBe(sign);
    expect(nameIn(sign)).toBe('Row 4');
    expect(flushes[0]!.options.listReuseNotification).toBeUndefined();
    expect(built()).toBe(1);
  });

  it('gives an item another view when native asks for it while it holds its element', async () => {
    await render();
    const first = show(2)!;

    // A move, or a cell bound anew, before native lets the element go: one
    // element in two cells would show one of them empty.
    const second = show(2)!;

    expect(second).not.toBe(first);
    expect(nameIn(second)).toBe('Row 3');
    // The first goes to the pool once native lets it go.
    hide(first);
    expect(show(50)).toBe(first);
    expect(nameIn(first)).toBe('Row 51');
  });

  it('ignores an element native lets go of twice, or one that is not an item', async () => {
    await render();
    const sign = show(0)!;
    hide(sign);
    hide(sign);
    hide(9999);

    expect(show(1)).toBe(sign);
    expect(show(2)).not.toBe(sign);
  });

  it('shows new values in the items on screen', async () => {
    const { set } = await render();
    const sign = show(0)!;
    const sent = theList().updates.length;

    await set({
      rows: rowsOf(100).map((row) => ({ ...row, name: `${row.name}!` })),
    });

    expect(nameIn(sign)).toBe('Row 1!');
    // The same keys: nothing for native to do.
    expect(theList().updates).toHaveLength(sent);
  });

  it('leaves the list alone when only what the items show changed', async () => {
    const rows = rowsOf(1000);
    const { set } = await render({ rows });
    const signs = [0, 1, 2].map((index) => show(index)!);
    const changed = vi.spyOn(LynxListElement.prototype, 'itemSourceChanged');
    const processed = vi.spyOn(LynxListElement.prototype, '_processUpdate');
    const sent = theList().updates.length;
    flushes.length = 0;

    // As a signal's update() replaces rows with changed copies: the same
    // keys, types and layout.
    const next = [...rows];
    next[1] = { ...rows[1]!, name: 'Row 2, read' };
    next[500] = { ...rows[500]!, name: 'Row 501, read' };
    await set({ rows: next });

    // Not even scheduled: the list would have collected and diffed all
    // 1,000 items to find nothing to send.
    expect(changed).not.toHaveBeenCalled();
    expect(processed).not.toHaveBeenCalled();
    expect(theList().updates).toHaveLength(sent);
    expect(
      flushes.filter(
        ({ element, options }) => !element && options?.triggerLayout,
      ),
    ).toEqual([]);
    // The rows on screen show it, and so does one native asks for next.
    expect(nameIn(signs[0]!)).toBe('Row 1');
    expect(nameIn(signs[1]!)).toBe('Row 2, read');
    expect(nameIn(show(500)!)).toBe('Row 501, read');
  });

  it('still tells the list when an item’s layout, type or place changed', async () => {
    type SizedRow = Row & { size?: number };
    const rows: SizedRow[] = rowsOf(5);
    const { set } = await render({
      rows,
      attributes: (row: SizedRow) => ({
        'estimated-main-axis-size-px': row.size,
        'reuse-identifier': row.kind,
      }),
    });
    const changed = vi.spyOn(LynxListElement.prototype, 'itemSourceChanged');

    const sized = [...rows];
    sized[2] = { ...rows[2]!, size: 80 };
    await set({ rows: sized });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(theList().updates.at(-1)).toMatchObject({
      insertAction: [],
      removeAction: [],
      updateAction: [{ from: 2, 'estimated-main-axis-size-px': 80 }],
    });

    const typed = [...sized];
    typed[3] = { ...sized[3]!, kind: 'big' };
    await set({ rows: typed });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(theList().updates.at(-1)).toMatchObject({
      insertAction: [{ position: 3, type: 'big', 'item-key': '4' }],
      removeAction: [3],
    });

    await set({ rows: [...typed].reverse() });
    expect(changed).toHaveBeenCalledTimes(3);
    expect(theList().keys).toEqual(['5', '4', '3', '2', '1']);
  });

  it('sees an array changed in place', async () => {
    const rows = rowsOf(2);
    const { fixture } = await render({ rows });

    rows.push({ id: 3, name: 'Row 3' });
    await update(fixture);

    expect(theList().keys).toEqual(['1', '2', '3']);
  });

  it('inserts, removes and moves items in native, and moves only what it must', async () => {
    const { set } = await render({ rows: rowsOf(5) });
    const sent = theList().updates.length;

    // 5 moves to the front, 3 goes, 6 comes.
    await set({
      rows: [
        { id: 5, name: 'Row 5' },
        { id: 1, name: 'Row 1' },
        { id: 2, name: 'Row 2' },
        { id: 4, name: 'Row 4' },
        { id: 6, name: 'Row 6' },
      ],
    });

    const info = theList().updates[sent]!;
    expect(info.removeAction).toEqual([2, 4]);
    expect(info.insertAction.map((action) => action.position)).toEqual([0, 4]);
    expect(theList().keys).toEqual(['5', '1', '2', '4', '6']);
  });

  it('sends what the diff over every item sent, over random edits', async () => {
    const below = seededBelow(1116);
    type SizedRow = Row & { size?: number };
    const attributesOf = (row: SizedRow): LynxListItemAttributes => ({
      'estimated-main-axis-size-px': row.size,
      'reuse-identifier': row.kind,
    });
    /**
     * The items as the list tells native about them, from the rows: what
     * the diff reads of a run's items.
     */
    const slotsOf = (rows: readonly SizedRow[]): ListSlot[] =>
      rows.map((row, index) => {
        const attributes = attributesOf(row);
        const type = attributes['reuse-identifier'] ?? 'list-item';
        return {
          id: `run|${type}|${row.id}`,
          ref: null,
          source: {} as ListSlot['source'],
          index,
          key: String(row.id),
          type,
          attributes,
        };
      });
    let rows: SizedRow[] = rowsOf(8);
    const { set } = await render({ rows, attributes: attributesOf });
    let nextId = 1000;
    const edits: Array<(next: SizedRow[]) => void> = [
      // A row comes, at the end or anywhere, goes, or moves.
      (next) => {
        if (next.length < 16)
          next.push({ id: nextId, name: `Row ${nextId++}` });
      },
      (next) => {
        if (next.length >= 16) return;
        next.splice(below(next.length + 1), 0, {
          id: nextId,
          name: `Row ${nextId++}`,
        });
      },
      (next) => {
        if (next.length > 0) next.splice(below(next.length), 1);
      },
      (next) => {
        if (next.length === 0) return;
        const [row] = next.splice(below(next.length), 1);
        next.splice(below(next.length + 1), 0, row!);
      },
      // A row's layout changes, at either end or between, or its reuse type,
      // or only what it shows.
      (next) => {
        if (next.length === 0) return;
        const at = below(next.length);
        next[at] = { ...next[at]!, size: [undefined, 40, 80][below(3)] };
      },
      (next) => {
        if (next.length === 0) return;
        const at = below(next.length);
        next[at] = { ...next[at]!, kind: next[at]!.kind ? undefined : 'big' };
      },
      (next) => {
        if (next.length === 0) return;
        const at = below(next.length);
        next[at] = { ...next[at]!, name: `${next[at]!.name}!` };
      },
    ];
    let updated = 0;

    for (let step = 0; step < 300; step++) {
      const next = [...rows];
      const count = 1 + below(3);
      for (let e = 0; e < count; e++) edits[below(edits.length)]!(next);
      const sent = theList().updates.length;

      await set({ rows: next });

      const expected = untrimmedListDiff(slotsOf(rows), slotsOf(next));
      expect(theList().updates.slice(sent)).toStrictEqual(
        expected ? [expected.info] : [],
      );
      expect(theList().keys).toEqual(next.map((row) => String(row.id)));
      if (expected?.info.updateAction.length) updated++;
      rows = next;
    }
    expect(updated).toBeGreaterThan(30);
  });

  it('updates the index of the items on screen when items go in above them', async () => {
    const { set } = await render();
    const sign = show(0)!;

    await set({ rows: [{ id: 0, name: 'Row 0' }, ...rowsOf(100)] });

    expect(nameIn(sign)).toBe('Row 1');
    expect(metaIn(sign)).toMatch(/^1\/101\s+odd$/);
  });

  it('lets a removed item keep its element until native lets it go, then reuses it', async () => {
    const { fixture, set } = await render();
    const sign = show(0)!;
    const other = show(1)!;

    await set({ rows: rowsOf(99, 2) });
    // Still in native's list until it lets go, and no longer checked: its
    // item is gone, so its template may not hold up.
    fixture.componentInstance.suffix.set('!');
    await update(fixture);
    expect(byId(sign).parent).toBe(theList());
    expect(nameIn(sign)).toBe('Row 1');
    expect(nameIn(other)).toBe('Row 2!');

    // Native asks for Row 2 again (it moved up) after letting both go: one
    // gets its own view back, the other reuses the removed item's, checked
    // again.
    hide(sign);
    hide(other);
    expect(show(0)).toBe(other);
    expect(show(1)).toBe(sign);
    expect(nameIn(sign)).toBe('Row 3!');
  });

  it('gives native each item’s layout attributes, and updates them in place', async () => {
    const { set } = await render({ rows: rowsOf(3) });

    await set({
      attributes: (row) => ({
        'estimated-main-axis-size-px': 40,
        'full-span': row.id === 1,
      }),
    });
    const info = theList().updates.at(-1)!;
    // New attributes for the same items: no insert or remove.
    expect(info.insertAction).toEqual([]);
    expect(info.updateAction[0]).toEqual({
      position: 0,
      from: 0,
      to: 0,
      flush: false,
      type: 'list-item',
      'item-key': '1',
      'estimated-main-axis-size-px': 40,
      'full-span': true,
    });

    await set({
      attributes: (row) => ({
        'estimated-main-axis-size-px': 40,
        'full-span': row.id === 2,
      }),
    });

    expect(
      theList()
        .updates.at(-1)!
        .updateAction.map((action) => action.from),
    ).toEqual([0, 1]);
  });

  it('sends nothing when the attributes come out the same', async () => {
    const { set } = await render({
      attributes: () => ({ 'estimated-main-axis-size-px': 40 }),
    });
    const sent = theList().updates.length;

    await set({ attributes: () => ({ 'estimated-main-axis-size-px': 40 }) });

    expect(theList().updates).toHaveLength(sent);
  });

  it('keeps a view to items of its own reuse-identifier', async () => {
    await render({
      rows: [{ id: 1, name: 'Header', kind: 'header' }, ...rowsOf(5, 2)],
      attributes: (row) => ({ 'reuse-identifier': row.kind ?? 'row' }),
    });
    expect(theList().updates.at(-1)!.insertAction[0]!.type).toBe('header');

    const header = show(0)!;
    hide(header);
    const row = show(1)!;

    expect(row).not.toBe(header);
    expect(built()).toBe(2);
  });

  it('never gives the view of a recyclable: false item to another item', async () => {
    const { set } = await render({
      rows: rowsOf(3),
      attributes: (row) => ({ recyclable: row.id !== 1 }),
    });
    const kept = show(0)!;
    hide(kept);

    // Another item gets a view of its own, and the item its view back.
    expect(show(1)).not.toBe(kept);
    expect(show(0)).toBe(kept);
    expect(nameIn(kept)).toBe('Row 1');

    // Once the item is gone, its view goes to the pool.
    hide(kept);
    await set({ rows: rowsOf(3, 2) });
    expect(show(2)).toBe(kept);
    expect(nameIn(kept)).toBe('Row 4');
  });

  it('builds the item again when its reuse-identifier changes', async () => {
    const { set } = await render({ rows: rowsOf(2) });
    const sign = show(0)!;

    await set({
      attributes: (row) => ({
        'reuse-identifier': row.id === 1 ? 'big' : 'small',
      }),
    });

    // A new type is a new item to native, and gets a view of its type.
    expect(theList().updates.at(-1)!.removeAction).toEqual([0, 1]);
    expect(show(0)).not.toBe(sign);
    hide(sign);
    expect(show(1)).not.toBe(sign);
  });

  it('keys items by identity without trackBy, and makes repeated keys unique', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shared = { id: 7, name: 'Twice' };
    const { set } = await render({
      trackBy: undefined,
      rows: [shared, shared, shared, { id: 8, name: 'Other' }],
    });

    const keys = [...theList().keys];
    expect(new Set(keys).size).toBe(4);
    expect(keys[1]).toBe(`${keys[0]}~1`);
    expect(keys[2]).toBe(`${keys[0]}~2`);
    expect(warn).toHaveBeenCalledOnce();

    // The same object keeps its key.
    await set({ rows: [shared, { id: 9, name: 'New' }] });
    expect(theList().keys[0]).toBe(keys[0]);
  });

  it('keys by what trackBy gives, an object by its identity', async () => {
    const tag = { tag: true };
    await render({
      trackBy: (index) => (index === 0 ? tag : `k${index}`),
      rows: rowsOf(2),
    });

    expect(theList().keys[0]).toMatch(/^@\d+$/);
    expect(theList().keys[1]).toBe('k1');
  });

  it('takes any iterable, and nothing', async () => {
    const { set } = await render({ rows: new Set(rowsOf(2)) });
    expect(theList().keys).toEqual(['1', '2']);

    await set({ rows: null });
    expect(theList().keys).toEqual([]);
  });

  it('gives native nothing for an index it no longer has', async () => {
    await render({ rows: rowsOf(1) });

    expect(show(5)).toBeUndefined();
  });

  it('builds items through the batch callback too', async () => {
    await render();
    flushes.length = 0;

    theList().componentAtIndexes(
      theList(),
      theList().id,
      [0, 1, 500],
      [11, 12, 13],
      false,
      false,
    );

    expect(built()).toBe(2);
    const signs = created
      .filter((el) => el.tag === 'list-item')
      .map((el) => el.id);
    expect(flushes).toEqual([
      {
        element: theList(),
        options: {
          triggerLayout: true,
          operationIDs: [11, 12, 13],
          // Paired with the operation ids by position, -1 for no item.
          elementIDs: [...signs, -1],
          listID: theList().id,
        },
      },
    ]);
  });

  it('flushes each item itself when the batch is asynchronous, with the reuse notification', async () => {
    await render();
    const sign = show(0)!;
    hide(sign);
    flushes.length = 0;

    theList().componentAtIndexes(
      theList(),
      theList().id,
      [1, 2, 500],
      [1, 2, 3],
      true,
      true,
    );

    expect(flushes.map((flush) => flush.options)).toEqual([
      {
        asyncFlush: true,
        listReuseNotification: { listElement: theList(), itemKey: '2' },
      },
      { asyncFlush: true },
    ]);
  });

  it('goes with its view, and gives native nothing after', async () => {
    @Component({
      selector: 'toggle-host',
      imports: [LynxListFor],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `
        <list>
          <list-item item-key="header"><text>Header</text></list-item>
          @if (show()) {
            <list-item *lynxListFor="let row of rows">
              <text class="name">{{ row.name }}</text>
            </list-item>
          }
        </list>
      `,
    })
    class ToggleHost {
      readonly show = signal(true);
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(ToggleHost);
    fixture.detectChanges();
    setInputs(directives.at(-1)!, { rows: rowsOf(3) });
    await update(fixture);
    expect(theList().keys).toHaveLength(4);
    expect(theList().keys[0]).toBe('header');
    const sign = show(1)!;
    expect(nameIn(sign)).toBe('Row 1');

    fixture.componentInstance.show.set(false);
    await update(fixture);

    expect(theList().keys).toEqual(['header']);
    expect(show(1)).toBeUndefined();
    hide(sign);
  });

  it('schedules no flush when it reuses a view', async () => {
    await render();
    vi.useFakeTimers();
    try {
      // A new view's insert schedules a tick, as any attached view does.
      hide(show(0)!);
      await vi.runAllTimersAsync();
      flushes.length = 0;

      show(1);
      await vi.runAllTimersAsync();

      // Only the item's own flush: no tick, and no settle flush after it.
      expect(flushes).toHaveLength(1);
      expect(flushes[0]!.options.operationID).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a view in the pool up to date with its item', async () => {
    const { fixture, set } = await render();
    const sign = show(5)!;
    hide(sign);

    await set({ rows: [{ id: 0, name: 'Row 0' }, ...rowsOf(100)] });
    fixture.componentInstance.suffix.set('?');
    await update(fixture);

    expect(metaIn(sign)).toMatch(/^6\/101\s+even$/);
    expect(nameIn(sign)).toBe('Row 6?');
  });

  it('does nothing when the items are the same', async () => {
    const { fixture } = await render();
    const sent = theList().updates.length;

    await update(fixture);

    expect(theList().updates).toHaveLength(sent);
  });

  it('shows an item’s new value when native asks for it back from the pool', async () => {
    const { set } = await render();
    const sign = show(0)!;
    hide(sign);

    await set({
      rows: rowsOf(100).map((row) => ({ ...row, name: `${row.name}?` })),
    });

    expect(show(0)).toBe(sign);
    expect(nameIn(sign)).toBe('Row 1?');
  });

  it('types its context for the template', () => {
    expect(LynxListFor.ngTemplateContextGuard(directives[0] as never, {})).toBe(
      true,
    );
  });

  it('builds a static item beside it as before', async () => {
    @Component({
      selector: 'mixed-host',
      imports: [LynxListFor],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `
        <list>
          <list-item item-key="header"
            ><text class="name">Header</text></list-item
          >
          <list-item *lynxListFor="let row of rows">
            <text class="name">{{ row.name }}</text>
          </list-item>
        </list>
      `,
    })
    class MixedHost {
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(MixedHost);
    fixture.detectChanges();
    setInputs(directives.at(-1)!, { rows: rowsOf(2) });
    await update(fixture);

    const header = show(0)!;
    flushes.length = 0;
    theList().componentAtIndexes(
      theList(),
      theList().id,
      [0],
      [1],
      false,
      false,
    );

    expect(flushes).toHaveLength(1);
    expect(nameIn(header)).toBe('Header');
    expect(nameIn(show(2)!)).toBe('Row 2');
    // An element child stays as it is when native lets it go.
    hide(header);
    expect(show(0)).toBe(header);
  });

  it('works in content a component projects into its <list>, as ui-list does', async () => {
    @Component({
      selector: 'projecting-list',
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `<view
        ><list><ng-content /></list
      ></view>`,
    })
    class ProjectingList {}
    @Component({
      selector: 'projected-host',
      imports: [LynxListFor, ProjectingList],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `
        <projecting-list>
          <list-item *lynxListFor="let row of rows">
            <text class="name">{{ row.name }}</text>
          </list-item>
        </projecting-list>
      `,
    })
    class ProjectedHost {
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(ProjectedHost);
    fixture.detectChanges();
    setInputs(directives.at(-1)!, { rows: rowsOf(3) });
    await update(fixture);

    expect(theList().keys).toHaveLength(3);
    expect(nameIn(show(2)!)).toBe('Row 3');
  });

  it('gives native nothing for an item whose directive is gone', async () => {
    await render();
    directives[0]!.ngOnDestroy();

    // Native asks before the list's update tells it the items are gone.
    expect(show(0)).toBeUndefined();
  });

  it('tells every list a cycle changed about its items with the cycle’s one flush', async () => {
    @Component({
      selector: 'two-lists-host',
      imports: [LynxListFor],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `
        <list>
          <list-item *lynxListFor="let row of rows">
            <text class="name">{{ row.name }}</text>
          </list-item>
        </list>
        <list>
          @for (row of more(); track row.id) {
            <list-item
              ><text class="name">{{ row.name }}</text></list-item
            >
          }
        </list>
      `,
    })
    class TwoListsHost {
      readonly rows = [];
      readonly more = signal<Row[]>([]);
    }
    const fixture = TestBed.createComponent(TwoListsHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const order: string[] = [];
    const g = globalThis as unknown as Record<string, any>;
    const setAttribute = g.__SetAttribute;
    g.__SetAttribute = (n: FakeEl, name: string, value: unknown) => {
      if (name === 'update-list-info')
        order.push(`list ${lists.indexOf(n as FakeList)}`);
      setAttribute(n, name, value);
    };
    const flush = g.__FlushElementTree;
    g.__FlushElementTree = (element?: FakeEl, options?: any) => {
      if (!element)
        order.push(options?.triggerLayout ? 'flush with layout' : 'flush');
      flush(element, options);
    };

    setInputs(directives.at(-1)!, { rows: rowsOf(3) });
    fixture.componentInstance.more.set(rowsOf(2, 11));
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();

    // Each list used to flush on its own after the cycle's flush.
    expect(order).toEqual(['list 0', 'list 1', 'flush with layout']);
    await fixture.whenStable();
    // Native asks for each list's items in that flush.
    expect(lists[0]!.keys).toHaveLength(3);
    expect(nameIn(show(2)!)).toBe('Row 3');
    const second = lists[1]!;
    expect(second.keys).toHaveLength(2);
    expect(
      nameIn(second.componentAtIndex(second, second.id, 1, operationId++)!),
    ).toBe('Row 12');
  });

  it('updates a list inside an item with the item’s own flush', async () => {
    @Component({
      selector: 'nested-host',
      imports: [LynxListFor],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `
        <list>
          <list-item *lynxListFor="let row of rows">
            <list>
              @for (n of [1, 2, 3]; track n) {
                <list-item
                  ><text>{{ row.name }} {{ n }}</text></list-item
                >
              }
            </list>
          </list-item>
        </list>
      `,
    })
    class NestedHost {
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(NestedHost);
    fixture.detectChanges();
    setInputs(directives.at(-1)!, { rows: rowsOf(2) });
    await update(fixture);
    flushes.length = 0;

    show(0);

    // The inner list heard about its items, and nothing flushed but the
    // item: a root flush would re-enter native's layout pass.
    expect(lists[1]!.keys).toHaveLength(3);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]!.options.operationID).toBeDefined();
  });

  it('flushes again on a task of its own when a call made while building waits for a flush', async () => {
    const waited = vi.fn();
    @Directive({ selector: '[waitsForFlush]' })
    class WaitsForFlush {
      constructor() {
        afterNextFlush(waited);
      }
    }
    @Component({
      selector: 'waiting-host',
      imports: [LynxListFor, WaitsForFlush],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      encapsulation: ViewEncapsulation.None,
      template: `
        <list>
          <list-item *lynxListFor="let row of rows">
            <view waitsForFlush></view>
          </list-item>
        </list>
      `,
    })
    class WaitingHost {
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(WaitingHost);
    fixture.detectChanges();
    setInputs(directives.at(-1)!, { rows: rowsOf(1) });
    await update(fixture);

    vi.useFakeTimers();
    try {
      show(0);
      // Not inside componentAtIndex: the settle flush waits for a task.
      expect(waited).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(waited).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when it is not in a <list>', () => {
    @Component({
      selector: 'outside-host',
      imports: [LynxListFor],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      template: `<view
        ><list-item *lynxListFor="let row of rows"></list-item
      ></view>`,
    })
    class OutsideHost {
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(OutsideHost);

    expect(() => fixture.detectChanges()).toThrow(/directly inside a <list>/);
  });

  it('throws when it is not on a <list-item>', async () => {
    @Component({
      selector: 'view-host',
      imports: [LynxListFor],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      template: `<list><view *lynxListFor="let row of rows"></view></list>`,
    })
    class ViewHost {
      readonly rows = [];
    }
    const fixture = TestBed.createComponent(ViewHost);
    fixture.detectChanges();
    setInputs(directives.at(-1)!, { rows: rowsOf(1) });
    await update(fixture);

    expect(() => show(0)).toThrow(/goes on a <list-item>/);
  });
});

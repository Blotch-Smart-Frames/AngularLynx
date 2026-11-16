import type {
  EmbeddedViewRef,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import type { LynxElement } from '../lynx-element';
import {
  attributesDiffer,
  type ListItemRun,
  type LynxListItemSource,
} from '../lynx-element/lynx-list-element';
import type { ElementRef } from '../types/lynx';
import { LynxListForContext } from './list-for-context';

/**
 * One view `*lynxListFor` built: one `<list-item>` element, which native
 * shows as one item after another.
 */
type ItemView<T> = {
  readonly ref: EmbeddedViewRef<LynxListForContext<T>>;
  /** Its `<list-item>`. */
  readonly root: LynxElement;
  /** The element's unique id: native's name for it in the list callbacks. */
  readonly sign: number;
  /** Its reuse type: it only shows items of this type. */
  readonly type: string;
  /**
   * The key of the item it shows, or of the item it showed last while it's
   * in the pool, so that item gets it back as it was if native asks for it
   * before the view goes to another. Null once nothing claims it: its item
   * is gone, or native asked for its item again and it got another view.
   */
  key: string | null;
  /**
   * Native let go of its element (enqueueComponent). It's in its type's
   * pool then, unless its item keeps it (see #pool).
   */
  pooled: boolean;
  /** Out of change detection, while no item claims it (see #unclaim). */
  detached: boolean;
};

const EMPTY_RUN: ListItemRun = { keys: [], types: [], attributes: [] };

/**
 * Whether two runs tell native the same: the same keys and types in the same
 * order, with the same layout attributes.
 */
const sameRun = (a: ListItemRun, b: ListItemRun): boolean => {
  if (a.keys.length !== b.keys.length) return false;
  for (let i = 0; i < a.keys.length; i++) {
    if (
      a.keys[i] !== b.keys[i] ||
      a.types[i] !== b.types[i] ||
      attributesDiffer(a.attributes[i], b.attributes[i])
    ) {
      return false;
    }
  }
  return true;
};

let nextRunId = 1;

/**
 * The views of a `*lynxListFor` run, which native asks for one item at a
 * time (see LynxListElement.attachItemSource): the directive's half of the
 * list protocol, apart from Angular's lifecycle so it reads as React Lynx's
 * does (snapshot/list/list.ts) and can be tested on its own.
 *
 * A view is built the first time native asks for an item and no view of
 * its type is free. When native lets go of an element (enqueueComponent),
 * its view goes to its type's pool, still claimed by its item; the next item
 * native asks for takes the oldest view in the pool, as React Lynx's
 * recycle map does, and the view shows that item instead (its context
 * changes, and it's checked). So a list builds about as many views as fit on
 * screen, plus `preload-buffer-count`, however many items it has.
 *
 * Every view stays in the directive's view container, which is what destroys
 * them with it. A view whose item still exists stays attached to change
 * detection, in the pool too, and is kept up to date with its item (its
 * index moves as items go in above it), so it costs a check with its parent:
 * the pool holds a handful. Detaching it instead (`ChangeDetectorRef.detach()`)
 * would mean `reattach()` when native asks for an item, and every attach
 * schedules an application tick, whose `__FlushElementTree()` would follow
 * every item native asks for while the list scrolls. Only a view whose item is
 * gone is detached: checking it on an item the app no longer has could
 * throw (`rows()[i]` past the end). Reusing it reattaches it, which a removal
 * or a move pays for once, and so does a new view's insert, while the list
 * fills the screen.
 */
export class ListItemViews<T> implements LynxListItemSource {
  readonly id = nextRunId++;

  readonly #template: TemplateRef<LynxListForContext<T>>;
  readonly #viewContainer: ViewContainerRef;
  /** The items and their run, as the directive last set them. */
  #items: readonly T[] = [];
  #run: ListItemRun = EMPTY_RUN;
  /**
   * The same, as the list last told native about them (see commit), or as
   * setItems() took them when they held nothing new for native.
   */
  #committedItems: readonly T[] = [];
  #committedRun: ListItemRun = EMPTY_RUN;
  /**
   * The view of each item that has one, by key, and each view by its
   * element's unique id. Strings and numbers, never elements: these are read
   * inside componentAtIndex, where keying a Map on an element crashed (see
   * create-list-element.ts).
   */
  readonly #byKey = new Map<string, ItemView<T>>();
  readonly #bySign = new Map<number, ItemView<T>>();
  /** The views native let go of, by type, oldest first. */
  readonly #pools = new Map<string, Map<number, ItemView<T>>>();
  /** Each item's index in #run, by key, for enqueue() to find its item. */
  #indexOfKey = new Map<string, number>();
  #destroyed = false;

  constructor(
    template: TemplateRef<LynxListForContext<T>>,
    viewContainer: ViewContainerRef,
  ) {
    this.#template = template;
    this.#viewContainer = viewContainer;
  }

  /**
   * Takes the items as they are now (the directive's ngDoCheck). A view is
   * given its item's new value and index, for the change detection running
   * now to show; a view whose item is gone, or changed type, is let go of,
   * and keeps showing it until native lets go of its element.
   *
   * Returns whether the list has news for native. It has none when every
   * item kept its key, type and layout attributes, and native was told
   * about the run before this: an edit to what the items show, such as a
   * signal's `update()` that replaces one row with a copy, or a refetch of
   * the same rows. Its views show it now, and the items count as committed
   * at once, as the list update would have committed them, so the list
   * doesn't collect and diff every item to find nothing to send.
   */
  setItems(items: readonly T[], run: ListItemRun): boolean {
    // Asked before #run moves: a run the list hasn't committed yet (while
    // the first render defers list updates) still has to reach native.
    const told =
      this.#run === this.#committedRun && sameRun(run, this.#committedRun);
    this.#items = items;
    this.#run = run;
    // The same keys at the same indices keep the same map.
    if (!told) {
      const indexOfKey = new Map<string, number>();
      for (let i = 0; i < run.keys.length; i++) {
        indexOfKey.set(run.keys[i]!, i);
      }
      this.#indexOfKey = indexOfKey;
    }
    for (const [key, view] of this.#byKey) {
      const index = this.#indexOfKey.get(key);
      if (index === undefined || run.types[index] !== view.type) {
        this.#unclaim(key, view);
        continue;
      }
      this.#show(view, index, items);
    }
    if (!told) return true;
    // What commit() does: bind() shows native's items from these.
    this.#committedItems = items;
    this.#committedRun = run;
    return false;
  }

  commit(): ListItemRun {
    this.#committedItems = this.#items;
    this.#committedRun = this.#run;
    return this.#run;
  }

  bind(index: number): { element: ElementRef; reused: boolean } | null {
    if (this.#destroyed) return null;
    // The list commits this run and its own items together (see
    // LynxListElement._processUpdate), so its index is always in the run.
    const key = this.#committedRun.keys[index]!;
    const type = this.#committedRun.types[index]!;
    let view = this.#byKey.get(key);
    let reused = false;
    if (view && !view.pooled) {
      // Native asks for an item whose element it still holds, without
      // letting it go first: the item moved, or native binds its cell anew,
      // and either may come before the enqueueComponent of the element. The
      // item gets another view, and the old one goes to the pool when native
      // lets go of it, as React Lynx gives the item another element
      // (`takeElements`): one element in two cells would show one of them
      // empty, then go to the pool while the other still shows it.
      this.#unclaim(key, view);
      view = undefined;
    }
    if (view) {
      // Native let go of it and wants the same item back: it's as it was.
      this.#pools.get(view.type)?.delete(view.sign);
    } else {
      view = this.#takeFromPool(type);
      if (view) {
        reused = true;
      } else {
        view = this.#create(type);
      }
      view.key = key;
      this.#byKey.set(key, view);
    }
    view.pooled = false;
    this.#show(view, index, this.#committedItems);
    // Checked now, while componentAtIndex waits: its flush right after is
    // what native shows. Then back in change detection if it was out, which
    // asks nothing of its ancestors now that it's checked.
    view.ref.detectChanges();
    if (view.detached) {
      view.detached = false;
      view.ref.reattach();
    }
    return { element: view.root.element, reused };
  }

  enqueue(sign: number): boolean {
    const view = this.#bySign.get(sign);
    if (!view) return false;
    if (view.pooled) return true;
    view.pooled = true;
    // An item with `recyclable: false` keeps its view for when native asks
    // for it again, whatever native does with the attribute: Lynx's own
    // list honors it, and the platform lists on iOS and Android don't. Its
    // view goes to the pool if the item goes (see #unclaim).
    const index =
      view.key === null ? undefined : this.#indexOfKey.get(view.key);
    if (
      index === undefined ||
      this.#run.attributes[index]?.recyclable !== false
    ) {
      this.#pool(view);
    }
    return true;
  }

  /**
   * Forgets every view (the directive's ngOnDestroy). Its view container
   * destroys them; bind() gives nothing after this, for a componentAtIndex
   * native sends before it hears the items are gone.
   */
  destroy(): void {
    this.#destroyed = true;
    this.#byKey.clear();
    this.#bySign.clear();
    this.#pools.clear();
  }

  /**
   * Sets what `view` shows: item `index` of `items`.
   */
  #show(view: ItemView<T>, index: number, items: readonly T[]): void {
    const context = view.ref.context;
    context.$implicit = items[index]!;
    context.lynxListForOf = items;
    context.index = index;
    context.count = items.length;
  }

  /**
   * `view` no longer shows its item: the item is gone, changed type, or got
   * another view. It leaves change detection until it's reused. A view on
   * screen goes to the pool when native lets go of its element; one native
   * let go of already goes now, for any item.
   */
  #unclaim(key: string, view: ItemView<T>): void {
    this.#byKey.delete(key);
    view.key = null;
    view.detached = true;
    view.ref.detach();
    // One native let go of, which its item kept out of the pool.
    if (view.pooled) this.#pool(view);
  }

  /**
   * Puts `view` in its type's pool, for any item native asks for next.
   */
  #pool(view: ItemView<T>): void {
    let pool = this.#pools.get(view.type);
    if (!pool) {
      pool = new Map();
      this.#pools.set(view.type, pool);
    }
    pool.set(view.sign, view);
  }

  /**
   * The oldest view of `type` native let go of, out of its pool.
   */
  #takeFromPool(type: string): ItemView<T> | undefined {
    const pool = this.#pools.get(type);
    const first = pool?.entries().next();
    if (!pool || !first || first.done) return undefined;
    const [sign, view] = first.value;
    pool.delete(sign);
    // Its last item, if it still has one, has no view now: native asks for
    // it again, and it gets one then.
    if (view.key !== null) this.#byKey.delete(view.key);
    return view;
  }

  /**
   * Builds a view of `type`. It goes in the view container, whose insert
   * reaches the list as an `appendChild` the list skips (see
   * LynxListElement.appendChild): componentAtIndex appends the element to the
   * native list itself.
   */
  #create(type: string): ItemView<T> {
    const ref = this.#template.createEmbeddedView(
      new LynxListForContext<T>(undefined as T, this.#committedItems, -1, 0),
    );
    const roots = ref.rootNodes as LynxElement[];
    const root = roots[0];
    if (roots.length !== 1 || root?.tagName !== 'list-item') {
      ref.destroy();
      throw new Error(
        '*lynxListFor goes on a <list-item>: each item of a <list> is one ' +
          '<list-item>, which the native list asks for by itself.',
      );
    }
    root._ownedByListSource = true;
    this.#viewContainer.insert(ref);
    const view: ItemView<T> = {
      ref,
      root,
      sign: __GetElementUniqueID(root.element),
      type,
      key: null,
      pooled: false,
      detached: false,
    };
    this.#bySign.set(view.sign, view);
    return view;
  }
}

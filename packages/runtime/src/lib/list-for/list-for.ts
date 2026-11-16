import {
  Directive,
  type DoCheck,
  inject,
  input,
  type OnDestroy,
  TemplateRef,
  type TrackByFunction,
  ViewContainerRef,
} from '@angular/core';
import { type LynxElement, LynxListElement } from '../lynx-element';
import type {
  ListItemAttributes,
  ListItemRun,
} from '../lynx-element/lynx-list-element';
import type { LynxListForContext } from './list-for-context';
import { ListItemViews } from './list-item-views';

/**
 * What the native list reads for an item before the item exists, which
 * `*lynxListFor`'s `itemAttributes` gives from the item's data: the
 * `<list-item>` attributes of the same names (see LynxListItem). A
 * `reuse-identifier` also sorts the views: an item only reuses a view of an
 * item with the same one.
 */
export type LynxListItemAttributes = ListItemAttributes;

/**
 * What `*lynxListFor` takes as items: an array, any other iterable, or
 * nothing yet.
 */
export type LynxListForOf<T> = readonly T[] | Iterable<T> | null | undefined;

/**
 * Each object's key when there's no `trackBy`, or `trackBy` gives an
 * object: its own number, as Angular tracks an object by identity. Weakly
 * held, so an item that's gone doesn't stay for its key.
 */
const objectKeys = new WeakMap<object, string>();
let nextObjectKey = 1;

const keyOf = (value: unknown): string => {
  if (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  ) {
    let key = objectKeys.get(value);
    if (key === undefined) {
      key = `@${nextObjectKey++}`;
      objectKeys.set(value, key);
    }
    return key;
  }
  return String(value);
};

/**
 * Repeats a `<list-item>` for each item, building an item's view only when
 * the native `<list>` asks for it, and reusing the views of items scrolled
 * away for the items scrolled to. A list of 10,000 items builds about as many
 * views as fit on its screen, as FlashList does in React Native and React
 * Lynx's `<list>` does: `@for` builds every item's view up front, and keeps
 * them all.
 *
 * It's the shape of the CDK's `*cdkVirtualFor`, with the list rather than a
 * viewport deciding what's on screen: native asks for an item by index
 * (componentAtIndex), and the directive builds the item's view, or takes one
 * whose element native let go of (enqueueComponent) and shows the item in it.
 *
 * The native list needs each item's `item-key` and layout before the item has
 * a view, so they come from the data, not from the `<list-item>`'s own
 * attributes: `trackBy` gives the key (as a string), and `itemAttributes`
 * the rest. Bindings of those attributes on the `<list-item>` itself aren't
 * read until it's built.
 *
 * A reused view keeps everything that isn't bound to the item: a component's
 * own state, a field's text and focus, a scroll position. Derive what an item
 * shows from its item (`input()`s, `computed()`, a `linkedSignal()` keyed on
 * the item), and keep what the user changed in the parent, by key.
 *
 * It goes on the `<list-item>` itself, directly in a `<list>` (or in content
 * a component projects into one, as `ui-list` does). Static `<list-item>`s and
 * `@for` items can sit beside it in the same list.
 *
 * In the web preview, Lynx for Web's `<list>` asks for every item at once
 * and never lets one go, so there every item gets a view.
 *
 * @usageNotes
 * ```html
 * <list list-type="single" style="height: 100%;">
 *   <list-item
 *     *lynxListFor="let contact of contacts(); trackBy: byId; let i = index"
 *   >
 *     <text>{{ i + 1 }}. {{ contact.name }}</text>
 *   </list-item>
 * </list>
 * ```
 * ```ts
 * readonly byId = (_: number, contact: Contact) => contact.id;
 * ```
 */
@Directive({ selector: '[lynxListFor][lynxListForOf]' })
export class LynxListFor<T> implements DoCheck, OnDestroy {
  /** The items. */
  readonly lynxListForOf = input<LynxListForOf<T>>();
  /**
   * Each item's key, which native uses as its `item-key`: unique and stable
   * for the item, such as its id. Without it an item is its own key, by
   * identity, as Angular tracks it: new objects for the same data are new
   * items, built again.
   */
  readonly lynxListForTrackBy = input<TrackByFunction<T>>();
  /**
   * Each item's layout attributes: `estimated-main-axis-size-px`,
   * `full-span`, `sticky-top`, `sticky-bottom`, `recyclable` and
   * `reuse-identifier`. Items with different layouts should have different
   * `reuse-identifier`s, so one reuses another's view only when it looks the
   * same.
   */
  readonly lynxListForItemAttributes =
    input<(item: T, index: number) => LynxListItemAttributes | undefined>();

  readonly #anchor: LynxElement =
    inject(ViewContainerRef).element.nativeElement;
  readonly #views = new ListItemViews<T>(
    inject<TemplateRef<LynxListForContext<T>>>(TemplateRef),
    inject(ViewContainerRef),
  );
  /** The list it's in, once its anchor is (see #attach). */
  #list: LynxListElement | null = null;
  /** The items, keys and attribute function as last set, to tell a change. */
  #items: readonly T[] = [];
  #trackBy: TrackByFunction<T> | undefined;
  #attributesOf:
    | ((item: T, index: number) => LynxListItemAttributes | undefined)
    | undefined;
  #warnedDuplicates = false;

  /**
   * Types `let item` and the rest of the context in the template.
   */
  static ngTemplateContextGuard<T>(
    _directive: LynxListFor<T>,
    _context: unknown,
  ): _context is LynxListForContext<T> {
    return true;
  }

  /**
   * Compares the items with the last ones each check, as `NgForOf` does, so
   * an array changed in place (`push()`) shows too. A comparison per item:
   * cheap next to building views, which happens only for what's on screen.
   */
  ngDoCheck(): void {
    this.#attach();
    const data = this.lynxListForOf();
    const items: readonly T[] = data
      ? Array.isArray(data)
        ? (data as readonly T[])
        : Array.from(data as Iterable<T>)
      : [];
    const trackBy = this.lynxListForTrackBy();
    const attributesOf = this.lynxListForItemAttributes();
    if (
      trackBy === this.#trackBy &&
      attributesOf === this.#attributesOf &&
      sameItems(items, this.#items)
    ) {
      return;
    }
    // A copy: the array may be the app's own, changed in place next time.
    this.#items = items.slice();
    this.#trackBy = trackBy;
    this.#attributesOf = attributesOf;
    // Only when native has something to hear: an edit to what the items
    // show reaches their views here, and changes nothing native knows.
    if (this.#views.setItems(this.#items, this.#run(this.#items))) {
      this.#list?.itemSourceChanged();
    }
  }

  ngOnDestroy(): void {
    this.#list?.detachItemSource(this.#views);
    this.#list = null;
    this.#views.destroy();
  }

  /**
   * Puts the items in the list the anchor is in, when it's in one: on the
   * first check, after the template (or the component projecting it) has
   * put the anchor in place, and again if it moves.
   */
  #attach(): void {
    const parent = this.#anchor.parentNode();
    if (parent === this.#list || !parent) return;
    if (!(parent instanceof LynxListElement)) {
      throw new Error(
        '*lynxListFor must be on a <list-item> directly inside a <list>.',
      );
    }
    this.#list?.detachItemSource(this.#views);
    this.#list = parent;
    parent.attachItemSource(this.#anchor, this.#views);
  }

  /**
   * Each item's key, reuse type and layout attributes. A key repeated is
   * made unique (Lynx's list fails on a duplicate `item-key`), and said once.
   */
  #run(items: readonly T[]): ListItemRun {
    const trackBy = this.#trackBy;
    const attributesOf = this.#attributesOf;
    const keys: string[] = [];
    const types: string[] = [];
    const attributes: Array<ListItemAttributes | undefined> = [];
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      let key = keyOf(trackBy ? trackBy(i, item) : item);
      if (seen.has(key)) {
        this.#warnDuplicate(key);
        let copy = 1;
        while (seen.has(`${key}~${copy}`)) copy++;
        key = `${key}~${copy}`;
      }
      seen.add(key);
      keys.push(key);
      const itemAttributes = attributesOf?.(item, i);
      attributes.push(itemAttributes);
      types.push(itemAttributes?.['reuse-identifier'] ?? 'list-item');
    }
    return { keys, types, attributes };
  }

  #warnDuplicate(key: string): void {
    if (this.#warnedDuplicates) return;
    this.#warnedDuplicates = true;
    console.warn(
      `*lynxListFor: more than one item has the key "${key}". Each item ` +
        'needs its own key (trackBy), or the list rebuilds the wrong ones.',
    );
  }
}

/**
 * Whether two item arrays hold the same items in the same order.
 */
const sameItems = <T>(a: readonly T[], b: readonly T[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

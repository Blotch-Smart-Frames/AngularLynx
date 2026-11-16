import { bindListItem } from '../lynx-render-lifecycle';
import type { ElementRef, ListElementRef } from '../types/lynx';
import { cancelListUpdate, scheduleListUpdate } from './list-updates';
import { LynxElement } from './lynx-element';

/**
 * Manages list children in a virtual tree instead of the native element tree.
 *
 * Lynx's native list is a virtualized list driven by engine callbacks
 * (componentAtIndex / enqueueComponent). Children must NOT be appended via
 * __AppendElement at render time — the list calls componentAtIndex to request
 * items by index on demand, and update-list-info tells it which indices exist.
 *
 * Angular's rendering model appends children directly, so this class intercepts
 * appendChild/insertBefore and stores children in a JS-level linked list.
 * The actual __AppendElement call happens lazily inside componentAtIndex
 * (create-list-element.ts) when the native engine requests the item.
 *
 * A list holds two kinds of items. A `<list-item>` child (a static one, or
 * one `@for` builds) exists before native asks for it, and is in the linked
 * list. A `*lynxListFor` run of items (see LynxListElement.attachItemSource)
 * exists only as data until native asks for an item: the run sits where its
 * anchor comment sits in the linked list, and its directive builds an item,
 * or rebinds one native has let go of, when componentAtIndex asks.
 */

/**
 * @internal The attributes Lynx's list reads for each item from
 * update-list-info, before it asks for the item: `*lynxListFor` gives them
 * for each item from data (its `itemAttributes`), since the item's own
 * `<list-item>` doesn't exist yet. The names are Lynx's.
 */
export type ListItemAttributes = {
  /** Only items with the same value share views. */
  'reuse-identifier'?: string;
  /** Expected size in px along the scroll direction until the item renders. */
  'estimated-main-axis-size-px'?: number;
  /** Takes a whole row (or column) in a `flow` or `waterfall` list. */
  'full-span'?: boolean;
  /** Pins to the top while it scrolls. Needs `sticky` on the list. */
  'sticky-top'?: boolean;
  /** Pins to the bottom. Needs `sticky` on the list. */
  'sticky-bottom'?: boolean;
  /** `false` keeps the item's view alive off screen, never reused. */
  recyclable?: boolean;
};

/**
 * @internal A `*lynxListFor` run's items as the list tells native about them
 * (see LynxListItemSource.commit). Parallel arrays, by item.
 */
export type ListItemRun = {
  /** Each item's `item-key`. Unique in the run. */
  readonly keys: readonly string[];
  /** Each item's reuse type: native's `type`, and the pool its view goes to. */
  readonly types: readonly string[];
  /** Each item's layout attributes, if it has any. */
  readonly attributes: readonly (ListItemAttributes | undefined)[];
};

/**
 * @internal A run of a list's items that exist as data until native asks for
 * one: `*lynxListFor`'s (see LynxListFor). Its anchor comment marks where the
 * run sits among the list's children (see LynxListElement.attachItemSource).
 */
export type LynxListItemSource = {
  /** Tells this run's items apart from another run's in the list's diff. */
  readonly id: number;
  /**
   * The run's items as they are now, which the list is about to tell native
   * about. `bind()` takes an index into the last run returned.
   */
  commit(): ListItemRun;
  /**
   * Builds the item at `index` of the last commit, or reuses a view native
   * let go of, checks it, and returns its `<list-item>`: `reused` when the
   * element showed another item before. Null when the run can't (it's gone).
   */
  bind(index: number): { element: ElementRef; reused: boolean } | null;
  /**
   * Native let go of the item element with this unique id (enqueueComponent):
   * true if it was one of this run's, which can now reuse it.
   */
  enqueue(sign: number): boolean;
};

/**
 * One item as the list last told native about it: an element child of the
 * list, or an item of a `*lynxListFor` run.
 */
export type ListSlot = {
  /**
   * The item's identity from one update to the next: `#<unique id>` for an
   * element, `<run id>|<type>|<key>` for a run's item (a new type is a new
   * item, which native asks for again, and gets a view of that type).
   */
  readonly id: string;
  /** The element, for an element child. */
  readonly ref: ElementRef | null;
  /** The run, for a run's item. */
  readonly source: LynxListItemSource | null;
  /** The item's index in its run's commit, for a run's item. */
  readonly index: number;
  /** The `item-key`, for a run's item (an element's is read when it's inserted). */
  readonly key: string;
  /** The reuse type, for a run's item. */
  readonly type: string;
  /** The layout attributes, for a run's item. */
  readonly attributes: ListItemAttributes | undefined;
};

/**
 * An element child's slot id, kept on its native ref as `__appended` is
 * (see isAppendedToNativeList): a plain property, which Lepus reads as a
 * field rather than through a Map/Set.
 */
type ListIdOnRef = { __angularLynxListId?: string };

/** An insertAction entry: the position, then what native reads for the item. */
type InsertAction = {
  position: number;
  type: string;
  'item-key': string;
} & ListItemAttributes;

/** An updateAction entry: an item native keeps, with new layout attributes. */
type UpdateAction = InsertAction & {
  from: number;
  to: number;
  flush: boolean;
};

/**
 * The positions in `sequence` that form a longest increasing run of its
 * values, as a boolean per position. `_processUpdate()` keeps the items whose
 * old indices form it where they are and moves the rest, the fewest moves
 * that reorder the list. O(n log n), patience sorting.
 */
const longestIncreasing = (sequence: readonly number[]): boolean[] => {
  const inRun = Array.from({ length: sequence.length }, () => false);
  // tails[k]: the position ending the smallest-valued increasing run of
  // length k + 1 so far; previous[i]: the position before i in its run.
  const tails: number[] = [];
  const previous = Array.from({ length: sequence.length }, () => -1);
  for (let i = 0; i < sequence.length; i++) {
    const value = sequence[i]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[i] = tails[low - 1]!;
    tails[low] = i;
  }
  for (
    let i = tails.length > 0 ? tails[tails.length - 1]! : -1;
    i >= 0;
    i = previous[i]!
  ) {
    inRun[i] = true;
  }
  return inRun;
};

/**
 * @internal Whether two items' layout attributes differ (both from
 * `itemAttributes`), as native reads them: `reuse-identifier` is the item's
 * type, which the slot's id holds. `*lynxListFor` asks it too, to tell an
 * update with nothing for native (see ListItemViews.setItems).
 */
export const attributesDiffer = (
  a: ListItemAttributes | undefined,
  b: ListItemAttributes | undefined,
): boolean => {
  if (a === b) return false;
  if (!a || !b) return true;
  return (
    a['estimated-main-axis-size-px'] !== b['estimated-main-axis-size-px'] ||
    a['full-span'] !== b['full-span'] ||
    a['sticky-top'] !== b['sticky-top'] ||
    a['sticky-bottom'] !== b['sticky-bottom'] ||
    a.recyclable !== b.recyclable
  );
};

export class LynxListElement extends LynxElement {
  #firstVirtualChild: LynxElement | null = null;
  #lastVirtualChild: LynxElement | null = null;
  #destroyed = false;
  /**
   * The items as last told to native via update-list-info, so the next
   * update can diff against them, and what componentAtIndex /
   * componentAtIndexes (create-list-element.ts) read through
   * committedSlot(): native's indices are positions in it.
   */
  #committed: ListSlot[] = [];
  /**
   * The `*lynxListFor` runs in this list, each with the anchor comment that
   * marks its place among the children. A small array searched by identity
   * of the anchor's wrapper, rather than a field on every comment.
   */
  #sources: Array<{ anchor: LynxElement; source: LynxListItemSource }> = [];
  #componentAtIndex: ((...args: any[]) => number | undefined) | null = null;
  #enqueueComponent: ((...args: any[]) => void) | null = null;
  #componentAtIndexes: ((...args: any[]) => void) | null = null;

  /**
   * Store the list callbacks so _processUpdate() can re-register them via
   * __UpdateListCallbacks on every update. React Lynx does this on every
   * flush (see listUpdateInfo.ts) — the native engine (unlike the web
   * polyfill) does not invoke componentAtIndex for a fresh update-list-info
   * unless the callbacks are re-registered alongside it. Without this,
   * update-list-info is accepted with no crash but componentAtIndex is
   * silently never called and the list stays blank.
   */
  setCallbacks(
    componentAtIndex: (...args: any[]) => number | undefined,
    enqueueComponent: (...args: any[]) => void,
    componentAtIndexes: (...args: any[]) => void,
  ): void {
    this.#componentAtIndex = componentAtIndex;
    this.#enqueueComponent = enqueueComponent;
    this.#componentAtIndexes = componentAtIndexes;
  }

  override remove(): void {
    this.#destroyed = true;
    cancelListUpdate(this);
    super.remove();
  }

  override appendChild(newChild: LynxElement): void {
    if (newChild.isRootPageElement) return;
    // A `*lynxListFor` item: its run tells native about it (see
    // attachItemSource). Angular inserts it through its view container all
    // the same, which is what keeps the item's view checked and destroyed with
    // the directive; the parent link is all that's kept, for parentNode().
    if (newChild._ownedByListSource) {
      newChild._virtualParent = this;
      return;
    }
    newChild._virtualParent = this;
    newChild._virtualPrev = this.#lastVirtualChild;
    newChild._virtualNext = null;

    if (this.#lastVirtualChild) {
      this.#lastVirtualChild._virtualNext = newChild;
    }
    if (!this.#firstVirtualChild) {
      this.#firstVirtualChild = newChild;
    }
    this.#lastVirtualChild = newChild;

    this.#scheduleUpdate();
  }

  override insertBefore(
    newChild: LynxElement,
    refChild: LynxElement | null,
  ): void {
    if (newChild.isRootPageElement) return;
    if (refChild == null || newChild._ownedByListSource) {
      this.appendChild(newChild);
      return;
    }

    newChild._virtualParent = this;
    newChild._virtualNext = refChild;
    newChild._virtualPrev = refChild._virtualPrev;

    if (refChild._virtualPrev) {
      refChild._virtualPrev._virtualNext = newChild;
    } else {
      this.#firstVirtualChild = newChild;
    }
    refChild._virtualPrev = newChild;

    this.#scheduleUpdate();
  }

  removeVirtualChild(child: LynxElement): void {
    // A `*lynxListFor` item leaves with its view: native keeps the element
    // until it lets go of it (see attachItemSource), and the run's own update
    // tells native the item is gone. Dropping the parent link lets the
    // element be released once Angular destroys it (see LynxElement's
    // #commitPendingReleases).
    if (child._ownedByListSource) {
      child._virtualParent = null;
      return;
    }
    if (child._virtualPrev) {
      child._virtualPrev._virtualNext = child._virtualNext;
    } else {
      this.#firstVirtualChild = child._virtualNext;
    }
    if (child._virtualNext) {
      child._virtualNext._virtualPrev = child._virtualPrev;
    } else {
      this.#lastVirtualChild = child._virtualPrev;
    }

    child._virtualParent = null;
    child._virtualPrev = null;
    child._virtualNext = null;

    // Do NOT call __RemoveElement here. List item removal is managed
    // exclusively through update-list-info's removeAction (sent in
    // _processUpdate). Direct __RemoveElement on list children is invalid —
    // same as direct __AppendElement outside componentAtIndex crashes.
    // Calling both __RemoveElement AND removeAction double-removes and crashes.

    this.#scheduleUpdate();
  }

  /**
   * @internal Puts a `*lynxListFor` run of items in this list, where
   * `anchor` (its view container's comment) sits among the children. Native
   * learns about its items on the next update, and asks for each when it
   * needs it (see create-list-element.ts).
   */
  attachItemSource(anchor: LynxElement, source: LynxListItemSource): void {
    this.#sources.push({ anchor, source });
    this.#scheduleUpdate();
  }

  /**
   * @internal Takes a run out of this list: its items go on the next update.
   */
  detachItemSource(source: LynxListItemSource): void {
    this.#sources = this.#sources.filter((entry) => entry.source !== source);
    this.#scheduleUpdate();
  }

  /**
   * @internal A run's items changed (see LynxListFor): tells native on the
   * next update, in this change detection's end().
   */
  itemSourceChanged(): void {
    this.#scheduleUpdate();
  }

  /**
   * Returns ElementRefs of real UI children, excluding NoneElement comment
   * markers — the invisible <view>s LynxDocument.createComment() creates as
   * Angular's @for/@if insertion anchors, each tagged tagName === 'comment'.
   *
   * Filters on the wrapper's `tagName` (a plain JS string on the LynxElement
   * object), NOT a WeakSet keyed by the native ElementRef. This is the fix for
   * the crash-to-home-screen on every list add/remove. The previous
   * implementation did `#nonElements.has(child.element)`, and hashing a
   * native-backed element ref in a WeakSet/Map/Set on the main-thread Lepus
   * context aborts the process — js_map_has → map_find_record → js_strict_eq2
   * → __JS_FreeValueRT (a QuickJS refcount assertion). _processUpdate() calls
   * this on every list update, so it detonated as soon as items changed.
   * (The initial render happened to survive it — the abort is refcount-timing
   * sensitive — which is why it looked fine until the first mutation.) Reading
   * a string property off the JS wrapper touches no FFI object and no Map/Set,
   * so it can never trip it. See create-list-element.ts's componentAtIndex doc
   * for the general "never key a Set/Map on an element ref" constraint.
   *
   * Only the element children: a `*lynxListFor` run's items aren't elements
   * until native asks for them (see #collectSlots).
   */
  getUIChildren(): ElementRef[] {
    const children: ElementRef[] = [];
    let child = this.#firstVirtualChild;
    while (child) {
      if (child.tagName !== 'comment') {
        children.push(child.element);
      }
      child = child._virtualNext;
    }
    return children;
  }

  /**
   * The items, anchors included: they live in this linked list, not in the
   * `#children` a release walks, and a list in a destroyed view must let
   * them go too (see LynxElement.virtualChildren).
   */
  override virtualChildren(): LynxElement[] {
    const children: LynxElement[] = [];
    for (
      let child = this.#firstVirtualChild;
      child;
      child = child._virtualNext
    ) {
      children.push(child);
    }
    return children;
  }

  /**
   * The item at native's `index`, as of the last update — for
   * componentAtIndex/componentAtIndexes (create-list-element.ts) to read by
   * plain array indexing. Native invokes them synchronously, reentrantly,
   * from deep inside its own list layout pass, and calling ANY WeakSet/Map
   * method keyed on an element ref (even a single `.has()`) from within that
   * call was observed to crash the Lepus QuickJS context with a refcounting
   * assertion inside __JS_FreeValueRT, every time, regardless of how shallow
   * the surrounding call stack is — so the callbacks never walk the children
   * themselves.
   */
  committedSlot(index: number): ListSlot | undefined {
    return this.#committed[index];
  }

  /**
   * @internal Builds or rebinds the `*lynxListFor` item in `slot` for
   * componentAtIndex, inside the binding scope that keeps every other flush
   * out of native's layout pass (see bindListItem).
   */
  bindItem(slot: ListSlot): { element: ElementRef; reused: boolean } | null {
    return bindListItem(() => slot.source!.bind(slot.index));
  }

  /**
   * @internal Native let go of the item element with this unique id
   * (enqueueComponent): the `*lynxListFor` run it belongs to can reuse it.
   * An element child's is kept in place, as it always was.
   */
  enqueue(sign: number): void {
    for (const { source } of this.#sources) {
      if (source.enqueue(sign)) return;
    }
  }

  /**
   * Appended-state is tracked as a plain property directly on the ElementRef
   * rather than a WeakSet, for the same reason as committedSlot(): these are
   * called from componentAtIndex, where WeakSet/Map methods crash. A plain
   * property get/set compiles to ordinary field access, not a call into
   * QuickJS's Map/Set native implementation.
   */
  isAppendedToNativeList(child: ElementRef): boolean {
    return (child as { __appended?: boolean }).__appended === true;
  }

  markAppendedToNativeList(child: ElementRef): void {
    (child as { __appended?: boolean }).__appended = true;
  }

  /**
   * Mark this list for update. Its update-list-info is sent with the next
   * flush of the element tree, which every list changed since the last one
   * shares: LynxRendererFactory2.end()'s for a change detection cycle, so
   * list updates go with the normal Angular CD cycle, never from setTimeout
   * (which crashes native). Lists changed outside a cycle (a lazy route's
   * component creating static items, before its first check) go with a
   * settle flush, or a microtask's (see scheduleListUpdate).
   */
  #scheduleUpdate(): void {
    if (this.#destroyed) return;
    scheduleListUpdate(this);
  }

  /**
   * The items as they are now, in order: each element child, and each run's
   * items where its anchor sits. Committing a run here is what fixes the
   * items its bind() indexes into until the next update.
   */
  #collectSlots(): ListSlot[] {
    const slots: ListSlot[] = [];
    for (
      let child = this.#firstVirtualChild;
      child;
      child = child._virtualNext
    ) {
      if (child.tagName !== 'comment') {
        // Diff by native unique-ID (a plain number), NOT by element-object
        // identity. Hashing a native-backed element ref as a Set/Map key
        // routes through Lepus's LepusConvertToObjectCallBack →
        // CheckObjectCtx, which aborts the entire main-thread QuickJS
        // context the instant the ref is stale or from another context —
        // precisely the case on removal. The ids of the old items are the
        // strings captured on the previous update, so the diff never calls
        // a native accessor on an already-removed element.
        //
        // The id is read once per element, when the list first sees it, and
        // kept on the ref: asking native on every update cost a call per
        // item, so one row added to a list of thousands made thousands. A
        // unique id never changes for the element it names, and an element
        // made again (LynxElement swaps its native ref) has a ref of its own,
        // which the list asks about anew. Not in LynxElement's constructor:
        // most elements never go in a list.
        const ref = child.element;
        slots.push({
          id: ((ref as ListIdOnRef).__angularLynxListId ??=
            `#${__GetElementUniqueID(ref)}`),
          ref,
          source: null,
          index: -1,
          key: '',
          type: 'list-item',
          attributes: undefined,
        });
        continue;
      }
      const entry = this.#sources.find(({ anchor }) => anchor === child);
      if (!entry) continue;
      const { source } = entry;
      const run = source.commit();
      for (let index = 0; index < run.keys.length; index++) {
        const key = run.keys[index]!;
        const type = run.types[index]!;
        slots.push({
          id: `${source.id}|${type}|${key}`,
          ref: null,
          source,
          index,
          key,
          type,
          attributes: run.attributes[index],
        });
      }
    }
    return slots;
  }

  /**
   * What native reads for an item it's told is inserted at `position`.
   */
  #insertAction(slot: ListSlot, position: number): InsertAction {
    if (slot.ref) {
      // Minimal insertAction format matching Vue Lynx: only position, type,
      // item-key.
      return {
        position,
        type: 'list-item',
        'item-key':
          (__GetAttributeByName(slot.ref, 'item-key') as string | null) ??
          slot.id.slice(1),
      };
    }
    return {
      position,
      type: slot.type,
      'item-key': slot.key,
      ...slot.attributes,
    };
  }

  /**
   * Adds an updateAction for a run's item that stays at `position` when its
   * layout attributes changed since `old`, the same item as last told to
   * native. An element child's attributes are its own, set on its element.
   */
  #updateIfChanged(
    updateAction: UpdateAction[],
    old: ListSlot,
    slot: ListSlot,
    position: number,
  ): void {
    if (!slot.source || !attributesDiffer(old.attributes, slot.attributes)) {
      return;
    }
    updateAction.push({
      ...this.#insertAction(slot, position),
      from: position,
      to: position,
      flush: false,
    });
  }

  /**
   * Compute a diff against the last committed items and send update-list-info,
   * and say whether it was sent. Called from processPendingListUpdates() — NOT
   * directly — which defers it until the first render has finished. No flush
   * here: whoever called that flushes once for every list it sent (see
   * flushTreeWithListUpdates), and native asks for the items in that flush.
   *
   * Positions in insertAction are indices in the NEW item array, ascending.
   * Positions in removeAction are indices in the OLD (committed) array,
   * ascending. This matches the React Lynx ListUpdateInfoRecording format,
   * and what native does with them: removals first (iOS walks them from the
   * last), then each insertion at its final position in ascending order.
   *
   * An item that moved is removed from where it was and inserted where it
   * is, as React Lynx sends a move: native keeps its cell by `item-key` and
   * asks for it again. Only the items outside the longest run that kept
   * their order move. A run's item whose layout attributes changed gets an
   * updateAction (`flush: false`, as React Lynx sends one), so native lays it
   * out anew without asking for it again; its content is Angular's to update.
   */
  _processUpdate(): boolean {
    if (this.#destroyed) return false;

    const newSlots = this.#collectSlots();
    const oldSlots = this.#committed;

    // Commit NOW, before update-list-info below and the flush after it — not
    // at the end of this method. componentAtIndex reads via committedSlot(),
    // and it runs reentrantly from inside that __FlushElementTree() call
    // (native invokes it synchronously as part of the list's own layout
    // pass); by then this must already reflect the new list.
    this.#committed = newSlots;

    // Most updates change the items in one place: a row added at the end, one
    // removed, a page of a feed loaded. The items before the first change and
    // after the last stay where they are, so only the items between them go
    // through the diff below, and it costs what changed rather than the
    // whole list. That changes nothing in what native is sent: every longest
    // run that kept its order holds all of them (their old indices are
    // below, and above, every old index between them), and
    // longestIncreasing() picks the same items between them either way. New
    // items [start, newEnd) were old items [start, oldEnd). Indices into the
    // arrays themselves, not slices of them, which would copy the list.
    const newLength = newSlots.length;
    const oldLength = oldSlots.length;
    let start = 0;
    while (
      start < newLength &&
      start < oldLength &&
      newSlots[start]!.id === oldSlots[start]!.id
    ) {
      start++;
    }
    let newEnd = newLength;
    let oldEnd = oldLength;
    while (
      newEnd > start &&
      oldEnd > start &&
      newSlots[newEnd - 1]!.id === oldSlots[oldEnd - 1]!.id
    ) {
      newEnd--;
      oldEnd--;
    }

    // Each changed item's index in the old array, by identity: strings,
    // never element refs (see #collectSlots). An id is in each array once,
    // so a new item between the ends can only have been an old one between
    // them. oldIndexOf[i - start] is new item i's old index, or -1.
    const oldIndexById = new Map<string, number>();
    for (let i = start; i < oldEnd; i++) {
      oldIndexById.set(oldSlots[i]!.id, i);
    }
    const oldIndexOf: number[] = [];
    // The kept items, in their new order, and which of them stay in place.
    const kept: number[] = [];
    for (let i = start; i < newEnd; i++) {
      const oldIndex = oldIndexById.get(newSlots[i]!.id) ?? -1;
      oldIndexOf.push(oldIndex);
      if (oldIndex >= 0) kept.push(i);
    }
    const staying = longestIncreasing(kept.map((i) => oldIndexOf[i - start]!));
    const stays = Array.from({ length: newEnd - start }, () => false);
    // What became of each old item between the ends (at oldIndex - start):
    // kept, and kept in place.
    const keptOld = Array.from({ length: oldEnd - start }, () => false);
    const stayingOld = Array.from({ length: oldEnd - start }, () => false);
    kept.forEach((newIndex, k) => {
      const oldIndex = oldIndexOf[newIndex - start]! - start;
      keptOld[oldIndex] = true;
      if (staying[k]) {
        stays[newIndex - start] = true;
        stayingOld[oldIndex] = true;
      }
    });

    // Items gone, or moving: removed from where they were.
    const removeAction: number[] = [];
    for (let i = start; i < oldEnd; i++) {
      if (!stayingOld[i - start]) removeAction.push(i);
    }

    // Items new, or moving: inserted where they are now. And a run's item in
    // place whose layout attributes changed: updated where it is, the ends'
    // items included, all in the order of the new array.
    const insertAction: InsertAction[] = [];
    const updateAction: UpdateAction[] = [];
    for (let i = 0; i < start; i++) {
      this.#updateIfChanged(updateAction, oldSlots[i]!, newSlots[i]!, i);
    }
    for (let i = start; i < newEnd; i++) {
      const slot = newSlots[i]!;
      if (!stays[i - start]) {
        insertAction.push(this.#insertAction(slot, i));
      } else {
        const old = oldSlots[oldIndexOf[i - start]!]!;
        this.#updateIfChanged(updateAction, old, slot, i);
      }
    }
    for (let i = newEnd; i < newLength; i++) {
      const old = oldSlots[i - newLength + oldLength]!;
      this.#updateIfChanged(updateAction, old, newSlots[i]!, i);
    }

    // CRITICAL: Never send empty update-list-info. Vue Lynx skips updates
    // when there's nothing new (flushListUpdates checks items.length <= reported).
    // Sending an empty update puts the native list in a bad state that causes
    // subsequent updates with items to crash intermittently.
    if (
      insertAction.length === 0 &&
      removeAction.length === 0 &&
      updateAction.length === 0
    ) {
      return false;
    }

    // Clean up the appended-to-native-list marker for removed element items
    // so they can be re-appended fresh if re-added to the list later. One
    // that moved is appended still, and keeps it. A run's item elements stay
    // appended: the run reuses them.
    for (const index of removeAction) {
      const removed = oldSlots[index]!;
      if (removed.ref && !keptOld[index - start]) {
        (removed.ref as { __appended?: boolean }).__appended = false;
      }
    }

    __SetAttribute(this.element, 'update-list-info', {
      insertAction,
      removeAction,
      updateAction,
    });

    // Re-register callbacks alongside the fresh update-list-info — matches
    // React Lynx's flush() (listUpdateInfo.ts), which calls this on every
    // update, not just once at creation, rather than only once at __CreateList
    // time as we did before.
    if (this.#componentAtIndex && this.#enqueueComponent) {
      __UpdateListCallbacks(
        this.element as ListElementRef,
        this.#componentAtIndex,
        this.#enqueueComponent,
        // componentAtIndexes is optional in the setCallbacks signature — the
        // batch path is a Lynx optimization the runtime uses only when native
        // asks for it. Every real caller supplies it, so the nullish fallback
        // is defensive.
        /* v8 ignore next */
        this.#componentAtIndexes ?? undefined,
      );
    }

    // No flush here: the flush that follows lays out this list along with
    // every other list sent with it, and the rest of the tree (see
    // flushTreeWithListUpdates). A list inside a `*lynxListFor` item that
    // componentAtIndex is building gets none of its own: the item's flush,
    // which componentAtIndex makes next, lays out the item and this list in
    // it, as React Lynx's lists inside a list's item are (ensureElements →
    // flushWithId, no flush of their own). A root flush then would re-enter
    // native's layout pass (see bindListItem).
    //
    // Do NOT clear update-list-info to an empty {insertAction:[],...} after
    // it. Native consumes update-list-info once during the flush (the list
    // element is no longer dirty for that attribute afterward), so a later
    // flush won't re-apply it. React Lynx never clears it either — it just
    // sets a fresh diff on the next real update (see listUpdateInfo.ts, which
    // only ever __SetAttribute's a computed diff, never an empty one). Sending
    // an empty update-list-info actively corrupts the native list's state
    // (see this file's earlier note): it leaves every cell perpetually
    // "binding" and the engine re-runs its layout pass forever with
    // visibleItem stuck empty.
    return true;
  }
}

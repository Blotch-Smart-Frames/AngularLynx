import {
  listItemWriteMark,
  LynxListElement,
  settleAfterListItems,
} from '../../lynx-element';
import type { ListSlot } from '../../lynx-element/lynx-list-element';
import type { ElementRef, ListElementRef } from '../../types/lynx';

/**
 * Factory for the list native element.
 *
 * list in Lynx is a virtualized list driven by engine callbacks.
 * Angular's rendering builds children into a virtual JS-level linked list
 * (LynxListElement). The native engine calls componentAtIndex for each
 * visible index, synchronously, during the list's own layout pass; we
 * append the pre-built element and ack it with { asyncFlush: true } (see
 * componentAtIndex's own doc comment for why, and for the hard constraint
 * that nothing reachable from these callbacks may call a WeakSet/Map method).
 *
 * A `*lynxListFor` item isn't built until native asks for it: componentAtIndex
 * has its directive build it, or rebind a view whose element native let go of
 * through enqueueComponent, then appends and flushes it the same way. That's
 * React Lynx's protocol (snapshot/list/list.ts): an element native enqueued is
 * still in the list, and goes back to native under its own unique id, showing
 * another item. With `enable-async-list`, native may call componentAtIndex
 * and enqueueComponent from a task of their own rather than from inside a
 * flush of ours: they read only what the last update committed, so either way
 * they see the items native was told about.
 */
export const createListElement = (pageId: number): LynxListElement => {
  // Forward-declared so callbacks can close over the fully-initialized instance.
  let listEl: LynxListElement;

  /**
   * The element of the item in `slot`, appended to the native list if it
   * isn't yet: an element child as it is, a `*lynxListFor` item built or
   * rebound by its run (see LynxListElement.bindItem). Null when a run can't
   * give one (its directive is gone).
   */
  const itemElement = (
    listRef: ListElementRef,
    slot: ListSlot,
  ): { element: ElementRef; reused: boolean } | null => {
    const item = slot.source
      ? listEl.bindItem(slot)
      : { element: slot.ref!, reused: false };
    if (!item) return null;
    if (!listEl.isAppendedToNativeList(item.element)) {
      __AppendElement(listRef, item.element);
      listEl.markAppendedToNativeList(item.element);
    }
    return item;
  };

  /**
   * The flush option that tells native an element now shows another item,
   * when native asked to hear about it (componentAtIndex's
   * `enableReuseNotification`), as React Lynx passes it. Native passes it on
   * to the item's elements, which reset what they held for the item before.
   */
  const reuseNotification = (
    listRef: ListElementRef,
    slot: ListSlot,
    item: { reused: boolean },
    enableReuseNotification: boolean | undefined,
  ) =>
    item.reused && enableReuseNotification
      ? {
          listReuseNotification: { listElement: listRef, itemKey: slot.key },
        }
      : {};

  /**
   *   * componentAtIndex is called by the native engine synchronously, from
   *   * DEEP inside the list's own layout pass (LinearLayoutManager::Fill ->
   *   * LayoutChunk -> BindItemHolder -> ComponentAtIndex -> into JS). We append
   *   * the pre-built element (its own inner subtree was already committed by
   *   * the normal, non-list __AppendElement calls during rendering) and ack it.
   *   * A `*lynxListFor` item is built (or rebound) and checked first, inside
   *   * bindListItem's scope, which keeps any other flush out of the layout
   *   * pass (see lynx-render-lifecycle.ts); the ack below is its only flush.
   *   *
   *   * The ack MUST be a synchronous flush tagged with the operationID native
   *   * passed us: { triggerLayout: true, operationID, elementID: sign, listID }.
   *   * This mirrors React Lynx's single-item componentAtIndex exactly (see
   *   * lynx-stack/packages/react/runtime/src/snapshot/list/list.ts,
   *   * componentAtChildCtx's `!enableBatchRender` branch). The operationID is the acknowledgment the
   *   * native list waits for to mark this cell's binding COMPLETE — it is the
   *   * whole point of the callback. { asyncFlush: true } (untagged) is only for
   *   * the batch componentAtIndexes path where the engine itself opts in; using
   *   * it here leaves every cell perpetually "binding" (native never matches an
   *   * operationID), so it re-runs its layout pass forever without ever showing
   *   * an item — an infinite layoutComplete loop with visibleItem stuck empty.
   *   * Despite running from inside the layout pass, the operationID flush is not
   *   * dangerously re-entrant: native defers the operation's completion via the
   *   * operationID queue rather than recursing into TickLayout here.
   *   *
   *   * CRITICAL: this function (and anything it calls, e.g. listEl's helper
   *   * methods) must NEVER key a WeakSet/Map/Set on an element ref — not even a
   *   * single .has(). Hashing a native-backed element ref on the main-thread
   *   * Lepus context aborts the whole process inside QuickJS's Map/Set
   *   * implementation: js_map_has → map_find_record → js_strict_eq2 →
   *   * __JS_FreeValueRT (a refcount assertion), or a CheckObjectCtx cross-context
   *   * abort. This is NOT about reentrancy or call-stack depth — it reproduced
   *   * from a freshly-scheduled setTimeout task with no accumulated depth, and it
   *   * ALSO fires from LynxListElement._processUpdate() during an ordinary
   *   * change-detection cycle (it crashed to the home screen on every list
   *   * add/remove until getUIChildren() stopped keying a WeakSet on element refs).
   *   * The helpers below sidestep it structurally: committedSlot()
   *   * indexes a pre-computed array, isAppendedToNativeList() reads a plain
   *   * property tag, _processUpdate() diffs Maps of string ids, a
   *   * `*lynxListFor` run keys its views by item key and unique id (strings
   *   * and numbers), and getUIChildren() filters on the wrapper's tagName —
   *   * all ordinary field access / primitive hashing, never an element-ref
   *   * Map/Set lookup.
   *
   * list-for.test.ts plays native's part to call it, against a fake native
   * list; what native does around it is checked on device (see
   * investigations/list.md).
   */
  const componentAtIndex = (
    listRef: ListElementRef,
    listId: number,
    cellIndex: number,
    opId: number,
    enableReuseNotification?: boolean,
  ): number | undefined => {
    const slot = listEl.committedSlot(cellIndex);
    if (!slot) return undefined;
    const mark = listItemWriteMark();
    const item = itemElement(listRef, slot);
    if (!item) return undefined;
    const sign = __GetElementUniqueID(item.element);
    __FlushElementTree(item.element, {
      triggerLayout: true,
      operationID: opId,
      elementID: sign,
      listID: listId,
      ...reuseNotification(listRef, slot, item, enableReuseNotification),
    });
    if (slot.source) settleAfterListItems(mark);
    return sign;
  };

  /**
   * enqueueComponent signals that native let go of an item's element: it
   * scrolled away (past `preload-buffer-count`), or native removed or moved
   * its item. A `*lynxListFor` run keeps the element's view for an item
   * native asks for next (see LynxListFor). An element child stays in the
   * native list tree, ready for native to ask for it again, as it always has.
   */
  const enqueueComponent = (
    _listRef: ListElementRef,
    _listId: number,
    eleId: number,
  ) => {
    listEl.enqueue(eleId);
  };

  /**
   *   * Batch version called by the native engine when it needs multiple items.
   *   * Same no-flush approach as componentAtIndex — items are already committed.
   *   * If the engine passes asyncFlush: true, we use it since that path delegates
   *   * scheduling to native (no re-entrancy). The !asyncFlush batch path collects
   *   * all elementIDs and does a single non-re-entrant flush at the end.
   */
  const componentAtIndexes = (
    listRef: ListElementRef,
    listId: number,
    cellIndexes: number[],
    opIds: number[],
    enableReuseNotification: boolean,
    asyncFlush: boolean,
  ) => {
    const elementIDs: number[] = [];
    let built = false;
    const mark = listItemWriteMark();
    for (let i = 0; i < cellIndexes.length; i++) {
      const slot = listEl.committedSlot(cellIndexes[i]!);
      const item = slot && itemElement(listRef, slot);
      // An index native has no item for any more still takes its place in
      // elementIDs, which native pairs with operationIDs by position: -1,
      // as React Lynx sends for an item that isn't ready.
      if (!slot || !item) {
        elementIDs.push(-1);
        continue;
      }
      if (slot.source) built = true;
      const elementID = __GetElementUniqueID(item.element);
      elementIDs.push(elementID);
      if (asyncFlush) {
        // Native engine owns the async schedule — safe, no re-entrancy.
        __FlushElementTree(item.element, {
          asyncFlush: true,
          ...reuseNotification(listRef, slot, item, enableReuseNotification),
        });
      }
    }
    if (!asyncFlush) {
      __FlushElementTree(listRef, {
        triggerLayout: true,
        operationIDs: opIds,
        elementIDs,
        listID: listId,
      });
    }
    if (built) settleAfterListItems(mark);
  };

  const nativeList = __CreateList(
    pageId,
    componentAtIndex,
    enqueueComponent,
    {},
    componentAtIndexes,
  );

  // list-type, span-count, and scroll-orientation should be set via template
  // bindings (e.g. <list list-type="single" span-count="1" ...>), NOT
  // programmatically here. Vue Lynx does not set any attributes after
  // __CreateList — they flow through the normal attribute-setting path.
  //
  // enable-async-list is the one exception: it's not a per-list layout
  // choice, it's a hard requirement of Lynx's native list UI (see
  // LynxUICollection.isNeedRenderComponents in the iOS engine — error
  // E_COMPONENT_LIST_UNSUPPORTED_THREAD_STRATEGY, code 220207). Every
  // AngularLynx app runs the dual-thread (async) engine strategy with
  // fiber-style elements, and without this flag the native list silently
  // skips applying its data source — componentAtIndex is simply never
  // called, no crash, nothing renders. Setting it here means every <list>
  // works out of the box; a template binding can still override it if a
  // future use case genuinely needs the sync (all-on-UI) engine strategy.
  __SetAttribute(nativeList, 'enable-async-list', true);

  listEl = new LynxListElement(nativeList);
  listEl.tagName = 'list';
  listEl.setCallbacks(componentAtIndex, enqueueComponent, componentAtIndexes);
  return listEl;
};

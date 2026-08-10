import {
  isFirstRenderPending,
  runAfterFirstRender,
} from '../lynx-render-lifecycle';
import type { ElementRef, ListElementRef } from '../types/lynx';
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
 */

/**
 * Module-level set of LynxListElements that need their native list updated.
 * Drained by processPendingListUpdates() which is called from
 * LynxRendererFactory2.end() — right before __FlushElementTree().
 */
const pendingListUpdates = new Set<LynxListElement>();

/**
 * Process all pending list updates. Called from LynxRendererFactory2.end()
 * before __FlushElementTree() so list updates are flushed as part of the
 * normal Angular CD cycle — never from setTimeout (which crashes native).
 */
export const processPendingListUpdates = (): void => {
  if (pendingListUpdates.size === 0) return;
  // Copy & clear before iterating — a processUpdate could theoretically
  // trigger further mutations, though unlikely.
  const lists = [...pendingListUpdates];
  pendingListUpdates.clear();
  for (const list of lists) {
    list._processUpdate();
  }
};

export class LynxListElement extends LynxElement {
  #firstVirtualChild: LynxElement | null = null;
  #lastVirtualChild: LynxElement | null = null;
  #destroyed = false;
  /**
   * Tracks what was last committed to native via update-list-info so we can
   * compute a diff (insertAction / removeAction) on the next update. This is
   * ALSO what componentAtIndex/componentAtIndexes (create-list-element.ts)
   * read via getCommittedUIChildren() — see that method's doc comment for
   * why they must never call getUIChildren() themselves.
   */
  #committedUIChildren: ElementRef[] = [];
  /**
   * The native unique-ID (a plain number) of each element in
   * #committedUIChildren, in the same order. Stored so _processUpdate() can
   * diff on primitive keys instead of element-object identity — see that
   * method's diff block for why hashing an element ref in a Set/Map aborts the
   * Lepus context. Kept strictly in lock-step with #committedUIChildren.
   */
  #committedIds: number[] = [];
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
    pendingListUpdates.delete(this);
    super.remove();
  }

  override appendChild(newChild: LynxElement): void {
    if (newChild.isRootPageElement) return;
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
    if (refChild == null) {
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
   * The UI children list as of the last _processUpdate() call, pre-filtered
   * and cached — for componentAtIndex/componentAtIndexes (create-list-element.ts)
   * to read via plain array indexing. See their call sites' doc comments:
   * native invokes them synchronously, reentrantly, from deep inside its own
   * list layout pass, and calling ANY WeakSet/Map method (even a single
   * `.has()`) from within that reentrant call was observed to crash the
   * Lepus QuickJS context with a refcounting assertion inside
   * __JS_FreeValueRT, every time, regardless of how shallow the surrounding
   * call stack is (confirmed via a genuinely fresh setTimeout-scheduled
   * invocation that still crashed identically) — so getUIChildren() (which
   * calls WeakSet.has() per child) must never run from that call path.
   */
  getCommittedUIChildren(): ElementRef[] {
    return this.#committedUIChildren;
  }

  /**
   * Appended-state is tracked as a plain property directly on the ElementRef
   * rather than a WeakSet, for the same reason as getCommittedUIChildren():
   * these are called from componentAtIndex, where WeakSet/Map methods crash.
   * A plain property get/set compiles to ordinary field access, not a call
   * into QuickJS's Map/Set native implementation.
   */
  isAppendedToNativeList(child: ElementRef): boolean {
    return (child as { __appended?: boolean }).__appended === true;
  }

  markAppendedToNativeList(child: ElementRef): void {
    (child as { __appended?: boolean }).__appended = true;
  }

  /**
   * Mark this list for update. The actual processing happens in
   * processPendingListUpdates(), called from LynxRendererFactory2.end()
   * right before __FlushElementTree(). This ensures list updates are
   * flushed as part of the normal Angular CD cycle — calling
   * __FlushElementTree from setTimeout crashes the native engine.
   */
  #scheduleUpdate(): void {
    if (this.#destroyed) return;
    const wasEmpty = pendingListUpdates.size === 0;
    pendingListUpdates.add(this);
    if (wasEmpty) {
      // Safety net for cases where list items are created outside a begin/end
      // CD cycle (e.g. lazy-loaded route components on first navigation).
      // If end() drains the set first, this microtask is a no-op.
      // IMPORTANT: Only call processPendingListUpdates() here — NOT
      // __FlushElementTree() directly. _processUpdate() does its own flush
      // per list once update-list-info/callbacks are set; flushing before
      // that setup runs processes stale list state.
      queueMicrotask(() => {
        if (pendingListUpdates.size > 0) {
          processPendingListUpdates();
        }
      });
    }
  }

  /**
   * Compute a diff against the last committed children and send update-list-info.
   * Called from processPendingListUpdates() — NOT directly.
   * __FlushElementTree() is called afterwards by the renderer factory.
   *
   * Positions in insertAction are indices in the NEW child array.
   * Positions in removeAction are indices in the OLD (committed) child array.
   * This matches the React Lynx ListUpdateInfoRecording format.
   */
  _processUpdate(): void {
    if (this.#destroyed) return;

    // Defer the ENTIRE update — not just the flush — until the first render
    // has fully completed. See isFirstRenderPending()'s doc comment: driving
    // the list's update-list-info + layout flush now would run it while still
    // nested inside native's initial renderPage() call, re-entering our
    // componentAtIndex callback from a call frame native hasn't finished
    // unwinding. Re-running this method from the setTimeout macrotask scheduled
    // by markFirstRenderComplete() lets it run on a clean top-level task
    // instead, after renderPage() has returned.
    if (isFirstRenderPending()) {
      runAfterFirstRender(() => this._processUpdate());
      return;
    }

    const newChildren = this.getUIChildren();
    const oldChildren = this.#committedUIChildren;
    const oldIds = this.#committedIds;

    // Diff by native unique-ID (a plain number), NOT by element-object identity.
    // This is the fix for the SIGABRT on item removal. The diff below looks
    // items up in a Set; hashing a native-backed element ref as a Set/Map key
    // routes through Lepus's LepusConvertToObjectCallBack → CheckObjectCtx,
    // which aborts the entire main-thread QuickJS context the instant the ref
    // is stale or from another context — precisely the case on removal, where
    // the diff must test the just-removed element (whose native backing is now
    // detached) against the surviving set. Crucially this crash did NOT surface
    // on the initial render or on pure appends: those only ever call .has()
    // against an EMPTY Set, and QuickJS short-circuits an empty-set lookup
    // without converting the key. Numbers hash directly with no conversion
    // callback, so an ID-keyed Set is safe on every path (insert, remove,
    // reorder). newIds is read from the live new children (all valid here);
    // oldIds is the array captured on the previous update, so we never invoke a
    // native accessor on an already-removed element while diffing.
    const newIds = newChildren.map((child) => __GetElementUniqueID(child));

    // Commit NOW, before update-list-info/flush below — not at the end of
    // this method. componentAtIndex reads via getCommittedUIChildren(), and
    // it can run reentrantly from inside the __FlushElementTree() call
    // further down (native invokes it synchronously as part of the list's
    // own layout pass); by then this must already reflect the new list.
    // #committedIds is committed in lock-step so the NEXT update's oldIds line
    // up positionally with the array componentAtIndex indexes into.
    this.#committedUIChildren = newChildren;
    this.#committedIds = newIds;

    const oldIdSet = new Set(oldIds);
    const newIdSet = new Set(newIds);

    // Items present in old but absent from new → tell native to remove them.
    // Positions are indices into the OLD committed array (oldIds is parallel).
    const removeAction: number[] = [];
    for (let i = 0; i < oldIds.length; i++) {
      if (!newIdSet.has(oldIds[i]!)) {
        removeAction.push(i);
      }
    }

    // Items present in new but absent from old → tell native to insert them.
    // Minimal insertAction format matching Vue Lynx: only position, type, item-key.
    // Positions are indices into the NEW child array.
    const insertAction = newChildren
      .map((child, i) => ({ child, i }))
      .filter(({ i }) => !oldIdSet.has(newIds[i]!))
      .map(({ child, i }) => ({
        position: i,
        type: 'list-item',
        'item-key':
          __GetAttributeByName(child, 'item-key') ?? String(newIds[i]),
      }));

    // CRITICAL: Never send empty update-list-info. Vue Lynx skips updates
    // when there's nothing new (flushListUpdates checks items.length <= reported).
    // Sending an empty update puts the native list in a bad state that causes
    // subsequent updates with items to crash intermittently.
    if (insertAction.length === 0 && removeAction.length === 0) {
      return;
    }

    // Clean up the appended-to-native-list marker for removed items so they
    // can be re-appended fresh if re-added to the list later.
    for (const idx of removeAction) {
      const removed = oldChildren[idx];
      if (removed) (removed as { __appended?: boolean }).__appended = false;
    }

    __SetAttribute(this.element, 'update-list-info', {
      insertAction,
      removeAction,
      updateAction: [],
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
        this.#componentAtIndexes ?? undefined,
      );
    }

    // Flush from the tree ROOT, not the list element. FiberElement's layout
    // traversal (UpdateLayoutInfoRecursively) walks down from root and
    // early-returns the instant it hits a non-dirty ancestor — it does NOT
    // recurse into children past that point. The list's surrounding
    // <view>/<scroll-view> wrapper was already flushed clean by the earlier
    // bare flush in end(), so a flush scoped to just the list element (via
    // an `element` arg + listID) never reaches the list: the traversal
    // prunes one level above it and the native list's own layout pass
    // (which calls componentAtIndex) never runs. A root-scoped flush walks
    // the whole tree, and marking the list dirty (done above via
    // update-list-info's ResolveAttribute) bubbles dirtiness up through its
    // ancestors, so the traversal isn't pruned before reaching it.
    __FlushElementTree(undefined, { triggerLayout: true });

    // Do NOT clear update-list-info to an empty {insertAction:[],...} here.
    // Native consumes update-list-info once during the flush above (the list
    // element is no longer dirty for that attribute afterward), so a later
    // bare __FlushElementTree() in end() won't re-apply it. React Lynx never
    // clears it either — it just sets a fresh diff on the next real update
    // (see listUpdateInfo.ts, which only ever __SetAttribute's a computed
    // diff, never an empty one). Sending an empty update-list-info actively
    // corrupts the native list's state (see this file's earlier note): it
    // leaves every cell perpetually "binding" and the engine re-runs its
    // layout pass forever with visibleItem stuck empty.
  }
}

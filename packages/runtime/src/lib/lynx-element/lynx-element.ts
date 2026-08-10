// cspell:words Textish
import {
  LynxAnimation,
  type LynxAnimationOptions,
} from '../animation/animation';
import { devStats } from '../devtools/stats';
// Imported by DIRECT file path (not the ../lynx-document barrel) on purpose:
// the barrel re-exports LynxDocument, which imports LynxElement — pulling it in
// here would form an import cycle. These two files import only element-creators
// and types, so this path is cycle-free.
import { createNativeRefByTag } from '../lynx-document/create-native-ref';
import { getPageId } from '../lynx-document/page-ref';
import {
  isFirstRenderPending,
  isInsideChangeDetection,
} from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import {
  type BaseLynxElement,
  EVENT_PREFIXES,
  type LynxEventType,
} from './types';

/**
 * True if attaching `candidate` under `parent` would form a cycle — i.e.
 * `candidate` is `parent` itself or an ancestor of `parent` in the native tree.
 *
 * Lynx's element APIs do NOT guard against this. `FiberElement::InsertNode`
 * auto-reparents a node that still has a parent, but never checks whether the
 * new parent lives inside the node's own subtree, so it will happily build a
 * self-referential tree. The native layout pass would then walk child→child
 * forever, hanging the main thread until the OS watchdog SIGKILLs the app.
 *
 * Kept purely as defensive coding: a same-tick Angular reorder or re-projection
 * can ask to re-insert an element underneath one of its own former descendants
 * (e.g. two siblings swap and one lands inside the other), and appendChild/
 * insertBefore skip that attach rather than corrupt the tree. NOTE: the
 * `LynxTransition` panel freeze that first surfaced this guard was NOT actually a
 * cycle — it was the old child-"parking" mechanism livelocking layout, and that
 * mechanism has since been removed entirely (see #doRemove). The guard stays
 * because the cyclic-attach hazard is genuinely possible and the check is cheap.
 *
 * This is the same ancestor check a browser performs in `insertBefore` (it
 * throws HierarchyRequestError); we return the answer so callers can skip the
 * attach instead of throwing. The walk is bounded by the depth of `parent`, and
 * each step is two cheap native reads — comparable to the tree bookkeeping the
 * attach itself does.
 *
 * Compares by unique ID rather than ref identity: native refs must not be used
 * as map/Set keys (hashing one crashes the Lepus engine — see
 * LynxDocument.createComment), and `__GetParent` is not guaranteed to return the
 * same JS handle across calls.
 */
const wouldFormCycle = (parent: ElementRef, candidate: ElementRef): boolean => {
  const candidateId = __GetElementUniqueID(candidate);
  for (let cur: ElementRef | null = parent; cur; cur = __GetParent(cur)) {
    if (__GetElementUniqueID(cur) === candidateId) return true;
  }
  return false;
};

/**
 * A raw-text leaf or a <text> container — the only elements that carry trimmable
 * inline text. Used to decide when a mutation should queue text normalization.
 */
const isTextish = (el: LynxElement): boolean =>
  el.tagName === 'text' || el.tagName === 'raw-text';

export class LynxElement implements BaseLynxElement {
  /**
   * The native element ref this wrapper currently drives.
   *
   * Exposed through a getter (rather than a public `readonly` field) because
   * `#recreateSubtree()` swaps in a FRESH native ref when this element is
   * remounted after its painting node was destroyed by a cross-flush removal.
   * Everything reads `this.element` through the getter, so it always sees the
   * current ref. Angular, `viewChild`, and `ElementRef.nativeElement` hold the
   * stable WRAPPER (this object), never the raw ref, so the swap is invisible to
   * them. The one snapshot risk — `LynxAnimation`, which copies the ref — is
   * safe because `#doRemove()` cancels animations before a removal, so none
   * survive into a remount.
   */
  #nativeRef: ElementRef;
  get element(): ElementRef {
    return this.#nativeRef;
  }
  tagName = '';

  /**
   * When true, this element is the root page element and must not be
   * re-parented (appendChild/insertBefore) or removed from the tree.
   * Angular calls appendChild/remove as part of normal component lifecycle,
   * but the page element is the immutable root — moving or removing it
   * would corrupt the native element tree.
   */
  isRootPageElement = false;

  /**
   * Virtual tree tracking — used when parent manages children outside the
   * native element tree (e.g., list manages children via componentAtIndex
   * callbacks rather than __AppendElement)
   */
  _virtualParent: LynxElement | null = null;
  _virtualPrev: LynxElement | null = null;
  _virtualNext: LynxElement | null = null;

  // Tracks IDs of animations started on this element via animate().
  // Canceled when the element is destroyed (see #doRemove) to clear stale
  // animation state from Lynx's native element pool — without this, pooled
  // elements retain animation values (e.g. opacity: 0) that poison
  // newly-created elements reusing the slot.
  #activeAnimationIds: string[] = [];

  // --- Recreation cache -------------------------------------------------------
  // Lynx destroys an element's native painting node when it is removed in one
  // flush and NOT re-inserted in that same flush (is_move=false in the core),
  // and there is no API to re-create a painting node on a later re-insert. So a
  // remounted element — e.g. content projected through <ng-content> inside an
  // @if that toggles off then on again — would re-attach an empty native view.
  // We fix it the way React Lynx does: recreate a fresh native element on
  // remount. That requires replaying the element's state onto the new ref, so
  // every state-mutating call below MIRRORS into these caches for
  // #recreateSubtree() to replay. Caching is eager (every element, every write)
  // because by the time a removal happens the setter calls are long gone — and
  // event listeners in particular cannot be read back from the native side.
  #attrs = new Map<string, unknown>();
  #id: string | null = null;
  #dataset: Record<string, unknown> = {};
  /** Full space-separated class string, mirroring __SetClasses semantics. */
  #classes = '';
  /** Whole-string inline style set via setInlineStyles (style="..."). */
  #inlineStyleWhole: string | null = null;
  /** Per-key inline styles set via setStyle ([style.x] bindings). */
  #inlineStyleKeys = new Map<string, unknown>();
  #listeners: {
    eventType: LynxEventType;
    eventName: string;
    listener: (event: any) => any;
  }[] = [];
  /**
   * DISPLAYED text of a raw-text element — the positionally edge-trimmed value
   * that is actually painted, and what #recreateSubtree bakes into a rebuilt
   * raw-text (see setInitialText / #setDisplayedText).
   */
  #text: string | undefined;
  /**
   * Collapsed-but-UNTRIMMED text of a raw-text element (the value the renderer
   * produced via collapseWhitespace, before any positional edge-trim). The
   * flush-time normalization pass re-derives #text from this — it must keep the
   * edge spaces #text drops, so a leaf whose position changes (e.g. it stops
   * being the last run in its text) can have a trimmed edge restored. See
   * #normalizeTextRoot / processPendingTextNormalization.
   */
  #rawText: string | undefined;
  /**
   * Ordered child wrappers, kept in lock-step with the native child order by
   * appendChild/insertBefore/#doRemove. This is the CANONICAL wrapper list — the
   * wrappers Angular stores in its LView — which is what recreation must rebuild;
   * never the throwaway wrappers parentNode()/nextSibling()/querySelector mint.
   */
  #children: LynxElement[] = [];
  /** Back-pointer to the JS parent, for O(1) detach from its #children. */
  #jsParent: LynxElement | null = null;
  /**
   * True once this element's native painting node has been destroyed by a
   * genuine (non-move) removal. The next appendChild/insertBefore rebuilds it.
   */
  #paintingDead = false;

  /**
   * Elements whose removal has been requested but not yet committed to the
   * native tree. Angular performs a MOVE as detach-then-reinsert: it calls
   * renderer.removeChild(el) immediately followed — in the SAME synchronous
   * change-detection tick — by renderer.insertBefore(el, ...). If remove() tore
   * the element out synchronously, the intermediate detached state could be
   * committed between the two calls; queuing lets a same-tick re-insert cancel
   * the removal so a move is a no-op at the native level.
   *
   * So remove() only QUEUES the element here; `processPendingRemovals()` commits
   * the survivors from `LynxRendererFactory2.end()`, right before
   * `__FlushElementTree()`, so a genuine removal lands in the SAME flush as the
   * rest of the cycle's mutations. (It used to drain in a `queueMicrotask`, which
   * fired AFTER that flush — so a removed subtree lingered in native layout,
   * occupying space until some later cycle happened to flush. That was the
   * "hidden element leaves a gap" bug.) A re-insert (appendChild/insertBefore)
   * cancels the queued removal: the element is still natively attached, so
   * __InsertElementBefore/__AppendElement auto-reparents it with its whole
   * subtree intact — matching how React Lynx and the Lynx fiber core
   * (InsertNodeBeforeInternal) handle moves.
   *
   * Keyed by the LynxElement wrapper, not the native ElementRef: Angular hands
   * the SAME wrapper instance (the one stored in its LView) to both removeChild
   * and insertBefore, so wrapper identity is stable across a move — and native
   * refs can't be hashed anyway (doing so crashes the Lepus engine; see
   * LynxDocument.createComment).
   */
  static #pendingRemovals = new Set<LynxElement>();

  /**
   * Text-carrying elements whose inline content changed this cycle and need
   * positional whitespace re-derivation. The renderer collapses whitespace but
   * cannot trim edges — whether a run's leading/trailing space is trimmable
   * depends on its POSITION among siblings (see collapseWhitespace in
   * renderer.ts) — so trimming is deferred to a flush-time pass that walks each
   * dirty text's inline-formatting context. Drained by
   * `processPendingTextNormalization()` from `LynxRendererFactory2.end()`, right
   * after removals and before `__FlushElementTree()`, so corrected text lands in
   * the same flush. Keyed by the wrapper, never a native ref (hashing one crashes
   * the Lepus engine — see #pendingRemovals / #byNativeId).
   */
  static #pendingTextNormalization = new Set<LynxElement>();

  /**
   * Native-ref → canonical wrapper registry, keyed by the native unique ID.
   *
   * Angular locates an insertion parent for embedded views (@if/@for content)
   * via `renderer.parentNode(anchorComment)`, and Lynx exposes only the raw
   * native parent ref — with no way to map it back to the CANONICAL LynxElement
   * wrapper (the one Angular stores in its LView, whose `#children` recreation
   * walks). parentNode()/nextSibling()/querySelector() therefore used to MINT a
   * fresh throwaway wrapper (empty `#children`); when Angular then inserted the
   * embedded content into that throwaway, the content was adopted into the
   * throwaway's `#children` and was ABSENT from the canonical parent's. It still
   * rendered on first paint (the throwaway drives the same native ref), but
   * `#recreateSubtree()` — which rebuilds a remounted subtree from the canonical
   * `#children` — could never find it, so it vanished on route re-entry (the
   * reuse-strategy remount). This registry lets those methods return the
   * CANONICAL wrapper instead, so every adoption lands in the canonical tree.
   *
   * Keyed by `__GetElementUniqueID` (a number), never the ref itself — hashing a
   * native ref crashes the Lepus engine (see LynxDocument.createComment).
   */
  static #byNativeId = new Map<number, LynxElement>();

  /**
   * Returns the canonical wrapper driving `ref`, or a fresh wrapper if none is
   * registered (an element never created through LynxDocument, e.g. a raw query
   * hit). Read-only callers (parentNode/nextSibling/querySelector) use this so
   * they never mint a competing throwaway for an element that already has a
   * canonical wrapper.
   */
  static #canonicalFor(ref: ElementRef): LynxElement {
    const existing = LynxElement.#byNativeId.get(__GetElementUniqueID(ref));
    return existing ?? new LynxElement(ref);
  }

  constructor(element: ElementRef) {
    this.#nativeRef = element;
    // Register as the canonical wrapper for this native ref. #canonicalFor()
    // checks the map before constructing, so this never overwrites an existing
    // canonical wrapper with a throwaway.
    LynxElement.#byNativeId.set(__GetElementUniqueID(element), this);
  }

  /**
   * Drops this wrapper's current native id from the registry. Called when the
   * native ref is swapped (recreate-on-remount) for the STALE id, and by the
   * renderer's destroyNode when Angular tears the element down, so the registry
   * doesn't retain wrappers for dead native refs.
   */
  deregisterNative(): void {
    const id = __GetElementUniqueID(this.#nativeRef);
    // Only clear if WE are the registered wrapper — a later element that reused
    // this id (native id reuse) must keep its entry.
    if (LynxElement.#byNativeId.get(id) === this) {
      LynxElement.#byNativeId.delete(id);
    }
  }

  setProperty(name: string, value: any): void {
    this.setAttribute(name, value);
  }

  /**
   * Seeds the cached text for a raw-text element so #recreateSubtree() can
   * rebuild it via __CreateRawText. Called by LynxDocument right after
   * construction — raw-text bakes its text in at creation, so it never flows
   * through a cached setter.
   */
  setInitialText(text: string): void {
    this.#text = text;
    this.#rawText = text;
  }

  /**
   * Writes the positionally edge-trimmed DISPLAY text onto the live raw-text
   * element, bypassing setAttribute so it does NOT overwrite #rawText or re-queue
   * this node for normalization. Called only by the flush-time normalization
   * pass. Keeps #text and the recreation attr cache (#attrs['text']) in sync with
   * the displayed value so a remounted raw-text rebuilds with the correct text.
   */
  #setDisplayedText(displayed: string): void {
    if (this.#text === displayed) return;
    __SetAttribute(this.element, 'text', displayed);
    this.#text = displayed;
    this.#attrs.set('text', displayed);
  }
  setAttribute(name: string, value: any): void {
    if (name === 'class') {
      // Use __SetClasses (not __AddClass) because setAttribute replaces the
      // entire class attribute with a space-separated list. __AddClass treats
      // its argument as a single class name — passing 'foo bar baz' would set
      // the literal class 'foo bar baz' rather than three separate classes,
      // so no CSS rule would ever match. __SetClasses correctly parses the
      // space-separated list. This matches how React Lynx handles className.
      __SetClasses(this.element, value ?? '');
      this.#classes = value ?? '';
    } else if (name === 'style') {
      this.setInlineStyles(value);
    } else if (name === 'id') {
      __SetID(this.element, value);
      this.#id = value ?? null;
    } else if (name.startsWith('data-')) {
      const data: Record<string, any> = {};
      const key = name.slice(5);
      data[key] = value;
      __SetDataset(this.element, data);
      this.#dataset[key] = value;
    } else {
      __SetAttribute(this.element, name, value);
      // Mirror for recreation. removeAttribute() funnels here with value=null,
      // so drop the key then rather than replaying a cleared attribute. raw-text
      // carries its text via the 'text' attribute (renderer.setValue) — keep
      // #text in sync so a rebuilt raw-text bakes the current text in.
      if (value == null) {
        this.#attrs.delete(name);
      } else {
        this.#attrs.set(name, value);
      }
      if (this.tagName === 'raw-text' && name === 'text') {
        // The renderer feeds this the COLLAPSED-but-untrimmed value (see
        // renderer.setValue → collapseWhitespace). Stash it as the raw source and
        // queue the enclosing text for the positional edge-trim pass; #text is
        // the provisional display until that pass corrects it (#setDisplayedText).
        const text = value == null ? undefined : String(value);
        this.#text = text;
        this.#rawText = text;
        LynxElement.#enqueueTextNormalization(this);
      }
    }
  }

  getAttribute(name: string) {
    return __GetAttributeByName(this.element, name) as string;
  }

  removeAttribute(name: string): void {
    this.setAttribute(name, null);
  }

  setStyle(key: string, value: unknown): void {
    __AddInlineStyle(this.element, key, value);
    this.#inlineStyleKeys.set(key, value);
  }
  removeStyle(key: string): void {
    __AddInlineStyle(this.element, key, null);
    this.#inlineStyleKeys.delete(key);
  }
  setInlineStyles(inlineStyle: string): void {
    __SetInlineStyles(this.element, inlineStyle);
    this.#inlineStyleWhole = inlineStyle;
  }

  insertBefore(newChild: LynxElement, refChild: LynxElement | null): void {
    if (newChild.isRootPageElement) return;
    // A queued removal immediately followed by a re-insert is an Angular MOVE —
    // cancel the removal so the element keeps its children. It is still natively
    // attached to its old parent, so __InsertElementBefore auto-reparents the
    // whole subtree (see #pendingRemovals).
    newChild.#cancelPendingRemoval();
    // If the child was genuinely removed in a PREVIOUS cycle its native painting
    // node is gone — rebuild a fresh native element + subtree before re-attaching
    // (see #recreateSubtree). A same-tick move was canceled just above and is
    // never painting-dead, so the fast move path pays only a boolean check.
    newChild.#recreateIfDead();
    if (refChild == null) {
      this.appendChild(newChild);
    } else {
      // Never insert an element into its own subtree — Lynx would build a cyclic
      // native tree and hang the layout pass (see wouldFormCycle). Skipping is
      // safe: a cyclic insert is a corrupt request, and leaving newChild where it
      // is beats freezing the app.
      if (wouldFormCycle(this.element, newChild.element)) return;
      __InsertElementBefore(this.element, newChild.element, refChild.element);
      this.#adoptChild(newChild, refChild);
      if (isTextish(this) || isTextish(newChild)) {
        LynxElement.#enqueueTextNormalization(newChild);
      }
    }
  }

  appendChild(newChild: LynxElement): void {
    if (newChild.isRootPageElement) return;
    // See insertBefore: cancel a pending removal so a move keeps its subtree,
    // then rebuild the child if its painting node was destroyed in a prior cycle.
    newChild.#cancelPendingRemoval();
    newChild.#recreateIfDead();
    // Guard against a cycle-forming attach (see wouldFormCycle) — the same hang
    // insertBefore protects against.
    if (wouldFormCycle(this.element, newChild.element)) return;
    __AppendElement(this.element, newChild.element);
    this.#adoptChild(newChild);
    // Attaching a run to (or as) a text shifts inline layout — re-derive the
    // enclosing context's edge whitespace at the next flush (see
    // #pendingTextNormalization). Enqueue newChild; the pass resolves it to the
    // outermost text root, so this covers both a run joining a text and a text
    // root being attached elsewhere.
    if (isTextish(this) || isTextish(newChild)) {
      LynxElement.#enqueueTextNormalization(newChild);
    }
  }

  /**
   * Records `newChild` in this element's ordered `#children`, first unlinking it
   * from its previous JS parent (mirroring the native auto-reparent that
   * __AppendElement/__InsertElementBefore perform). Keeping `#children` in
   * lock-step with the native child order is what lets #recreateSubtree() rebuild
   * a remounted subtree in the correct order. `refChild` positions the insert;
   * when omitted the child is appended.
   */
  #adoptChild(newChild: LynxElement, refChild?: LynxElement): void {
    const prev = newChild.#jsParent;
    if (prev) {
      const i = prev.#children.indexOf(newChild);
      if (i >= 0) prev.#children.splice(i, 1);
    }
    newChild.#jsParent = this;
    if (refChild) {
      const idx = this.#children.indexOf(refChild);
      this.#children.splice(idx < 0 ? this.#children.length : idx, 0, newChild);
    } else {
      this.#children.push(newChild);
    }
  }

  addClass(name: string): void {
    __AddClass(this.element, name);
    // Keep the cached class string in sync (deduped) so recreation replays the
    // full class list in one __SetClasses.
    const set = new Set(this.#classes.split(/\s+/).filter(Boolean));
    set.add(name);
    this.#classes = [...set].join(' ');
  }

  /**
   * Lynx has no __RemoveClass PAPI — we must get current classes, filter,
   * and set back. This is O(n) per class removal but class lists on Lynx
   * elements are typically small (1-5 classes for scope/component styling).
   */
  removeClass(name: string): void {
    const classes = __GetClasses(this.element).filter((c) => c !== name);
    const joined = classes.join(' ');
    __SetClasses(this.element, joined);
    this.#classes = joined;
  }

  /**
   * Requests removal of this element. Two removal paths:
   * 1. Virtual parent (list) → delegate to removeVirtualChild() SYNCHRONOUSLY,
   *    which updates the JS linked list and schedules an update-list-info diff.
   *    Does NOT call __RemoveElement — list item removal is managed exclusively
   *    through update-list-info's removeAction (calling both would double-remove
   *    and crash). This is never part of an Angular move, so it is not deferred.
   * 2. Normal parent → QUEUED and committed at the end of the change-detection
   *    cycle (see #pendingRemovals / commitPendingRemovals). If a re-insert
   *    follows in the same cycle it is a move and gets canceled; otherwise
   *    #doRemove() detaches from the native tree.
   */
  remove() {
    if (this.isRootPageElement) return;
    // Count the removal request on the synchronous path. `__PROFILE__` is a
    // build-time `define` — read it here rather than from the deferred drain (in
    // tests a leaked drain can run after the module's defines are gone, throwing
    // "__PROFILE__ is not defined").
    if (__PROFILE__) devStats.elementRemoved++;
    if (this._virtualParent) {
      const vp = this._virtualParent as any;
      if (typeof vp.removeVirtualChild === 'function') {
        vp.removeVirtualChild(this);
      }
      return;
    }
    LynxElement.#pendingRemovals.add(this);
  }

  /**
   * Commits every queued genuine removal. Called by `LynxRendererFactory2.end()`
   * once per change-detection cycle, BEFORE `__FlushElementTree()`, so the
   * `__RemoveElement` calls are committed to the main thread in the same flush as
   * the cycle's other mutations (see #pendingRemovals for why the timing
   * matters). Any element that was re-inserted (a move) has already removed
   * itself from the set via #cancelPendingRemoval, so only genuine destroys
   * remain.
   */
  static commitPendingRemovals(): void {
    if (LynxElement.#pendingRemovals.size === 0) return;
    const items = [...LynxElement.#pendingRemovals];
    LynxElement.#pendingRemovals.clear();
    for (const el of items) {
      el.#doRemove();
    }
  }

  /**
   * Queues `el` for flush-time whitespace normalization (see
   * #pendingTextNormalization). Deduped, so a node touched by both a text update
   * and an attach in the same cycle is processed once, against the final tree.
   */
  static #enqueueTextNormalization(el: LynxElement): void {
    LynxElement.#pendingTextNormalization.add(el);
  }

  /**
   * Re-derives displayed whitespace for every text touched this cycle. Each dirty
   * node is resolved to the OUTERMOST enclosing <text>: a nested <text> is inline
   * — it shares one inline-formatting-context with the surrounding raw-text, like
   * an HTML <span> — so the whole subtree is trimmed as a single run of text.
   * Called by `processPendingTextNormalization()` from `end()` /
   * `scheduleSettleFlush`, after removals and before the flush.
   */
  static commitPendingTextNormalization(): void {
    if (LynxElement.#pendingTextNormalization.size === 0) return;
    const dirty = [...LynxElement.#pendingTextNormalization];
    LynxElement.#pendingTextNormalization.clear();
    const roots = new Set<LynxElement>();
    for (const node of dirty) {
      let root = node;
      while (root.#jsParent && root.#jsParent.tagName === 'text') {
        root = root.#jsParent;
      }
      // Skip stray enqueues (not inside a text) and subtrees torn down this
      // cycle — their native refs are gone (see #doRemove / #paintingDead).
      if (!isTextish(root) || root.#paintingDead) continue;
      roots.add(root);
    }
    for (const root of roots) {
      LynxElement.#normalizeTextRoot(root);
    }
  }

  /**
   * Trims the edges of one text inline-formatting context. Collects its raw-text
   * leaves in document order, strips the leading space of the first NON-EMPTY
   * leaf and the trailing space of the last NON-EMPTY leaf, and collapses a space
   * shared across an inter-run boundary to a single space — matching how a
   * browser lays out `white-space: normal` text. A single-leaf context (ordinary
   * prose) reduces to trim-both.
   *
   * "Non-empty" matters because a leaf can legitimately collapse to '' (a
   * whitespace-only interpolated or `@for` run — collapseWhitespace shrinks it to
   * a single space, which the inter-run branch below can then consume entirely).
   * Such a leaf contributes no inline box, so it must be transparent: it cannot
   * claim an edge trim in place of the real first/last run, and it must not
   * erase `pendingSpace` — the earlier run's trailing space is still "pending"
   * across it, or the run after would keep its own leading space too and produce
   * a double space (this was a real bug: `['A ', ' ', ' B']` rendered "A  B").
   */
  static #normalizeTextRoot(root: LynxElement): void {
    // A raw-text is itself a leaf. Its parent is not always a <text> (a raw-text
    // painted outside a <text> is unsupported by Lynx and never renders, but
    // this keeps the pass's own contract — "a single-leaf context reduces to
    // trim-both" — true for every root it is handed).
    const leaves: LynxElement[] = root.tagName === 'raw-text' ? [root] : [];
    if (root.tagName === 'text') {
      LynxElement.#collectRawTextLeaves(root, leaves);
    }
    if (leaves.length === 0) return;

    const displayed: string[] = [];
    let pendingSpace = false;
    let seenNonEmpty = false;
    for (const leaf of leaves) {
      let text = leaf.#rawText ?? '';
      if (!seenNonEmpty) {
        // Still at the leading edge of the whole context — every leaf up to and
        // including the first non-empty one is eligible for the leading trim.
        text = text.replace(/^ /, '');
      } else if (pendingSpace && text.startsWith(' ')) {
        // A space on both sides of an inter-run boundary collapses to one (kept
        // on the earlier run), as a browser would across adjacent inline boxes.
        text = text.slice(1);
      }
      displayed.push(text);
      if (text.length > 0) {
        seenNonEmpty = true;
        pendingSpace = text.endsWith(' ');
      }
      // An empty leaf carries `pendingSpace`/`seenNonEmpty` forward unchanged —
      // it is not the edge and not a boundary in its own right.
    }
    // Trailing edge: strip one trailing space from the LAST non-empty leaf. Done
    // as a second pass (not inline above) because which leaf is "last" can only
    // be known once an empty tail has been ruled out.
    for (let i = displayed.length - 1; i >= 0; i--) {
      if (displayed[i].length === 0) continue;
      displayed[i] = displayed[i].replace(/ $/, '');
      break;
    }
    for (let i = 0; i < leaves.length; i++) {
      leaves[i].#setDisplayedText(displayed[i]);
    }
  }

  /**
   * Collects the raw-text leaves under `el` in document order, descending through
   * nested <text> (inline) and treating any other element as opaque. Walks the
   * canonical #children — never __GetChildren, whose throwaway wrappers would
   * break the recreation registry and background/testing.
   */
  static #collectRawTextLeaves(el: LynxElement, out: LynxElement[]): void {
    for (const child of el.#children) {
      if (child.tagName === 'raw-text') {
        out.push(child);
      } else if (child.tagName === 'text') {
        LynxElement.#collectRawTextLeaves(child, out);
      }
    }
  }

  /**
   * Cancels a queued removal because the element is being re-inserted (a move).
   * A no-op if the element was not pending (a plain append/insert of a fresh
   * element).
   */
  #cancelPendingRemoval(): void {
    LynxElement.#pendingRemovals.delete(this);
  }

  /**
   * Commits a genuine removal (no re-insert canceled it):
   * __RemoveElement detaches from the native element tree. Note: __RemoveElement
   * does NOT free the element's native pool slot — there is no __ReleaseElement
   * in Lynx's PAPI.
   */
  #doRemove(): void {
    const parent = this.parentNode();
    if (!parent) {
      return;
    }
    // Cancel all active animations and reset animated properties before removal.
    // Lynx's native element pool reuses elements — if an animation is still
    // running (or fill:'forwards' persists the final frame), the stale animation
    // state transfers to whatever new element reuses this pool slot.
    // Canceling + resetting inline styles ensures the pooled element returns clean.
    // Wire protocol constant 3 = ANIMATION_CANCEL (from animation.ts).
    // Canceling a completed animation is harmless — a no-op at the native level.
    for (const id of this.#activeAnimationIds) {
      __ElementAnimate(this.element, [3, id]);
    }
    if (this.#activeAnimationIds.length > 0) {
      // Cancel clears the animation's active effect, but Lynx may leave
      // residual computed values on the element (observed: opacity stays at
      // the initial keyframe value 0 after cancel). Nulling the inline styles
      // forces a full reset so the pooled element has no lingering overrides.
      __AddInlineStyle(this.element, 'opacity', null);
      __AddInlineStyle(this.element, 'transform', null);
      this.#activeAnimationIds.length = 0;
    }
    // Remove the whole subtree in one shot — no "parking" of children elsewhere.
    // This runs ONLY for a genuine destroy: a move (remove-then-reinsert in the
    // same tick) is canceled before it reaches here (see #pendingRemovals), so a
    // moved element keeps its children and is reparented intact.
    //
    // Earlier revisions detached this element's children first and stashed them
    // somewhere safe (the page root, then a `display:none` holder) so that
    // projected content owned by a SURVIVING component could be re-projected after
    // an ancestor `@if` toggled off. That machinery caused two on-device watchdog
    // SIGKILLs: moving a parked child out of the laid-out page root into a deep
    // descendant on re-show livelocked the layout pass, and children of a
    // permanently-destroyed element leaked into the holder forever until tearing
    // that tree down at shell-destroy blew the 5s watchdog. Removing the subtree
    // as a unit sidesteps both — nothing is ever stranded or accumulated.
    //
    // Component-wrapped projection (e.g. `@if(open){ <view><ng-content/></view> }`,
    // the accordion/collapsible shape) survives a re-show via recreate-on-remount:
    // the consumer's projected content is recycled with this wrapper here, its
    // painting node dies, and the next re-insert rebuilds it from cache (see
    // #recreateSubtree). That is why we mark the whole subtree painting-dead just
    // below rather than "parking" the children somewhere to keep them alive.
    __RemoveElement((parent as LynxElement).element, this.element);
    // The native painting nodes of this element and its entire subtree are now
    // gone (Lynx tears them down for a non-move removal — is_move=false). Unlink
    // from the JS parent and mark the subtree painting-dead so the next re-insert
    // rebuilds fresh native elements instead of re-attaching empty ones.
    const jsParent = this.#jsParent;
    if (jsParent) {
      const i = jsParent.#children.indexOf(this);
      if (i >= 0) jsParent.#children.splice(i, 1);
      this.#jsParent = null;
    }
    this.#markPaintingDead();
    // Removing a run from a surviving text shifts its edges (a middle run can
    // become the new last run), so re-derive the former parent's context. Uses
    // jsParent captured above, before #jsParent was nulled.
    if (jsParent && isTextish(this)) {
      LynxElement.#enqueueTextNormalization(jsParent);
    }
  }

  /**
   * Recursively flags this element and every cached descendant painting-dead,
   * mirroring the native painting-node cascade when a subtree is removed. The
   * caches themselves are kept intact — they are exactly what #recreateSubtree
   * replays onto fresh refs.
   */
  #markPaintingDead(): void {
    this.#paintingDead = true;
    for (const child of this.#children) {
      child.#markPaintingDead();
    }
  }

  /**
   * Rebuilds this element from its caches if its painting node was destroyed by
   * a genuine removal. A no-op otherwise, so the common append/move path pays
   * only a single boolean check.
   */
  #recreateIfDead(): void {
    if (!this.#paintingDead) return;
    this.#recreateSubtree();
    // Recreation is the one native-mutating path that bypasses
    // LynxDocument.createElement (it calls createNativeRefByTag directly), so it
    // is also the one place that builds fresh native refs WITHOUT arming the
    // out-of-cycle safety-net flush. A route re-attach (RouterOutlet re-insert)
    // runs OUTSIDE a begin()/end() cycle, so without this the rebuilt subtree
    // would sit unflushed until some unrelated later CD. scheduleSettleFlush is
    // self-guarding (a no-op inside a CD cycle — the @if-toggle path — and during
    // first render) and coalesced, so nested remounts still cost one flush.
    scheduleSettleFlush();
  }

  /**
   * Re-creates a fresh native element for this wrapper and its whole subtree,
   * replaying the cached state onto the new refs. This mirrors React Lynx's
   * "recreate on remount": Lynx cannot resurrect a painting node torn down by a
   * cross-flush removal, so re-attaching the stale ref would render empty. Runs
   * depth-first, bottom-up — children are rebuilt first and re-appended, so the
   * new parent ref owns fresh, live child refs.
   *
   * 'list' and 'page' are never rebuilt: a list is a LynxListElement whose
   * children are driven by update-list-info (not __AppendElement), and the page
   * is the immutable singleton root. Both just clear the flag. (A consequence:
   * a <list> nested directly inside a toggling @if remounts empty — a pre-existing
   * limitation, not a regression, since its ref cannot be rebuilt from a raw tag.)
   */
  #recreateSubtree(): void {
    if (!this.#paintingDead) return;
    this.#paintingDead = false;
    if (this.isRootPageElement || this.tagName === 'list') return;

    // Swapping the native ref changes this wrapper's unique id — move its
    // registry entry from the stale (destroyed) ref's id to the fresh one so
    // parentNode()/#canonicalFor keep resolving to this canonical wrapper.
    this.deregisterNative();
    const fresh = createNativeRefByTag(this.tagName, getPageId(), this.#text);
    this.#nativeRef = fresh;
    LynxElement.#byNativeId.set(__GetElementUniqueID(fresh), this);

    if (this.tagName === 'raw-text') {
      // #text may be stale: normalization is SKIPPED for a subtree while it is
      // #paintingDead (see commitPendingTextNormalization), so a multi-run text
      // removed and re-shown in the same cycle can still be carrying its
      // pre-removal (or even never-yet-trimmed) displayed value here. Queue this
      // leaf so the next drain re-derives the correct positional trim from
      // #rawText — cheap even when unchanged, since #setDisplayedText no-ops.
      // #jsParent is untouched by removal/recreate (only the actually-removed
      // node's own link is cleared — see #doRemove), so root-resolution still
      // finds the right enclosing <text>, whose #paintingDead was already
      // cleared above by the time this leaf's own recreate runs (recreate flips
      // the flag before recursing into children).
      LynxElement.#enqueueTextNormalization(this);
    }

    if (this.#id != null) __SetID(fresh, this.#id);
    // Apply the dataset in one call so recreation is order- and merge-agnostic.
    if (Object.keys(this.#dataset).length > 0) {
      __SetDataset(fresh, this.#dataset);
    }
    for (const [name, value] of this.#attrs) {
      __SetAttribute(fresh, name, value);
    }
    if (this.#classes) __SetClasses(fresh, this.#classes);
    // Whole-string styles first, then per-key overrides — same order as the
    // original setAttribute('style') vs [style.x] application.
    if (this.#inlineStyleWhole != null) {
      __SetInlineStyles(fresh, this.#inlineStyleWhole);
    }
    for (const [key, value] of this.#inlineStyleKeys) {
      __AddInlineStyle(fresh, key, value);
    }
    for (const { eventType, eventName, listener } of this.#listeners) {
      __AddEvent(fresh, eventType, eventName, {
        type: 'worklet',
        value: listener,
      });
    }
    for (const child of this.#children) {
      child.#recreateSubtree();
      __AppendElement(fresh, child.element);
    }
  }

  /**
   * Returns the parent element. For list children, the virtual parent (the JS
   * LynxListElement) is returned instead of the native parent — this maintains
   * the illusion that list children are parented by the list even though they
   * may not be __AppendElement'd to the native list yet (lazy append in
   * componentAtIndex).
   */
  parentNode(): LynxElement | null {
    if (this._virtualParent) return this._virtualParent;
    const parent = __GetParent(this.element);
    if (!parent) return null;
    // Return the CANONICAL wrapper, not a throwaway: Angular uses this as the
    // insertion parent for embedded-view (@if/@for) content, and adopting that
    // content into a throwaway's #children (instead of the canonical parent's)
    // is exactly what made it vanish on route re-entry (see #byNativeId).
    return LynxElement.#canonicalFor(parent);
  }

  nextSibling(): LynxElement | null {
    // If in a virtual tree, use virtual sibling tracking
    if (this._virtualParent) return this._virtualNext;
    const nextSibling = __NextElement(this.element);
    if (!nextSibling) return null;
    // Return the canonical wrapper (see #canonicalFor / parentNode). Angular can
    // hand a nextSibling() result back as a refChild to insertBefore, so it must
    // be the same wrapper whose #children recreation walks — never a throwaway.
    return LynxElement.#canonicalFor(nextSibling);
  }

  querySelector(selector: string): LynxElement | null {
    const element = __QuerySelector(this.element, selector, {});
    if (!element) return null;
    // Canonical wrapper, not a throwaway: a caller that mutates the query result
    // (appendChild, setAttribute) must drive the SAME wrapper the rest of the
    // tree references, or those mutations are lost on the next remount.
    return LynxElement.#canonicalFor(element);
  }
  querySelectorAll(selector: string): LynxElement[] {
    // Same canonical-wrapper requirement as querySelector, per hit.
    return __QuerySelectorAll(this.element, selector, {}).map((e) =>
      LynxElement.#canonicalFor(e),
    );
  }
  /**
   * Invokes a native UI method on this element by name.
   *
   * This is needed because some Lynx native elements expose behavior only
   * through UIMethod calls and have no corresponding @LynxProp handler. The
   * most common case is input/textarea text updates: the native
   * LynxUIBaseInput class has no @LynxProp for "value", so __SetAttribute
   * is a no-op for changing the displayed text after user interaction. The
   * setValue UIMethod is the only way to programmatically update the live
   * text.
   *
   * The result callback is intentionally empty. Callers that need a result
   * (e.g. getValue, boundingClientRect) should use MainThreadElement.invoke(),
   * which returns a Promise. This method covers fire-and-forget cases like
   * setValue where only the side-effect matters.
   */
  invoke(methodName: string, params?: Record<string, unknown>): void {
    __InvokeUIMethod(this.element, methodName, params ?? {}, () => {});
  }

  animate(
    keyframes: Record<string, string | number>[],
    options?: number | LynxAnimationOptions,
  ): LynxAnimation {
    const normalizedOptions =
      typeof options === 'number' ? { duration: options } : (options ?? {});
    const anim = new LynxAnimation(this.element, keyframes, normalizedOptions);
    // Track the animation so remove() can cancel it before the element
    // returns to the native pool. Without this, the pool slot retains
    // stale animation state (e.g. opacity stuck at the FROM keyframe).
    this.#activeAnimationIds.push(anim.id);
    return anim;
  }

  /**
   * Angular's renderer.listen() calls this with event names like 'bindtap',
   * 'catchtouchstart', 'bindscroll', etc. We strip the Lynx event prefix
   * (bind/catch/capture-bind/capture-catch) to extract the native event name
   * and determine the event type for __AddEvent.
   * Events that don't match any prefix (e.g. DOM-style 'click') are silently
   * ignored — Lynx has no equivalent event system for arbitrary names.
   */
  addEventListener(name: string, cb: (event: any) => any) {
    let eventName = '';
    let eventType: LynxEventType | undefined;

    for (const [prefix, type] of EVENT_PREFIXES) {
      if (name.startsWith(prefix)) {
        eventName = name.slice(prefix.length);
        eventType = type;
        break;
      }
    }

    if (!eventType) {
      return () => {};
    }

    /**
     * Lynx's background-thread event objects don't implement the DOM-style
     * stopPropagation()/preventDefault() methods. Lynx only exposes them in
     * main-thread scripts, yet its own .d.ts declares them on every event — so
     * TypeScript never catches the gap. Angular templates (and Angular's own
     * listener wrapper, which calls preventDefault() whenever a handler returns
     * false) assume every event has them, so a handler like
     * `$event.stopPropagation()` throws "not a function" at runtime.
     *
     * Propagation in Lynx is controlled statically by the bind/catch event
     * prefix, and there is no runtime default to prevent, so we inject no-op
     * shims — only when missing, to avoid clobbering the real methods that DO
     * exist in main-thread-script contexts. This gives Angular DOM parity:
     * handlers that call these methods run without crashing. We augment the
     * event before invoking cb (Angular's wrapper may call preventDefault()
     * during that call) and return cb's result (the return-false path relies
     * on it). Mirrors React Lynx's addEventMethodsIfNeeded.
     */
    const listener = (event: any) => {
      if (event && typeof event === 'object') {
        if (typeof event.stopPropagation !== 'function') {
          event.stopPropagation = () => {};
        }
        if (typeof event.preventDefault !== 'function') {
          event.preventDefault = () => {};
        }
        if (typeof event.stopImmediatePropagation !== 'function') {
          event.stopImmediatePropagation = () => {};
        }
      }
      const result = cb(event);
      // Native events are delivered straight to this callback by the Lynx SDK —
      // OUTSIDE Angular's begin()/end() change-detection cycle. So a handler that
      // imperatively mutates the native tree (e.g. `el.setStyle(...)` for a press
      // animation) but changes NO signal schedules no CD, and LynxRendererFactory2
      // .end() therefore never flushes those mutations. On native the effect is a
      // delayed paint; on web (@lynx-js/web-core's offscreen document) the mutation
      // never reaches the real DOM at all, so imperative animations silently do
      // nothing (verified in a headless browser). Schedule the same coalesced
      // safety-net flush used for content built outside a cycle so these mutations
      // commit. It's a near-no-op when nothing is layout-dirty, and if the handler
      // DID change a signal the resulting CD flush runs and this stays a guarded
      // no-op — so there's no double-flush cost.
      scheduleSettleFlush();
      return result;
    };

    // Cache the resolved handler so #recreateSubtree() can re-register it on a
    // rebuilt native ref — native events don't survive a painting-node teardown
    // and can't be read back from the native side, so template `(bind…)` handlers
    // on projected content would go dead after a remount without this.
    const entry = { eventType, eventName, listener };
    this.#listeners.push(entry);

    // type: 'worklet' routes the callback through Lynx's worklet system
    // (runWorklet), which is the only way to receive events in the JS thread.
    // Direct function callbacks also work here (not just worklet handles) —
    // the native engine checks the value type at runtime.
    __AddEvent(this.element, eventType, eventName, {
      type: 'worklet',
      value: listener,
    });

    return () => {
      const i = this.#listeners.indexOf(entry);
      if (i >= 0) this.#listeners.splice(i, 1);
      // Passing undefined as the listener tells the Lynx SDK to remove the
      // corresponding event listener for this type+name combination.
      __AddEvent(this.element, eventType, eventName, undefined);
    };
  }
}

/**
 * Commits all queued genuine element removals — a free-function wrapper over
 * `LynxElement.commitPendingRemovals()` so `LynxRendererFactory2.end()` can
 * drain them (via the lynx-element barrel) right before `__FlushElementTree()`,
 * keeping removals in the same flush as the cycle's other mutations.
 */
export const processPendingRemovals = (): void => {
  LynxElement.commitPendingRemovals();
};

/**
 * Re-derives positional edge whitespace for every text touched this cycle — a
 * free-function wrapper over `LynxElement.commitPendingTextNormalization()` so
 * `LynxRendererFactory2.end()` can drain it (via the lynx-element barrel) right
 * after removals and before `__FlushElementTree()`, keeping the corrected text in
 * the same flush as the cycle's other mutations. See #pendingTextNormalization.
 */
export const processPendingTextNormalization = (): void => {
  LynxElement.commitPendingTextNormalization();
};

let settleFlushScheduled = false;

/**
 * Safety-net flush for native mutations made OUTSIDE a begin()/end() change-
 * detection cycle. `LynxRendererFactory2.end()` calls `__FlushElementTree()`
 * once per CD tick, which is what commits (lays out + paints) the cycle's
 * element mutations. But a lazy-loaded route component is instantiated by
 * `RouterOutlet` DURING navigation — outside any such cycle — so its freshly
 * created elements land in the fiber tree yet are never flushed. On-device
 * symptom: the route's static shell renders, but its `@if`/`@for`/interpolation
 * content stays invisible until an unrelated CD (e.g. a tap) triggers the next
 * end() flush. (Bootstrap sidesteps this via native's implicit post-renderPage
 * flush.) This mirrors the `<list>` path's own guard for the exact same case —
 * see `LynxListElement.#scheduleUpdate`.
 *
 * Called from `LynxDocument`'s element creators — which only ever run on the
 * main thread (the background thread uses LynxBackgroundDocument, which does not
 * touch the native tree), so no thread guard is needed here. It schedules ONE
 * coalesced microtask (matching the list guard's `queueMicrotask`, not
 * `setTimeout` — flushing from a macrotask crashes the native engine), and is a
 * no-op while:
 *  - inside a CD cycle — end() will flush;
 *  - the first render is pending — native flushes after renderPage, and any
 *    `<list>` defers its own first flush (see isFirstRenderPending()).
 * The near-no-op cost when nothing is layout-dirty (the core's `need_layout_`
 * gate) keeps the steady-state overhead negligible.
 */
export const scheduleSettleFlush = (): void => {
  if (
    settleFlushScheduled ||
    isInsideChangeDetection() ||
    isFirstRenderPending()
  ) {
    return;
  }
  settleFlushScheduled = true;
  queueMicrotask(() => {
    settleFlushScheduled = false;
    // A CD cycle began in the meantime — its end() will flush; don't double up
    // (and avoid a re-entrant flush).
    if (isInsideChangeDetection()) return;
    // Mirror end()'s ordering: commit any queued removals, then re-derive text
    // whitespace, so both land in the same flush as the new content (see
    // #pendingRemovals / #pendingTextNormalization). List children are driven by
    // their own update-list-info path, so no list handling here.
    LynxElement.commitPendingRemovals();
    LynxElement.commitPendingTextNormalization();
    __FlushElementTree();
  });
};

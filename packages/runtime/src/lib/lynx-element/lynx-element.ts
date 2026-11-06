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
import { isAndroid } from '../lynx-document/android-blur-capture';
import {
  androidBlurMaterialStyle,
  BLUR_MATERIAL_ATTRIBUTES,
  usesAndroidBlurMaterials,
} from '../lynx-document/android-blur-material';
import { getPageId } from '../lynx-document/page-ref';
import { globalEvents, type LynxGlobalDocument } from '../global-events';
import {
  isFirstRenderPending,
  isInsideChangeDetection,
} from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import { toLynxDisplay, withLynxDisplay } from './display';
import {
  readsSafeAreaInsets,
  safeAreaInsetsStyle,
  withSafeAreaInsets,
} from './safe-area-insets';
import { sanitizeSvgContent } from './svg-content';
import {
  ALL_TEXT_PROPERTIES,
  ANONYMOUS_TEXT_CLASS,
  LAYOUT_FLAG,
  NOT_BLOCK_CONTAINERS,
  TAKES_RAW_TEXT,
  inheritanceStyleFor,
  isBlankText,
  isBlockDisplay,
  isRowOrientation,
  styleFlagsFor,
} from './text-flow';
import {
  type LayoutRect,
  LayoutTracker,
  type LynxDOMRect,
  measureLayout,
  toDOMRect,
} from './layout';
import { POINTER_EVENT_NAMES, PointerEventSource } from './pointer-events';
import { removeNativeHandler } from './remove-native-handler';
import { dropsTap, WebLongPress } from './web-long-press';
import { webVideoDetail } from './web-video';
import {
  type BaseLynxElement,
  DOM_EVENT_ALIASES,
  EVENT_PREFIXES,
  SAME_NAME_DOM_EVENTS,
  type LynxEventType,
} from './types';

type Listener = {
  eventType: LynxEventType;
  eventName: string;
  listener: (event: any) => any;
  /** Runs after the others (see addTrailingEventListener). */
  trailing?: boolean;
};

/**
 * The key native Lynx stores an element's event handler under. It keeps ONE
 * handler per event name (`AttributeHolder::SetStaticEvent` assigns into a map
 * keyed by name), whatever its bind/catch/capture type, so a second
 * `__AddEvent` for `tap` replaces the first. Global events have a map of
 * their own.
 */
const nativeEventKey = (type: LynxEventType, name: string): string =>
  type === 'global-bindEvent' ? `global:${name}` : name;

/**
 * The one type an element's listeners for an event name can be registered
 * with natively (see nativeEventKey). `catch` wins over `bind`: every listener
 * on the element still runs, and the event stops there, as a `catch` listener
 * asked. A capture listener alongside a bubbling one is registered bubbling,
 * since the two phases can't share one native handler.
 */
const combinedEventType = (listeners: Listener[]): LynxEventType => {
  if (listeners[0].eventType === 'global-bindEvent') return 'global-bindEvent';
  const capture = listeners.every((l) => l.eventType.startsWith('capture-'));
  const stops = listeners.some((l) => l.eventType.endsWith('catchEvent'));
  if (capture) return stops ? 'capture-catchEvent' : 'capture-bindEvent';
  return stops ? 'catchEvent' : 'bindEvent';
};

/**
 * Parses a listener name from Angular (`bindtap`, `catchscroll`, `click`, …)
 * into the Lynx event type and name `__AddEvent` takes, or undefined for a
 * name Lynx has no event for.
 */
const parseEventName = (
  name: string,
): Pick<Listener, 'eventType' | 'eventName'> | undefined => {
  const alias = DOM_EVENT_ALIASES.get(name);
  if (alias) return { eventType: 'bindEvent', eventName: alias };
  if (SAME_NAME_DOM_EVENTS.has(name)) {
    return { eventType: 'bindEvent', eventName: name };
  }
  for (const [prefix, eventType] of EVENT_PREFIXES) {
    if (name.startsWith(prefix)) {
      return { eventType, eventName: name.slice(prefix.length) };
    }
  }
  return undefined;
};

/**
 * What the HTML `hidden` attribute gives an element. `display: none` sizes it
 * to 0×0, but on iOS a `<text>` in it still draws its glyphs from that
 * corner; `overflow: hidden` clips them (see "A `display: none` element still
 * draws its text on iOS" in investigations/lynx-vs-web-differences.md).
 */
const HIDDEN_STYLE = 'display: none; overflow: hidden';

/**
 * The inline styles that decide whether an element lays out lines.
 */
const LAYOUT_STYLES: ReadonlySet<string> = new Set([
  'display',
  'linear-orientation',
  'linear-direction',
]);

/**
 * The value an inline style string gives a property, the last if several.
 */
const inlineDeclaration = (
  style: string | null,
  property: string,
): string | undefined => {
  let value: string | undefined;
  for (const declaration of (style ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0 && declaration.slice(0, colon).trim() === property) {
      value = declaration.slice(colon + 1).trim();
    }
  }
  return value;
};

/**
 * Puts a text field's text where a web handler reads it. Lynx sends it in
 * `detail.value` (with `input`, `focus`, `blur` and `confirm`), and a handler
 * written for the browser reads `event.target.value`, as
 * `(input)="name.set($any($event.target).value)"` does. A target with a
 * `value` of its own keeps it.
 */
const fillTargetValue = (event: {
  detail?: { value?: unknown };
  target?: unknown;
}): void => {
  const value = event.detail?.value;
  const target = event.target as Record<string, unknown> | null | undefined;
  if (
    typeof value === 'string' &&
    target &&
    typeof target === 'object' &&
    !('value' in target) &&
    Object.isExtensible(target)
  ) {
    target['value'] = value;
  }
};

/**
 * The `accessibility-traits` value to give an element: the app's own traits
 * plus the ones the runtime adds (see LynxElement.setAccessibilityTrait).
 *
 * iOS reads a comma-separated list with no spaces (`LynxConverter
 * toAccessibilityTraits:` splits on "," and compares each part exactly), so
 * that's what this writes. Android reads a single trait by exact match (none,
 * image or button), so a list would read as none there and drop the app's
 * own `button`; and it has no selected trait to add. So on Android the app's
 * traits are left as they are.
 */
const withAddedTraits = (own: unknown, added: readonly string[]): unknown => {
  if (added.length === 0 || isAndroid()) return own;
  const traits =
    own == null
      ? []
      : String(own)
          .split(',')
          .map((trait) => trait.trim())
          .filter((trait) => trait !== '' && trait !== 'none');
  for (const trait of added) {
    if (!traits.includes(trait)) traits.push(trait);
  }
  return traits.join(',');
};

/**
 * Whether a `setStyle` name is a CSS variable (`--x`), which only
 * `__SetInlineStyles` can set: `__AddInlineStyle` looks the name up as a CSS
 * property and drops it.
 */
const isCustomProperty = (name: string): boolean => name.startsWith('--');

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
 * `element` and its ancestors, nearest first, up to the root of its tree.
 */
const ancestry = (element: ElementRef): ElementRef[] => {
  const path: ElementRef[] = [];
  for (let cur: ElementRef | null = element; cur; cur = __GetParent(cur)) {
    path.push(cur);
  }
  return path;
};

/**
 * True if a flush handles `first`'s child insertions and removals before
 * `second`'s. Lynx's flush (`Element::FlushActions` in
 * `core/renderer/dom/fiber/fiber_element.cc`) walks the element tree in
 * pre-order: an element's own child actions, then each child's subtree in
 * order. So an ancestor goes first, and otherwise the element whose branch
 * comes earlier under the two's nearest common ancestor. Elements in
 * different trees (one not attached yet) have no order, and count as not.
 *
 * Compares by unique ID for the same reason wouldFormCycle does.
 */
const flushesBefore = (first: ElementRef, second: ElementRef): boolean => {
  const firstPath = ancestry(first);
  const secondPath = ancestry(second);
  const secondDepth = new Map(
    secondPath.map((element, depth) => [__GetElementUniqueID(element), depth]),
  );
  for (let depth = 0; depth < firstPath.length; depth++) {
    const shared = secondDepth.get(__GetElementUniqueID(firstPath[depth]!));
    if (shared === undefined) continue;
    // firstPath[depth] is the nearest common ancestor. If it's `first` itself,
    // `first` is the ancestor; if it's `second`, `second` is.
    if (depth === 0) return true;
    if (shared === 0) return false;
    // The common ancestor has both branches among its children.
    const order = __GetChildren(firstPath[depth]!).map((child) =>
      __GetElementUniqueID(child),
    );
    return (
      order.indexOf(__GetElementUniqueID(firstPath[depth - 1]!)) <
      order.indexOf(__GetElementUniqueID(secondPath[shared - 1]!))
    );
  }
  return false;
};

/**
 * Whether this is Lynx's iOS renderer. On the native main thread there is no
 * global `SystemInfo`, only `lynx.SystemInfo` (see isAndroid).
 */
const isIOS = (): boolean => {
  const info =
    (typeof lynx !== 'undefined'
      ? (lynx as { SystemInfo?: { platform?: string } }).SystemInfo
      : undefined) ??
    (typeof SystemInfo !== 'undefined' ? SystemInfo : undefined);
  return info?.platform === 'iOS';
};

/**
 * Gives a new scroll-view or list a `scroll` handler on iOS, so that a
 * listener added later hears its scroll events. iOS's scroll-view
 * (LynxUIScroller) and list (LynxUIListScroll) hand their scroll event
 * manager the element's event set the first time they're told of one, as the
 * UI is made, and never a later one. So a scroll handler added after that is
 * never called, even after a flush: an IntersectionObserver with options adds
 * one once it has measured its element, which is laid out by then. The
 * handler does nothing; the listeners added later share it (see
 * #syncNativeHandler), and Android, which reads the set afresh, needs none.
 */
export const listenForScrollsFromTheStart = (element: LynxElement): void => {
  if (__WEB__ || !isIOS()) return;
  element.addEventListener('bindscroll', ignoreScroll);
};

const ignoreScroll = (): void => {};

/**
 * Whether inserting `child` into `parent` before a sibling would leave it
 * drawing nothing: on iOS, a `<blur-view>` (a UIVisualEffectView) put among a plain
 * element's children anywhere but at the end shows nothing, nor do its
 * children, though the layout keeps its space. That's every blur-view at the
 * top of an `@if`, `@switch` or `@for` block, which Angular inserts before the
 * block's anchor. Appended, it draws, and so it does inside another
 * blur-view, whose native view inserts children its own way.
 */
const insertHidesBlurView = (
  parent: LynxElement,
  child: LynxElement,
): boolean =>
  !__WEB__ &&
  child.tagName === 'blur-view' &&
  parent.tagName !== 'blur-view' &&
  isIOS();

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

  // Tracks animations started on this element via animate().
  // Canceled when the element is destroyed (see #doRemove) to clear stale
  // animation state from Lynx's native element pool — without this, pooled
  // elements retain animation values (e.g. opacity: 0) that poison
  // newly-created elements reusing the slot.
  #activeAnimations: LynxAnimation[] = [];

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
  /**
   * ViewEncapsulation.Emulated's scope classes (see EmulatedLynxRenderer).
   * Angular writes static and bound classes as one whole class string through
   * setAttribute('class'), which would drop them, so they're added back each
   * time.
   */
  #scopeClasses: string[] = [];
  /** Whole-string inline style set via setInlineStyles (style="..."). */
  #inlineStyleWhole: string | null = null;
  /** Per-key inline styles set via setStyle ([style.x] bindings). */
  #inlineStyleKeys = new Map<string, unknown>();
  /**
   * Inline declarations the runtime adds ahead of the app's own style="...":
   * the CSS variables of a blur-view's material on Android (see
   * android-blur-material). Only `__SetInlineStyles` can set a CSS variable;
   * `__AddInlineStyle` drops any name that isn't a CSS property.
   */
  #runtimeStyle = '';
  /**
   * Set by the HTML `hidden` attribute, which Lynx doesn't have: the element
   * gets HIDDEN_STYLE ahead of the app's own inline style, which wins over
   * it, as an author's style wins over a browser's `[hidden]` rule. Also set
   * on an anonymous `<text>` while its text is blank (see isBlankText).
   */
  #hidden = false;
  /**
   * The CSS variables `[style.--x]` bindings set, which go into the inline
   * style string after the app's style="...", for the same reason as
   * #runtimeStyle.
   */
  #customProperties = new Map<string, string>();
  /**
   * Set once any of the inline styles above reads a safe-area inset. They're
   * kept as written, with their env(safe-area-inset-*), and each write fills
   * in the insets the shell sent (see safe-area-insets.ts), so
   * refreshSafeAreaInsets() can write them again when the insets change.
   */
  #readsSafeArea = false;
  /**
   * The app's own `accessibility-traits`, and the traits the runtime adds to
   * them (see setAccessibilityTrait). They're kept apart so that the app
   * setting its traits keeps the runtime's, and the runtime taking one away
   * restores the app's.
   */
  #ownTraits: unknown = null;
  #addedTraits: string[] = [];
  /** Every listener Angular added, in the order it added them. */
  #listeners: Listener[] = [];
  /** How many main-thread directive handlers hold each event (see holdNativeEvent). */
  readonly #heldEvents = new Map<string, number>();
  /** Recognizes long presses on Lynx for Web (see #listenForWebLongPress). */
  #webLongPress: WebLongPress | null = null;
  /** Turns touches into pointer events, once a pointer listener is added. */
  #pointerEvents: PointerEventSource | null = null;
  /**
   * Where the last pointer went down or up on the element, on Lynx for Web,
   * whose pointer events are the browser's (see #addPointerListener).
   */
  #webPointer: { offsetX: number; offsetY: number } | null = null;
  /** The element's layout, once something needs it (see layout.ts). */
  #layout: LayoutTracker | null = null;
  /**
   * The handler registered natively for each event (see nativeEventKey). It
   * runs every listener for that event, since native Lynx keeps only one.
   */
  #nativeHandlers = new Map<
    string,
    {
      eventType: LynxEventType;
      eventName: string;
      dispatch: (event: any) => unknown;
    }
  >();
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
   * An anonymous `<text>`: one the runtime made to draw loose text, and the
   * inline tags beside it, which Angular never sees (see #regroup).
   */
  #anonymous = false;
  /**
   * Made for an HTML inline tag (`span`, `a`, `strong`…), which shares a
   * line with the text beside it (see INLINE_FLOW_TAGS and #regroup).
   */
  #inlineFlow = false;
  /**
   * Made for an HTML text tag (`p`, `span`…) or an anonymous `<text>`: it
   * takes the text styles its ancestors set, as on the web (see
   * text-flow.ts). An element written as a Lynx `<text>` doesn't.
   */
  #webText = false;
  /**
   * The inline declarations that give a #webText element the text styles
   * it inherits: one `var()` for each property its own rules don't set.
   * Ahead of the app's own inline style, which wins over them.
   */
  #inheritStyle = '';
  /**
   * Set once loose text or an inline tag has been a child: the element's
   * children are regrouped when they change, or when its classes do, as
   * they decide whether it lays out lines (see #regroup).
   */
  #hasFlow = false;
  /** Regroup the children when a removed element comes back (see #regroup). */
  #regroupWhenRecreated = false;
  /**
   * On an anchor (`tagName` 'comment'): whether its native element is the
   * empty raw-text it is in a `<text>`, rather than the hidden view
   * LynxDocument makes (see #anchorFor and hydrateAnchor).
   */
  #anchorInText = false;
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
   * Elements with attributes removed this cycle, which reach Lynx only when
   * the cycle flushes (see #removedAttributes).
   */
  static #pendingAttributeRemovals = new Set<LynxElement>();

  /**
   * Elements whose loose text and inline tags may need regrouping (see
   * #regroup), at the end of the cycle, when the cycle's inserts, moves and
   * removals are in. Keyed by the wrapper, never a native ref.
   */
  static #pendingFlow = new Set<LynxElement>();

  /** #webText elements whose inherited styles may have changed. */
  static #pendingInheritance = new Set<LynxElement>();

  /** Set while regrouping, whose own moves don't call for another. */
  static #regrouping = false;

  /**
   * The attributes removed (set to null) since the last flush, which haven't
   * reached Lynx yet. Lynx queues a removal apart from the values set in the
   * same flush and applies it after them (`Element::SetAttribute` puts an
   * empty value in `reset_attr_vec_`, and `ConsumeAllAttributes` resets those
   * after setting `updated_attr_map_`), so an attribute removed and then set
   * again before a flush stayed removed on native. A glass button that a
   * sheet pairs with its glass in the same change detection as the button's
   * first render, for one, kept no `glass-effect-id`. So a removal waits here
   * for the flush, and a value set meanwhile takes it back.
   */
  readonly #removedAttributes = new Set<string>();

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
   *
   * An entry goes when its native ref does: when recreation swaps the ref, and
   * when Angular destroys the element's view (see markDestroyed / #release).
   *
   * Each wrapper is held weakly, as a browser holds a node's JavaScript
   * wrapper. The registry finds wrappers; it mustn't be what keeps one alive.
   * A wrapper in the tree is held by its parent's `#children`, up to the page,
   * which the document holds; one out of the tree that can come back is held
   * by the view Angular keeps it in; one with listeners is held by the
   * handlers on its native element. One that nothing else holds can never be
   * found or used again. Yet a renderer that wraps this one can make elements
   * Angular never inserts or destroys through it: angular-three keeps the
   * element it makes for each `ngt-*` tag, each component host inside a
   * scene and each anchor comment there to itself. Held strongly, those
   * stayed registered for the app's life, with everything they reach: the
   * anchor comment of an `*args` holds its directive's injector, and so the
   * whole screen, its elements and their native UIs (#279), and a scene
   * component's host holds the canvas store, and so the `<canvas>` and its
   * native view (#280).
   */
  static #byNativeId = new Map<number, WeakRef<LynxElement>>();

  /**
   * Deletes a collected wrapper's entry (see #byNativeId). Each registration
   * holds the id it was registered under, never the wrapper, which would keep
   * it alive. Null where the engine has no FinalizationRegistry: the entries
   * left, an id and an empty WeakRef each, are small.
   */
  static #collected: FinalizationRegistry<number> | null =
    typeof FinalizationRegistry === 'function'
      ? new FinalizationRegistry((id) => {
          // A newer element may hold the id now (native ids are reused).
          if (!LynxElement.#byNativeId.get(id)?.deref()) {
            LynxElement.#byNativeId.delete(id);
          }
        })
      : null;

  static #register(id: number, element: LynxElement): void {
    LynxElement.#byNativeId.set(id, new WeakRef(element));
    LynxElement.#collected?.register(element, id);
  }

  static #registered(id: number): LynxElement | undefined {
    return LynxElement.#byNativeId.get(id)?.deref();
  }

  /**
   * Elements Angular destroyed since the last commit (see markDestroyed),
   * released once their removal has committed (see #commitPendingReleases).
   */
  static #pendingReleases = new Set<LynxElement>();

  /**
   * Set when Angular destroys this element, until it's released (see
   * #release) or put back in the tree.
   */
  #destroyed = false;

  /**
   * Returns the canonical wrapper driving `ref`, or a fresh wrapper if none is
   * registered (an element never created through LynxDocument, e.g. a raw query
   * hit). Read-only callers (parentNode/nextSibling/querySelector) use this so
   * they never mint a competing throwaway for an element that already has a
   * canonical wrapper.
   */
  static #canonicalFor(ref: ElementRef): LynxElement {
    const existing = LynxElement.#registered(__GetElementUniqueID(ref));
    return existing ?? new LynxElement(ref);
  }

  /**
   * @internal The canonical wrapper of the element with this unique id, if
   * it has one: the target of a touch the document heard (see
   * global-events/native-source.ts), which names the element by its id.
   */
  static byUniqueId(uniqueId: number): LynxElement | undefined {
    const element = LynxElement.#registered(uniqueId);
    // A touch on loose text is its element's, as a text node's is in a
    // browser: the anonymous <text> around it isn't one of the app's, and
    // out of the tree it has no element to stand for.
    if (element && element.#anonymous) {
      return element.parentNode() ?? undefined;
    }
    return element;
  }

  constructor(element: ElementRef) {
    this.#nativeRef = element;
    // Register as the canonical wrapper for this native ref. #canonicalFor()
    // checks the map before constructing, so this never overwrites an existing
    // canonical wrapper with a throwaway.
    LynxElement.#register(__GetElementUniqueID(element), this);
  }

  /**
   * Drops this wrapper's current native id from the registry. Called when the
   * native ref is swapped (recreate-on-remount) for the STALE id, and when the
   * element is released after Angular destroyed it (see #release), so the
   * registry doesn't retain wrappers for dead native refs.
   */
  deregisterNative(): void {
    const id = __GetElementUniqueID(this.#nativeRef);
    // Only clear if WE are the registered wrapper — a later element that reused
    // this id (native id reuse) must keep its entry.
    if (LynxElement.#registered(id) === this) {
      LynxElement.#byNativeId.delete(id);
    }
  }

  /**
   * @internal Angular destroyed this element: the renderer's destroyNode.
   *
   * Angular calls destroyNode only for a destroyed view's top-level nodes.
   * `destroyLView` walks them with `applyView`, which never descends into an
   * element's children, and the views nested in it (embedded views, child
   * components' views) are cleaned up by `destroyViewTree` without the
   * renderer. So this element releases its whole subtree (see #release),
   * whatever views the elements under it belong to.
   *
   * It waits for the commit at the end of the cycle (see
   * #commitPendingReleases), when the cycle's moves are done: an element
   * moved out of the subtree in the meantime, as CDK's DomPortal hands its
   * element back when it's destroyed, isn't under this one any more and
   * stays registered. An element still in the tree then (a leave animation
   * delays Angular's removal) is released when its removal commits.
   */
  markDestroyed(): void {
    // The page is the app's root and is never removed (see remove()).
    if (this.isRootPageElement) return;
    this.#destroyed = true;
    LynxElement.#pendingReleases.add(this);
    // A view destroyed outside change detection (a detached route view the
    // reuse strategy drops) has no end() to commit it.
    scheduleSettleFlush();
  }

  /**
   * @internal The children this element keeps out of `#children`, which a
   * release must reach too: a list's items (see LynxListElement). None here.
   */
  virtualChildren(): LynxElement[] {
    return [];
  }

  /**
   * The document stand-in (see global-events), as a DOM element's is its
   * document. Angular resolves a `document:` or `body:` host listener's
   * target from it, and a `window:` one from its `defaultView`.
   */
  get ownerDocument(): LynxGlobalDocument {
    return globalEvents().document;
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
    // HTML's `hidden`, as `[hidden]="!open()"` or a bare `hidden` sets it.
    // Like any boolean attribute, it hides whenever it's there, whatever its
    // value; a `false` property binding or a removal takes it away.
    if (name === 'hidden') {
      this.#setHidden(value != null && value !== false);
      return;
    }
    // An `<img>`'s `alt` (an `<img>` is an `<image>`, see web-tags.ts) is what
    // a screen reader says for it, which Lynx calls `accessibility-label`.
    // An `<image>` is an accessibility element already, so it's read.
    if (name === 'alt' && this.tagName === 'image') {
      name = 'accessibility-label';
    }
    if (name === 'class') {
      // Use __SetClasses (not __AddClass) because setAttribute replaces the
      // entire class attribute with a space-separated list. __AddClass treats
      // its argument as a single class name — passing 'foo bar baz' would set
      // the literal class 'foo bar baz' rather than three separate classes,
      // so no CSS rule would ever match. __SetClasses correctly parses the
      // space-separated list. This matches how React Lynx handles className.
      const classes = [
        ...new Set([
          ...String(value ?? '')
            .split(/\s+/)
            .filter(Boolean),
          ...this.#scopeClasses,
        ]),
      ].join(' ');
      __SetClasses(this.element, classes);
      this.#classes = classes;
      this.#rulesChanged();
    } else if (name === 'style') {
      this.setInlineStyles(value);
    } else if (name === 'id') {
      __SetID(this.element, value);
      this.#id = value ?? null;
      this.#rulesChanged();
    } else if (name.startsWith('data-')) {
      const data: Record<string, any> = {};
      const key = name.slice(5);
      data[key] = value;
      __SetDataset(this.element, data);
      this.#dataset[key] = value;
    } else {
      // A stroke-dasharray the engine can't parse hangs Lynx's native SVG engine and
      // blanks every <svg> in the app (see svg-content.ts), so it's rewritten
      // before it leaves JS. The cleaned value is also what's mirrored below,
      // so a recreated element gets it too.
      if (
        this.tagName === 'svg' &&
        name === 'content' &&
        typeof value === 'string'
      ) {
        value = sanitizeSvgContent(value);
      }
      if (name === 'accessibility-traits') {
        this.#ownTraits = value ?? null;
        value = withAddedTraits(this.#ownTraits, this.#addedTraits);
      }
      if (value == null) {
        // At the flush, unless it's set again first: see #removedAttributes.
        this.#removedAttributes.add(name);
        LynxElement.#pendingAttributeRemovals.add(this);
        scheduleSettleFlush();
      } else {
        this.#removedAttributes.delete(name);
        __SetAttribute(this.element, name, value);
      }
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
        // Its anonymous <text> hides while all it holds is blank.
        const parent = this.#jsParent;
        if (parent && parent.#anonymous && parent.#jsParent) {
          LynxElement.#pendingFlow.add(parent.#jsParent);
        }
      }
      if (this.tagName === 'blur-view' && BLUR_MATERIAL_ATTRIBUTES.has(name)) {
        this.updateBlurMaterial();
      }
    }
  }

  /**
   * On Android, gives a blur-view the CSS variables that approximate its iOS
   * material (see android-blur-material). LynxDocument calls it when it
   * creates one, and setAttribute whenever an attribute it depends on changes.
   */
  updateBlurMaterial(): void {
    if (usesAndroidBlurMaterials()) {
      this.#setRuntimeStyle(androidBlurMaterialStyle(this.#attrs));
    }
  }

  /**
   * Gives the page the CSS variables that carry the safe-area insets to the
   * stylesheets, whose `env(safe-area-inset-*)` the build plugin makes read
   * them (see safe-area-insets.ts). followSafeAreaInsets calls it on the page
   * when it's created and whenever the insets change, as they do on
   * rotation. They're the page's runtime style, so the app's own style on
   * `<page>` doesn't drop them. The page is never a blur-view, whose material
   * uses the same slot.
   */
  updateSafeAreaInsets(): void {
    this.#setRuntimeStyle(safeAreaInsetsStyle());
  }

  /**
   * Writes the inline styles of every element that reads a safe-area inset
   * again, with the insets the shell just sent (see #readsSafeArea). Lynx
   * resolves no `var()` inside a `calc()` in an inline style, so they can't
   * follow a CSS variable as the stylesheets do. The insets change rarely:
   * on rotation, and once at launch on iOS.
   */
  static refreshSafeAreaInsets(): void {
    for (const ref of LynxElement.#byNativeId.values()) {
      const element = ref.deref();
      if (element && element.#readsSafeArea) element.#rewriteInlineStyle();
    }
  }

  /**
   * Adds `trait` to the app's own `accessibility-traits`, or takes it away.
   * The app can still set its traits at any time: setAttribute merges the two
   * (see withAddedTraits), so neither undoes the other.
   */
  setAccessibilityTrait(trait: string, on: boolean): void {
    if (this.#addedTraits.includes(trait) === on) return;
    this.#addedTraits = on
      ? [...this.#addedTraits, trait]
      : this.#addedTraits.filter((added) => added !== trait);
    this.setAttribute('accessibility-traits', this.#ownTraits);
  }

  getAttribute(name: string) {
    return __GetAttributeByName(this.element, name) as string;
  }

  removeAttribute(name: string): void {
    this.setAttribute(name, null);
  }

  setStyle(key: string, value: unknown): void {
    if (isCustomProperty(key)) {
      // Angular removes a binding's style with an empty or null value too.
      if (value == null || value === '') {
        this.removeStyle(key);
        return;
      }
      const text = String(value);
      if (this.#customProperties.get(key) === text) return;
      this.#customProperties.set(key, text);
      if (readsSafeAreaInsets(text)) this.#readsSafeArea = true;
      this.#rewriteInlineStyle();
      return;
    }
    // `[style.display]="open ? 'block' : 'none'"` would lay the element out
    // as a row: Lynx has no block layout (see display.ts).
    if (key === 'display') value = toLynxDisplay(value);
    // `[style.padding-bottom]="'calc(1rem + env(safe-area-inset-bottom))'"`
    // gets the inset the shell sends (see safe-area-insets.ts), and is kept
    // as written to get the next one.
    if (readsSafeAreaInsets(value)) this.#readsSafeArea = true;
    __AddInlineStyle(this.element, key, withSafeAreaInsets(value));
    this.#inlineStyleKeys.set(key, value);
    if (LAYOUT_STYLES.has(key)) this.#layoutChanged();
  }
  removeStyle(key: string): void {
    if (isCustomProperty(key)) {
      if (this.#customProperties.delete(key)) this.#rewriteInlineStyle();
      return;
    }
    __AddInlineStyle(this.element, key, null);
    this.#inlineStyleKeys.delete(key);
    if (LAYOUT_STYLES.has(key)) this.#layoutChanged();
  }
  setInlineStyles(inlineStyle: string): void {
    // A `style="display: block"` lays out as Lynx's `linear`, as a
    // `[style.display]` binding does (see setStyle). Angular passes null when
    // it removes the attribute.
    if (typeof inlineStyle === 'string') {
      inlineStyle = withLynxDisplay(inlineStyle);
      // Its env(safe-area-inset-*) get the insets as in setStyle.
      if (readsSafeAreaInsets(inlineStyle)) this.#readsSafeArea = true;
    }
    __SetInlineStyles(this.element, this.#inlineStyleFor(inlineStyle));
    this.#inlineStyleWhole = inlineStyle;
    this.#layoutChanged();
  }

  /**
   * The element's classes or id changed: so may the text styles it sets
   * itself, which it doesn't inherit, and whether it lays out lines.
   */
  #rulesChanged(): void {
    if (this.#webText && !this.#anonymous) {
      LynxElement.#pendingInheritance.add(this);
    }
    this.#layoutChanged();
  }

  /**
   * Its layout may have changed: its loose text may need regrouping.
   */
  #layoutChanged(): void {
    if (this.#hasFlow) LynxElement.#pendingFlow.add(this);
  }

  /**
   * The tokens a style index rule's selector can require of this element
   * (see styleFlagsFor): its classes, its id and its tag.
   */
  #styleTokens(): Set<string> {
    const tokens = new Set(this.#classes.split(/\s+/).filter(Boolean));
    if (this.#id) tokens.add(`#${this.#id}`);
    tokens.add(`<${this.tagName}>`);
    return tokens;
  }

  /**
   * Whether the children lay out in a column, as a block's do, where text
   * and inline tags share lines: a view-like element whose CSS sets no other
   * `display` and no row (see text-flow.ts).
   */
  #laysOutLines(): boolean {
    if (NOT_BLOCK_CONTAINERS.has(this.tagName)) return false;
    const inline = (property: string): unknown =>
      this.#inlineStyleKeys.get(property) ??
      inlineDeclaration(this.#inlineStyleWhole, property);
    if (!isBlockDisplay(inline('display'))) return false;
    if (
      isRowOrientation(inline('linear-orientation')) ||
      isRowOrientation(inline('linear-direction'))
    ) {
      return false;
    }
    return !(styleFlagsFor(this.#styleTokens()) & LAYOUT_FLAG);
  }

  /**
   * Gives a #webText element the inherited value of each text style its own
   * rules don't set (see #inheritStyle). An anonymous `<text>` has no rules
   * of its own, and takes them all.
   */
  #applyInheritance(): void {
    const own = this.#anonymous
      ? 0
      : styleFlagsFor(this.#styleTokens()) & ALL_TEXT_PROPERTIES;
    const style = inheritanceStyleFor(own);
    if (style === this.#inheritStyle) return;
    this.#inheritStyle = style;
    // One removed this cycle gets it when it's rebuilt (see #recreateSubtree).
    if (!this.#paintingDead) this.#rewriteInlineStyle();
  }

  /**
   * @internal Marks an element LynxDocument made for an HTML text tag (see
   * WEB_TEXT_TAGS), and whether the tag is inline (see INLINE_FLOW_TAGS).
   */
  markWebText(inline: boolean): void {
    this.#webText = true;
    this.#inlineFlow = inline;
    LynxElement.#pendingInheritance.add(this);
  }

  /**
   * @internal An anchor a server render made: an empty raw-text if it was in
   * a `<text>` (see #anchorFor), which the snapshot holds as it was.
   */
  hydrateAnchor(): void {
    this.#anchorInText = __GetTag(this.element) === 'raw-text';
  }

  /**
   * @internal Marks an anonymous `<text>` that a server render made, which
   * the snapshot holds (see LynxHydrateDocument).
   */
  markAnonymousText(): void {
    this.tagName = 'text';
    this.#anonymous = true;
    this.#webText = true;
  }

  /**
   * The whole inline style to give the native element: the runtime's
   * declarations first (`hidden`'s HIDDEN_STYLE, then #runtimeStyle), so
   * the app's own wins where both set the same name,
   * then the app's style="...", then its `[style.--x]` variables, which win
   * over the attribute as bindings do on the web. Without runtime
   * declarations or variables it's the app's value as is.
   */
  #withRuntimeStyle(inlineStyle: string | null): string | null {
    if (
      !this.#hidden &&
      !this.#inheritStyle &&
      !this.#runtimeStyle &&
      this.#customProperties.size === 0
    ) {
      return inlineStyle;
    }
    const variables = [...this.#customProperties]
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ');
    return [
      this.#hidden ? HIDDEN_STYLE : '',
      this.#inheritStyle,
      this.#runtimeStyle,
      inlineStyle?.replace(/[\s;]+$/, ''),
      variables,
    ]
      .filter(Boolean)
      .join('; ');
  }

  /**
   * The whole inline style to give the native element (see
   * #withRuntimeStyle), with the safe-area insets filled in.
   */
  #inlineStyleFor(inlineStyle: string | null): string | null {
    return withSafeAreaInsets(this.#withRuntimeStyle(inlineStyle));
  }

  #setRuntimeStyle(style: string): void {
    if (style === this.#runtimeStyle) return;
    this.#runtimeStyle = style;
    this.#rewriteInlineStyle();
  }

  #setHidden(hidden: boolean): void {
    if (hidden === this.#hidden) return;
    this.#hidden = hidden;
    this.#rewriteInlineStyle();
  }

  /**
   * Gives the native element its whole inline style again.
   */
  #rewriteInlineStyle(): void {
    __SetInlineStyles(
      this.element,
      this.#inlineStyleFor(this.#inlineStyleWhole),
    );
    // __SetInlineStyles replaces every inline style, including the [style.x]
    // ones __AddInlineStyle set, which the app didn't ask to drop.
    for (const [key, value] of this.#inlineStyleKeys) {
      __AddInlineStyle(this.element, key, withSafeAreaInsets(value));
    }
  }

  insertBefore(newChild: LynxElement, refChild: LynxElement | null): void {
    if (newChild.isRootPageElement) return;
    if (this.#holdsFlow()) {
      this.#flowInsert(newChild, refChild);
    } else {
      this.#attach(newChild, refChild);
    }
  }

  /**
   * Puts `newChild` before `refChild` (or at the end) in the native tree,
   * and in #children: insertBefore and appendChild without the regrouping
   * of loose text, which #regroup itself uses.
   */
  #attach(newChild: LynxElement, refChild: LynxElement | null): void {
    // A queued removal immediately followed by a re-insert is an Angular MOVE —
    // cancel the removal so the element keeps its children. It is still natively
    // attached to its old parent, so __InsertElementBefore auto-reparents the
    // whole subtree (see #pendingRemovals).
    newChild.#cancelPendingRemoval();
    newChild.#keepIfDestroyed();
    newChild.#removeIfMoveWouldBeLost(this);
    // If the child was genuinely removed in a PREVIOUS cycle its native painting
    // node is gone — rebuild a fresh native element + subtree before re-attaching
    // (see #recreateSubtree). A same-tick move was canceled just above and is
    // never painting-dead, so the fast move path pays only a boolean check.
    newChild.#recreateIfDead();
    newChild.#anchorFor(this);
    if (refChild == null) {
      this.#append(newChild);
    } else {
      // Never insert an element into its own subtree — Lynx would build a cyclic
      // native tree and hang the layout pass (see wouldFormCycle). Skipping is
      // safe: a cyclic insert is a corrupt request, and leaving newChild where it
      // is beats freezing the app.
      if (wouldFormCycle(this.element, newChild.element)) return;
      if (insertHidesBlurView(this, newChild)) {
        this.#appendBefore(newChild, refChild);
      } else {
        __InsertElementBefore(this.element, newChild.element, refChild.element);
      }
      this.#adoptChild(newChild, refChild);
      if (isTextish(this) || isTextish(newChild)) {
        LynxElement.#enqueueTextNormalization(newChild);
      }
    }
  }

  /**
   * Puts `newChild` before `refChild` by appending it, then moving `refChild`
   * and every native sibling after it to the end behind it, in order: the
   * same order as `__InsertElementBefore`, reached only by appends (see
   * insertHidesBlurView). The moves are in the same flush as the insert, so
   * the siblings keep their painting nodes, as any Angular move does.
   */
  #appendBefore(newChild: LynxElement, refChild: LynxElement): void {
    const childId = __GetElementUniqueID(newChild.element);
    const following: ElementRef[] = [];
    for (
      let sibling: ElementRef | null = refChild.element;
      sibling;
      sibling = __NextElement(sibling)
    ) {
      if (__GetElementUniqueID(sibling) !== childId) following.push(sibling);
    }
    __AppendElement(this.element, newChild.element);
    for (const sibling of following) {
      __AppendElement(this.element, sibling);
    }
  }

  appendChild(newChild: LynxElement): void {
    if (newChild.isRootPageElement) return;
    if (this.#holdsFlow()) {
      this.#flowInsert(newChild, null);
    } else {
      this.#append(newChild);
    }
  }

  #append(newChild: LynxElement): void {
    // See insertBefore: cancel a pending removal so a move keeps its subtree,
    // then rebuild the child if its painting node was destroyed in a prior cycle.
    newChild.#cancelPendingRemoval();
    newChild.#keepIfDestroyed();
    newChild.#removeIfMoveWouldBeLost(this);
    newChild.#recreateIfDead();
    newChild.#anchorFor(this);
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
      // Defensive: if newChild is tracked as a child of `prev`, indexOf always
      // finds it. The i < 0 branch would only fire on a bookkeeping mismatch
      // that shouldn't happen through the public API.
      /* v8 ignore next */
      if (i >= 0) prev.#children.splice(i, 1);
      // The loose text it leaves may need regrouping (see #regroup).
      if (prev !== this && !LynxElement.#regrouping) {
        const holder = prev.#anonymous ? prev.#jsParent : prev;
        if (holder && holder.#hasFlow) LynxElement.#pendingFlow.add(holder);
      }
    }
    newChild.#jsParent = this;
    if (refChild) {
      const idx = this.#children.indexOf(refChild);
      // Defensive: refChild always sits in #children when it's used as an
      // anchor for insertBefore. If a caller passes a foreign refChild, fall
      // back to appending at the tail rather than throwing.
      /* v8 ignore next */
      this.#children.splice(idx < 0 ? this.#children.length : idx, 0, newChild);
    } else {
      this.#children.push(newChild);
    }
  }

  /**
   * Gives an anchor going into `parent` the native element it needs there.
   * Angular's anchors for `@if`, `@for` and the like are hidden views (see
   * createCommentElement), and on iOS a hidden view in a `<text>` leaves a
   * gap and an empty line, wherever Angular put it: `<text>Hi @if (x)
   * {…}</text>`, or a line #regroup made around one. In a `<text>`, an anchor
   * is an empty raw-text, which draws nothing anywhere. It has no attributes,
   * children or handlers, so the swap is the native element alone.
   */
  #anchorFor(parent: LynxElement): void {
    if (this.tagName !== 'comment') return;
    const inText = parent.tagName === 'text';
    if (inText === this.#anchorInText) return;
    const old = this.element;
    const oldParent = __GetParent(old);
    if (oldParent) __RemoveElement(oldParent, old);
    this.deregisterNative();
    this.#nativeRef = inText
      ? __CreateRawText('')
      : createNativeRefByTag('comment', getPageId());
    LynxElement.#register(__GetElementUniqueID(this.#nativeRef), this);
    this.#anchorInText = inText;
  }

  /**
   * Whether loose text and inline tags among this element's children are
   * regrouped (see #regroup): any element that doesn't take raw text as it
   * is (see TAKES_RAW_TEXT), and isn't an anonymous `<text>` itself.
   */
  #holdsFlow(): boolean {
    return !this.#anonymous && !TAKES_RAW_TEXT.has(this.tagName);
  }

  /**
   * Whether this is loose text or an inline tag, which shares a line with
   * the text and inline tags beside it (see #regroup).
   */
  #flows(): boolean {
    return this.tagName === 'raw-text' || this.#inlineFlow;
  }

  /**
   * Inserts `child` into this element, keeping Angular's order of its
   * children, which is the native order with each anonymous `<text>` opened
   * up. A `refChild` in an anonymous `<text>` takes loose text and inline
   * tags in beside it; anything else splits the anonymous `<text>` there.
   * Which text shares which `<text>` is decided at the end of the cycle, all
   * at once (see #regroup), so until then loose text may sit in this element
   * as it is: nothing is drawn before then.
   */
  #flowInsert(child: LynxElement, refChild: LynxElement | null): void {
    const wrapper = refChild ? refChild.#jsParent : null;
    if (
      refChild &&
      wrapper &&
      wrapper.#anonymous &&
      wrapper.#jsParent === this
    ) {
      if (child.#flows()) {
        wrapper.#attach(child, refChild);
      } else {
        this.#attach(child, this.#splitBefore(wrapper, refChild));
      }
      LynxElement.#pendingFlow.add(this);
      return;
    }
    this.#attach(child, refChild);
    if (child.#flows()) this.#hasFlow = true;
    if (this.#hasFlow) LynxElement.#pendingFlow.add(this);
  }

  /**
   * Moves `member` and the members after it in `wrapper`, one of this
   * element's anonymous texts, to a new one just after it, and returns that.
   * An element that isn't text can then go between the two.
   */
  #splitBefore(wrapper: LynxElement, member: LynxElement): LynxElement {
    const moving = wrapper.#children.slice(wrapper.#children.indexOf(member));
    const after = this.#children[this.#children.indexOf(wrapper) + 1] ?? null;
    const split = LynxElement.#anonymousText();
    this.#attach(split, after);
    for (const node of moving) split.#attach(node, null);
    return split;
  }

  /**
   * A new anonymous `<text>` (see #anonymous).
   */
  static #anonymousText(): LynxElement {
    const text = new LynxElement(createNativeRefByTag('text', getPageId()));
    text.tagName = 'text';
    text.#anonymous = true;
    text.#webText = true;
    text.addClass(ANONYMOUS_TEXT_CLASS);
    text.#applyInheritance();
    return text;
  }

  /**
   * Draws this element's loose text and inline tags, as a browser would.
   * Lynx draws text only inside a `<text>`, and lays out lines only there,
   * so each run of raw-texts and inline tags (`span`, `a`…) goes in an
   * anonymous `<text>`, which Angular never sees: the raw-text stands for it
   * (see parentNode() and nextSibling()). Then:
   *
   * - **In an element that lays out lines** (#laysOutLines), as a block
   *   does, a run shares one `<text>`, so `<div>Hi <b>there</b></div>` is
   *   one line. A lone inline tag stays as it is: a `<text>` already.
   * - **In a flex or grid container,** or a row, each element is an item of
   *   its own, as on the web: each raw-text gets a `<text>` of its own, and
   *   an inline tag stays as it is.
   *
   * Angular's anchors for `@if` and `@for` end a run: on iOS a hidden view
   * in a `<text>` leaves a gap. A `<text>` holding only blank text is hidden,
   * since a browser gives blank text no box and Lynx gives it a line.
   *
   * Runs at the end of the cycle, before the flush (see commitPendingFlow),
   * and changes only what differs, so a cycle that leaves the text as it was
   * changes nothing.
   */
  #regroup(): void {
    // Angular's order of the children: each anonymous <text> opened up.
    const nodes: LynxElement[] = [];
    for (const child of this.#children) {
      if (child.#anonymous) nodes.push(...child.#children);
      else nodes.push(child);
    }
    const lines = this.#laysOutLines();
    const plan: (LynxElement | LynxElement[])[] = [];
    let run: LynxElement[] = [];
    const endRun = (): void => {
      const members = run.filter((node) => node.#flows());
      if (lines && (members.length > 1 || members[0]?.tagName === 'raw-text')) {
        plan.push(run);
      } else {
        for (const node of run) {
          plan.push(node.tagName === 'raw-text' ? [node] : node);
        }
      }
      run = [];
    };
    // An anchor between two members of a run stays in it, as an empty
    // raw-text (see #anchorFor), so `{{ n }} @if (…) {items} @else {item}` is
    // one line. One at either end stays out.
    let anchors: LynxElement[] = [];
    for (const node of nodes) {
      if (node.#flows()) {
        if (run.length > 0) run.push(...anchors);
        else plan.push(...anchors);
        anchors = [];
        run.push(node);
      } else if (node.tagName === 'comment' && run.length > 0) {
        anchors.push(node);
      } else {
        endRun();
        plan.push(...anchors, node);
        anchors = [];
      }
    }
    endRun();
    plan.push(...anchors);

    // Make the native children follow the plan, reusing anonymous texts.
    const used = new Set<LynxElement>();
    let at = 0;
    for (const item of plan) {
      const target = Array.isArray(item) ? this.#textFor(item, used) : item;
      if (this.#children[at] !== target) {
        this.#attach(target, this.#children[at] ?? null);
      }
      at++;
      if (!Array.isArray(item)) continue;
      item.forEach((member, index) => {
        if (target.#children[index] !== member) {
          target.#attach(member, target.#children[index] ?? null);
        }
      });
      // Its edges may have moved, when a member left for another line.
      LynxElement.#enqueueTextNormalization(target);
      target.#setHidden(
        item.every((member) =>
          member.tagName === 'raw-text'
            ? isBlankText(member.#rawText)
            : member.tagName === 'comment',
        ),
      );
    }
    // What's left are anonymous texts the plan has no use for, which every
    // member has left by now.
    for (const unused of this.#children.slice(at)) {
      unused.#destroyed = true;
      unused.#doRemove();
    }
    this.#hasFlow = nodes.some((node) => node.#flows());
  }

  /**
   * The anonymous `<text>` for a run: one a member is in already, if it's
   * this element's and no other run has it, or a new one.
   */
  #textFor(run: LynxElement[], used: Set<LynxElement>): LynxElement {
    for (const member of run) {
      const parent = member.#jsParent;
      if (
        parent &&
        parent.#anonymous &&
        parent.#jsParent === this &&
        !used.has(parent)
      ) {
        used.add(parent);
        return parent;
      }
    }
    const text = LynxElement.#anonymousText();
    used.add(text);
    return text;
  }

  addClass(name: string): void {
    __AddClass(this.element, name);
    // Keep the cached class string in sync (deduped) so recreation replays the
    // full class list in one __SetClasses.
    const set = new Set(this.#classes.split(/\s+/).filter(Boolean));
    set.add(name);
    this.#classes = [...set].join(' ');
    this.#rulesChanged();
  }

  addScopeClass(name: string): void {
    if (this.#scopeClasses.includes(name)) return;
    this.#scopeClasses.push(name);
    this.addClass(name);
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
    this.#rulesChanged();
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
    // "__PROFILE__ is not defined"). Vitest's config sets it to `false`, so
    // the increment is dead code from the test bundle's point of view.
    /* v8 ignore next */
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
  /**
   * Sends Lynx the attribute removals that weren't taken back this cycle
   * (see #removedAttributes). Called by `LynxRendererFactory2.end()` and the
   * settle flush, after removals and before `__FlushElementTree()`, so the
   * removals land in the same flush as the cycle's other mutations.
   */
  static commitPendingAttributeRemovals(): void {
    if (LynxElement.#pendingAttributeRemovals.size === 0) return;
    const elements = [...LynxElement.#pendingAttributeRemovals];
    LynxElement.#pendingAttributeRemovals.clear();
    for (const el of elements) {
      for (const name of el.#removedAttributes) {
        __SetAttribute(el.element, name, null);
      }
      el.#removedAttributes.clear();
    }
  }

  static commitPendingRemovals(): void {
    if (LynxElement.#pendingRemovals.size > 0) {
      const items = [...LynxElement.#pendingRemovals];
      LynxElement.#pendingRemovals.clear();
      for (const el of items) {
        el.#doRemove();
      }
    }
    LynxElement.#commitPendingReleases();
  }

  /**
   * Releases the elements Angular destroyed this cycle (see markDestroyed)
   * that are out of the tree. Runs after the removals, so an element whose
   * removal just committed was released by it (see #doRemove); what's left
   * here was already out: a list item (its list keeps it until the list
   * updates), or a view Angular destroyed after detaching it earlier.
   */
  static #commitPendingReleases(): void {
    if (LynxElement.#pendingReleases.size === 0) return;
    const elements = [...LynxElement.#pendingReleases];
    LynxElement.#pendingReleases.clear();
    for (const el of elements) {
      // Still in the tree: released when its removal commits.
      if (el.#destroyed && !el.#jsParent && !el._virtualParent) el.#release();
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
  /**
   * Regroups the loose text of every element whose children or classes
   * changed this cycle (see #regroup), then gives the HTML text elements
   * whose classes changed the text styles they inherit. Called by
   * `processPendingFlow()` from `end()` and the settle flush, after removals
   * (so emptied anonymous texts go) and before text normalization and the
   * flush, so the regrouped text is trimmed and drawn in the same pass.
   */
  static commitPendingFlow(): void {
    LynxElement.#regrouping = true;
    try {
      const parents = [...LynxElement.#pendingFlow];
      LynxElement.#pendingFlow.clear();
      for (const parent of parents) {
        if (parent.#paintingDead) {
          // Removed (or released): its native elements are gone, and come
          // back rebuilt from #children if it's shown again, when it
          // regroups.
          parent.#regroupWhenRecreated = true;
        } else {
          parent.#regroup();
        }
      }
    } finally {
      LynxElement.#regrouping = false;
    }
    const elements = [...LynxElement.#pendingInheritance];
    LynxElement.#pendingInheritance.clear();
    for (const element of elements) element.#applyInheritance();
  }

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
    // The caller (commitPendingTextNormalization) resolves to the outermost
    // text root before enqueuing, so in practice `root` is always a <text>
    // (raw-text under a text becomes the parent). The raw-text and
    // empty-leaves branches are defensive; kept to preserve the pass's
    // single-context contract if a future call path enqueues a bare leaf.
    /* v8 ignore start */
    const leaves: LynxElement[] = root.tagName === 'raw-text' ? [root] : [];
    if (root.tagName === 'text') {
      LynxElement.#collectRawTextLeaves(root, leaves);
    }
    if (leaves.length === 0) return;
    /* v8 ignore stop */

    const displayed: string[] = [];
    let pendingSpace = false;
    let seenNonEmpty = false;
    for (const leaf of leaves) {
      // #rawText is seeded on every raw-text via setInitialText or the 'text'
      // attribute path; the `?? ''` fallback covers a synthesized leaf without
      // a raw source, which never happens in practice.
      /* v8 ignore next */
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
   * Cancels a release Angular asked for (see markDestroyed) because the
   * element is going back in the tree: whoever puts it back still uses it.
   */
  #keepIfDestroyed(): void {
    if (!this.#destroyed) return;
    this.#destroyed = false;
    LynxElement.#pendingReleases.delete(this);
  }

  /**
   * Before this element moves under `newParent`: removes it for good if Lynx
   * would lose the move, so the insert that follows rebuilds it (see
   * #recreateIfDead) instead.
   *
   * Native Lynx (4.1) loses a move to another parent when the flush reaches
   * the new parent first. `__AppendElement` and `__InsertElementBefore` queue
   * the removal on the old parent and the insertion on the new one, and the
   * flush handles each parent's queue in tree order (see flushesBefore). When
   * the insertion runs first, the element is still in its old parent's
   * layout; the removal then finds a different parent and does nothing
   * (`HandleRemoveChildAction` in `fiber_element.cc`). The element ends up in
   * neither: the new parent lays out empty and the element sits unattached
   * at the top-left of the screen. Moving out of an `<overlay>` back to the
   * page it came from, which follows the page in the tree, always hit this
   * (CDK's DomPortal and the context menu's lifted element do it). Lynx's
   * develop branch fixes it (`FixFiberReinsertDetachFromOldRenderParent`),
   * after 4.1.
   *
   * A removal and a rebuild in the same flush don't depend on the order:
   * the old element leaves its parent, and a fresh one with the same state
   * goes into the new one. Moves the flush does handle in order (the old
   * parent first, or the same parent, as for an `@for` reorder) stay native
   * moves. Lynx for Web moves DOM nodes and doesn't have the problem.
   */
  #removeIfMoveWouldBeLost(newParent: LynxElement): void {
    if (__WEB__ || this.#paintingDead || this._virtualParent) return;
    const oldParent = __GetParent(this.element);
    if (
      !oldParent ||
      __GetElementUniqueID(oldParent) ===
        __GetElementUniqueID(newParent.element)
    ) {
      return;
    }
    if (flushesBefore(newParent.element, oldParent)) this.#doRemove();
  }

  /**
   * Commits a genuine removal (no re-insert canceled it):
   * __RemoveElement detaches from the native element tree. Note: __RemoveElement
   * does NOT free the element's native pool slot — there is no __ReleaseElement
   * in Lynx's PAPI.
   */
  #doRemove(): void {
    // The native parent, not parentNode()'s wrapper: the parent may have been
    // released already (an ancestor's removal earlier in this commit released
    // the subtree), and looking it up would register a new wrapper for it.
    const parent = __GetParent(this.element);
    if (!parent) {
      return;
    }
    // Cancel all active animations and reset animated properties before removal.
    // Lynx's native element pool reuses elements — if an animation is still
    // running (or fill:'forwards' persists the final frame), the stale animation
    // state transfers to whatever new element reuses this pool slot.
    // Canceling + resetting inline styles ensures the pooled element returns clean.
    // Each animation cancels itself, because only it knows the key it was
    // started under (its id, or a name it was given; see LynxAnimation).
    // Canceling a completed animation is harmless — a no-op at the native level.
    for (const anim of this.#activeAnimations) {
      anim.cancel();
    }
    if (this.#activeAnimations.length > 0) {
      // Cancel clears the animation's active effect, but Lynx may leave
      // residual computed values on the element (observed: opacity stays at
      // the initial keyframe value 0 after cancel). Nulling the inline styles
      // forces a full reset so the pooled element has no lingering overrides.
      __AddInlineStyle(this.element, 'opacity', null);
      __AddInlineStyle(this.element, 'transform', null);
      this.#activeAnimations.length = 0;
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
    __RemoveElement(parent, this.element);
    // The native painting nodes of this element and its entire subtree are now
    // gone (Lynx tears them down for a non-move removal — is_move=false). Unlink
    // from the JS parent and mark the subtree painting-dead so the next re-insert
    // rebuilds fresh native elements instead of re-attaching empty ones.
    const jsParent = this.#jsParent;
    if (jsParent) {
      const i = jsParent.#children.indexOf(this);
      // Defensive: jsParent's #children was kept in lock-step with the native
      // tree via #adoptChild, so indexOf always finds `this` here.
      /* v8 ignore next */
      if (i >= 0) jsParent.#children.splice(i, 1);
      this.#jsParent = null;
    }
    this.#markPaintingDead();
    // What's left of loose text around it may need regrouping (see #regroup):
    // an emptied anonymous <text> goes, and runs it split may join.
    if (jsParent && !LynxElement.#regrouping) {
      const holder = jsParent.#anonymous ? jsParent.#jsParent : jsParent;
      if (holder && holder.#hasFlow) LynxElement.#pendingFlow.add(holder);
    }
    // Removing a run from a surviving text shifts its edges (a middle run can
    // become the new last run), so re-derive the former parent's context. Uses
    // jsParent captured above, before #jsParent was nulled.
    if (jsParent && isTextish(this)) {
      LynxElement.#enqueueTextNormalization(jsParent);
    }
    // Angular destroyed it (see markDestroyed): nothing will put it back.
    if (this.#destroyed) this.#release();
  }

  /**
   * Lets go of this element and everything under it, after Angular destroyed
   * it (see markDestroyed) and it left the tree:
   *
   * - drops each one from the registry (see #byNativeId), which would keep
   *   the wrapper, and so its native element, alive;
   * - takes each native element's event handlers off it (see
   *   removeNativeHandler). The native element holds them and they hold the
   *   wrapper, which holds the native element: a loop through native code,
   *   which the garbage collector can't follow;
   * - marks each painting-dead, so if one does come back after all (content
   *   a surviving view projected into the destroyed one, shown again), it's
   *   rebuilt and registered again, with its handlers, as any remount is
   *   (see #recreateSubtree). Its caches are kept for that.
   */
  #release(): void {
    this.#destroyed = false;
    this.#paintingDead = true;
    this.deregisterNative();
    for (const { eventType, eventName } of this.#nativeHandlers.values()) {
      removeNativeHandler(this.element, eventType, eventName);
    }
    for (const child of this.#children) child.#release();
    for (const child of this.virtualChildren()) child.#release();
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
   *   * Re-creates a fresh native element for this wrapper and its whole subtree,
   *   * replaying the cached state onto the new refs. This mirrors React Lynx's
   *   * "recreate on remount": Lynx cannot resurrect a painting node torn down by a
   *   * cross-flush removal, so re-attaching the stale ref would render empty. Runs
   *   * depth-first, bottom-up — children are rebuilt first and re-appended, so the
   *   * new parent ref owns fresh, live child refs.
   *   *
   *   * 'list' and 'page' are never rebuilt: a list is a LynxListElement whose
   *   * children are driven by update-list-info (not __AppendElement), and the page
   *   * is the immutable singleton root. Both just clear the flag. (A consequence:
   *   * a <list> nested directly inside a toggling @if remounts empty — a pre-existing
   *   * limitation, not a regression, since its ref cannot be rebuilt from a raw tag.)
   * v8 ignore start -- reached only when a same-flush move is later expanded into a real removal + reinsertion; the on-device flow is exercised by teardown.test.ts's higher-level appendChild/remove regressions and by the route-reuse detach/reattach cycle. The individual attribute/style/class replay branches inside require reproducing every combination of a live element's cached state, which the unit-test fake-native tree doesn't drive end-to-end.
   */
  #recreateSubtree(): void {
    if (!this.#paintingDead) return;
    this.#paintingDead = false;
    if (this.isRootPageElement || this.tagName === 'list') return;

    // Swapping the native ref changes this wrapper's unique id — move its
    // registry entry from the stale (destroyed) ref's id to the fresh one so
    // parentNode()/#canonicalFor keep resolving to this canonical wrapper.
    this.deregisterNative();
    // An anchor in a <text> is an empty raw-text (see #anchorFor).
    const fresh = this.#anchorInText
      ? __CreateRawText('')
      : createNativeRefByTag(this.tagName, getPageId(), this.#text);
    this.#nativeRef = fresh;
    LynxElement.#register(__GetElementUniqueID(fresh), this);

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
    const inlineStyle = this.#inlineStyleFor(this.#inlineStyleWhole);
    if (inlineStyle != null) {
      __SetInlineStyles(fresh, inlineStyle);
    }
    for (const [key, value] of this.#inlineStyleKeys) {
      __AddInlineStyle(fresh, key, withSafeAreaInsets(value));
    }
    for (const {
      eventType,
      eventName,
      dispatch,
    } of this.#nativeHandlers.values()) {
      __AddEvent(fresh, eventType, eventName, {
        type: 'worklet',
        value: dispatch,
      });
    }
    for (const child of this.#children) {
      child.#recreateSubtree();
      __AppendElement(fresh, child.element);
    }
    // Its loose text changed while it was out (see commitPendingFlow).
    if (this.#regroupWhenRecreated) {
      this.#regroupWhenRecreated = false;
      LynxElement.#pendingFlow.add(this);
    }
  }
  /* v8 ignore stop */

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
    const canonical = LynxElement.#canonicalFor(parent);
    // Loose text's parent is its anonymous <text>'s, which Angular never sees
    // (see #regroup).
    return canonical.#anonymous ? canonical.parentNode() : canonical;
  }

  nextSibling(): LynxElement | null {
    // If in a virtual tree, use virtual sibling tracking
    if (this._virtualParent) return this._virtualNext;
    const nextSibling = __NextElement(this.element);
    if (nextSibling) {
      // Return the canonical wrapper (see #canonicalFor / parentNode). Angular
      // can hand a nextSibling() result back as a refChild to insertBefore, so
      // it must be the same wrapper whose #children recreation walks — never a
      // throwaway.
      return LynxElement.#entering(LynxElement.#canonicalFor(nextSibling));
    }
    // The last in an anonymous <text>: what follows the <text> follows it.
    const parent = __GetParent(this.element);
    const canonical =
      parent && LynxElement.#registered(__GetElementUniqueID(parent));
    return canonical && canonical.#anonymous ? canonical.nextSibling() : null;
  }

  /**
   * The node Angular sees at `element`'s place: the first in it, for an
   * anonymous `<text>` (see #regroup), whose members are its parent's
   * children to Angular.
   */
  static #entering(element: LynxElement): LynxElement | null {
    if (!element.#anonymous) return element;
    const first = __FirstElement(element.element);
    return first
      ? LynxElement.#entering(LynxElement.#canonicalFor(first))
      : element.nextSibling();
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
    this.#activeAnimations.push(anim);
    return anim;
  }

  /**
   * Angular's renderer.listen() calls this with event names like 'bindtap',
   * 'catchtouchstart', 'bindscroll', etc. We strip the Lynx event prefix
   * (bind/catch/capture-bind/capture-catch) to extract the native event name
   * and determine the event type for __AddEvent. A DOM name Lynx calls
   * something else (see DOM_EVENT_ALIASES) listens for the Lynx event, so
   * `(click)`, and Angular's RouterLink with it, runs on a tap, and one Lynx
   * sends under the same name (SAME_NAME_DOM_EVENTS), such as `(input)`,
   * listens for it. Other names (e.g. `mouseover`) are ignored: iOS and
   * Android have no event for them.
   *
   * An element can have any number of listeners for one event, as on the
   * web: a template's `(bindtap)` next to a directive's host listener for
   * `click`, say. Native Lynx keeps one handler per event name, so each name
   * gets one native handler that runs all of them (see #syncNativeHandler).
   */
  addEventListener(name: string, cb: (event: any) => any) {
    if (POINTER_EVENT_NAMES.has(name))
      return this.#addPointerListener(name, cb);
    const parsed = parseEventName(name);
    if (!parsed) {
      return () => {};
    }

    if (__WEB__ && parsed.eventName === 'longpress') {
      this.#listenForWebLongPress();
    }

    return this.#add({ ...parsed, listener: cb });
  }

  /**
   * @internal Adds a listener for a Lynx event name (`bindtap`, …) that runs
   * after the element's other listeners for the event, whenever they were
   * added. The document's listeners hear the end of a touch from the page
   * element this way (see global-events/native-source.ts), so they run after
   * the page's own, the root component's host listeners and `body:` ones,
   * as a browser runs a document's listeners after its body's.
   */
  addTrailingEventListener(name: string, cb: (event: any) => any): () => void {
    return this.#add({
      ...parseEventName(name)!,
      listener: cb,
      trailing: true,
    });
  }

  #add(entry: Listener): () => void {
    // Kept so #recreateSubtree() can register the handlers again on a rebuilt
    // native ref: native events don't survive a painting-node teardown and
    // can't be read back from the native side, so template `(bind…)` handlers
    // on projected content would go dead after a remount without this.
    this.#listeners.push(entry);
    this.#syncNativeHandler(entry);
    return () => this.#removeListener(entry);
  }

  /**
   * Removes a listener added with addEventListener, as the DOM method does,
   * for code that pairs the two on the element itself rather than going
   * through the renderer's cleanup function. Angular's `@defer` interaction
   * and hover triggers do, for their `click`, `keydown` and `mouseenter`
   * listeners; without it, their cleanup would throw. A name Lynx has no
   * event for was never added, so removing it does nothing.
   */
  removeEventListener(name: string, cb: (event: any) => any): void {
    if (POINTER_EVENT_NAMES.has(name)) {
      if (__WEB__) {
        (this.element as unknown as EventTarget).removeEventListener(name, cb);
      } else {
        this.#pointerEvents?.remove(name, cb);
      }
      return;
    }
    const parsed = parseEventName(name);
    if (!parsed) return;
    const entry = this.#listeners.find(
      (other) =>
        other.listener === cb &&
        other.eventType === parsed.eventType &&
        other.eventName === parsed.eventName,
    );
    if (entry) this.#removeListener(entry);
  }

  /**
   * A pointer listener (see pointer-events.ts): on Lynx for Web, a DOM
   * listener on the element, which gets the browser's own pointer events;
   * natively, one of the pointer events the element makes from its touches.
   */
  #addPointerListener(name: string, cb: (event: any) => any): () => void {
    if (__WEB__) {
      const target = this.element as unknown as EventTarget;
      if (!this.#webPointer) {
        this.#webPointer = { offsetX: 0, offsetY: 0 };
        const record = (event: Event) => {
          const { offsetX, offsetY } = event as PointerEvent;
          this.#webPointer = { offsetX, offsetY };
        };
        target.addEventListener('pointerdown', record);
        target.addEventListener('pointerup', record);
      }
      target.addEventListener(name, cb);
      return () => target.removeEventListener(name, cb);
    }
    this.#pointerEvents ??= new PointerEventSource({
      uid: __GetElementUniqueID(this.element),
      layoutOrigin: () => this.#layoutTracker().rect,
      listen: (event, listener) => this.addEventListener(event, listener),
      eventTarget: this,
    });
    // Offsets for touches on a child come from the element's layout.
    this.#layoutTracker().start();
    return this.#pointerEvents.add(name, cb);
  }

  /**
   * Makes `pointerId`'s events this element's until it lifts, as a DOM
   * element's method does. A Lynx touch always goes to the element it
   * started on, so this changes only `hasPointerCapture()` and fires
   * `gotpointercapture` (see pointer-events.ts).
   */
  setPointerCapture(pointerId: number): void {
    if (__WEB__) {
      (this.element as unknown as Element).setPointerCapture(pointerId);
      return;
    }
    this.#pointerEvents?.setPointerCapture(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    if (__WEB__) {
      (this.element as unknown as Element).releasePointerCapture(pointerId);
      return;
    }
    this.#pointerEvents?.releasePointerCapture(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    if (__WEB__) {
      return (this.element as unknown as Element).hasPointerCapture(pointerId);
    }
    return this.#pointerEvents?.hasPointerCapture(pointerId) ?? false;
  }

  #layoutTracker(): LayoutTracker {
    this.#layout ??= new LayoutTracker({
      listen: (event, listener) => this.addEventListener(event, listener),
      measure: (callback) => measureLayout(this.element, callback),
    });
    return this.#layout;
  }

  /**
   * The element's box relative to the LynxView, now, as a DOM element's
   * method answers. Lynx has no synchronous layout read, so this is the box
   * from the element's last `layoutchange` (see layout.ts): the first call
   * starts listening, and the box is empty until the element's next layout.
   * Code that needs it from the start can call `observeLayout()`, or use
   * `ResizeObserver`. On Lynx for Web it's the DOM element's own.
   */
  getBoundingClientRect(): LynxDOMRect {
    if (__WEB__) {
      return (this.element as unknown as Element).getBoundingClientRect();
    }
    const tracker = this.#layoutTracker();
    tracker.start();
    return toDOMRect(tracker.rect);
  }

  /**
   * The element's width, from its last layout (see getBoundingClientRect).
   */
  get clientWidth(): number {
    return this.getBoundingClientRect().width;
  }

  get clientHeight(): number {
    return this.getBoundingClientRect().height;
  }

  get offsetWidth(): number {
    return this.getBoundingClientRect().width;
  }

  get offsetHeight(): number {
    return this.getBoundingClientRect().height;
  }

  /**
   * Calls `observer` with the element's box after each layout that moves or
   * resizes it, from the next one on. What `ResizeObserver` is built on.
   * Returns a function that stops it.
   */
  observeLayout(observer: (rect: LayoutRect) => void): () => void {
    return this.#layoutTracker().observe(observer);
  }

  /**
   * The box from the element's last layout, or null before the first.
   */
  get layoutRect(): LayoutRect | null {
    return this.#layout?.rect ?? null;
  }

  /**
   * On Lynx for Web, which never fires `longpress` (see web-long-press.ts),
   * recognizes long presses from this element's touch and mouse events and
   * runs its `longpress` listeners, as native Lynx would. Once per element:
   * the listeners it adds stay, and do nothing once no `longpress` listener
   * is left.
   */
  #listenForWebLongPress(): void {
    if (this.#webLongPress) return;
    const press = new WebLongPress((detail) => {
      const entry = this.#listeners.find(
        (listener) => listener.eventName === 'longpress',
      );
      if (entry) this.#dispatch(entry, { type: 'longpress', detail });
    });
    this.#webLongPress = press;
    this.addEventListener('bindtouchstart', press.start);
    this.addEventListener('bindmousedown', press.start);
    this.addEventListener('bindtouchmove', press.move);
    this.addEventListener('bindmousemove', press.move);
    for (const end of ['touchend', 'touchcancel', 'mouseup', 'mouseleave']) {
      this.addEventListener(`bind${end}`, press.end);
    }
  }

  #removeListener(entry: Listener): void {
    const i = this.#listeners.indexOf(entry);
    // Removing a listener a second time does nothing, as on the DOM.
    if (i < 0) return;
    this.#listeners.splice(i, 1);
    this.#syncNativeHandler(entry);
  }

  /**
   * The listeners that share `entry`'s native handler, in the order added,
   * the trailing ones last.
   */
  #listenersLike(entry: Listener): Listener[] {
    const key = nativeEventKey(entry.eventType, entry.eventName);
    const like = this.#listeners.filter(
      (other) => nativeEventKey(other.eventType, other.eventName) === key,
    );
    return [
      ...like.filter((other) => !other.trailing),
      ...like.filter((other) => other.trailing),
    ];
  }

  /**
   * Brings the native handler for `entry`'s event in line with its listeners:
   * registers it for the first one, changes its type when a listener needs
   * another (see combinedEventType), and removes it after the last one.
   */
  #syncNativeHandler(entry: Listener): void {
    const key = nativeEventKey(entry.eventType, entry.eventName);
    // A main-thread directive has the event's one handler (see holdNativeEvent).
    if (this.#heldEvents.has(key)) return;
    const listeners = this.#listenersLike(entry);
    const current = this.#nativeHandlers.get(key);
    const eventType = listeners.length ? combinedEventType(listeners) : null;
    if (current?.eventType === eventType) return;
    // A handler reaches native with the next flush, and one added outside
    // change detection may get none: an IntersectionObserver or
    // ResizeObserver observing from an afterNextRender() callback, as
    // Angular advises for browser APIs, listens for uiappear or
    // layoutchange and would hear nothing until something else changed.
    scheduleSettleFlush();
    this.#sendHandlersWithNextFlush();
    if (current) {
      removeNativeHandler(this.element, current.eventType, entry.eventName);
      this.#nativeHandlers.delete(key);
    }
    if (!eventType) return;
    const handler = {
      eventType,
      eventName: entry.eventName,
      // The same dispatcher across a type change: it looks the listeners up
      // when the event fires, so it never needs registering again for them.
      dispatch:
        current?.dispatch ?? ((event: any) => this.#dispatch(entry, event)),
    };
    this.#nativeHandlers.set(key, handler);
    // type: 'worklet' routes the callback through Lynx's worklet system
    // (runWorklet), which is the only way to receive events in the JS thread.
    // Direct function callbacks also work here (not just worklet handles) —
    // the native engine checks the value type at runtime.
    __AddEvent(this.element, eventType, entry.eventName, {
      type: 'worklet',
      value: handler.dispatch,
    });
  }

  /**
   * Leaves the element's handler for `eventName` to a main-thread directive
   * (`[mainThreadBindscroll]` and the like), which registers its own with
   * `__AddEvent`. Lynx keeps one handler per event name (see nativeEventKey),
   * so registering the element's own afterwards would replace the
   * directive's: an IntersectionObserver with options, listening for a
   * scroll-view's scroll events, would stop the app's main-thread scroll
   * handler. Until releaseNativeEvent, the element's listeners for the event
   * aren't registered natively, and don't hear it, as they didn't when the
   * directive registered after them. Counted, as `mainThreadBindscroll` and
   * `mainThreadCatchscroll` share one.
   */
  holdNativeEvent(eventName: string): void {
    this.#heldEvents.set(eventName, (this.#heldEvents.get(eventName) ?? 0) + 1);
    // The directive's handler replaces the element's natively.
    this.#nativeHandlers.delete(eventName);
  }

  /**
   * Hands `eventName` back once the directive has removed its handler, and
   * registers the element's own for the listeners it has for it.
   */
  releaseNativeEvent(eventName: string): void {
    const held = this.#heldEvents.get(eventName);
    // Not held: the element's handler is registered already.
    if (held === undefined) return;
    if (held > 1) {
      this.#heldEvents.set(eventName, held - 1);
      return;
    }
    this.#heldEvents.delete(eventName);
    const entry = this.#listeners.find(
      (listener) =>
        listener.eventName === eventName &&
        listener.eventType !== 'global-bindEvent',
    );
    if (entry) this.#syncNativeHandler(entry);
  }

  /**
   * Makes the next flush give the element's UI its handlers, when the UI is
   * already made. Lynx sends an element's handlers to its UI with its props,
   * and a flush sends an element's props only if one of them changed:
   * FiberElement's flush counts a change of attributes, styles or dataset,
   * but not of handlers. So a handler added to an element already on screen,
   * with nothing else about it changing, never reached the UI on iOS or
   * Android, even after a flush: an IntersectionObserver observing an element
   * that's showing heard none of its exposure events, nor of a scroll-view's
   * scroll events. Setting the dataset to what it is changes nothing, but
   * counts. A UI not made yet gets everything as it's made anyway.
   */
  #sendHandlersWithNextFlush(): void {
    if (__WEB__) return;
    __SetDataset(this.element, { ...this.#dataset });
  }

  /**
   * Runs every listener for the event `entry` belongs to.
   *
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
   * event before invoking the listeners (Angular's wrapper may call
   * preventDefault() during that call) and return the last one's result (the
   * return-false path relies on it). Mirrors React Lynx's
   * addEventMethodsIfNeeded.
   */
  #dispatch(entry: Listener, event: any): unknown {
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
      fillTargetValue(event);
    }
    // The browser's click after a long press on Lynx for Web, which native
    // Lynx doesn't follow with a tap (see web-long-press.ts).
    if (__WEB__ && entry.eventName === 'tap' && dropsTap()) return undefined;
    // The web preview's HTMLVideoElement sends no detail (see web-video.ts).
    if (
      __WEB__ &&
      this.tagName === 'video' &&
      event &&
      typeof event === 'object'
    ) {
      const detail = webVideoDetail(
        entry.eventName,
        this.element as unknown as HTMLVideoElement,
      );
      if (detail) event.detail = detail;
    }
    // A `click` (a tap) on an element with pointer listeners is where its
    // pointer lifted, as a browser's click is: angular-three, for one, only
    // counts a click that ends near where its pointerdown was.
    const pointer = __WEB__
      ? this.#webPointer
      : this.#pointerEvents?.lastOffset;
    if (
      pointer &&
      entry.eventName === 'tap' &&
      event &&
      typeof event === 'object' &&
      event.offsetX === undefined
    ) {
      event.offsetX = pointer.offsetX;
      event.offsetY = pointer.offsetY;
      event.button = 0;
      event.pointerType = __WEB__ ? 'mouse' : 'touch';
    }
    let result: unknown;
    // As a DOM event does: the listeners are those registered when the event
    // fires, so one that removes itself doesn't make the next one skip, and a
    // listener an earlier one removed (an @if hiding part of the element, say)
    // doesn't run.
    for (const other of this.#listenersLike(entry)) {
      if (this.#listeners.includes(other)) result = other.listener(event);
    }
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
 * Commits this cycle's attribute removals (see LynxElement's
 * `#removedAttributes`). A free-function wrapper over
 * `LynxElement.commitPendingAttributeRemovals()` so
 * `LynxRendererFactory2.end()` can drain them (via the lynx-element barrel)
 * right after element removals and before `__FlushElementTree()`.
 */
export const processPendingAttributeRemovals = (): void => {
  LynxElement.commitPendingAttributeRemovals();
};

/**
 * Re-derives positional edge whitespace for every text touched this cycle — a
 * free-function wrapper over `LynxElement.commitPendingTextNormalization()` so
 * `LynxRendererFactory2.end()` can drain it (via the lynx-element barrel) right
 * after removals and before `__FlushElementTree()`, keeping the corrected text in
 * the same flush as the cycle's other mutations. See #pendingTextNormalization.
 */
/**
 * Regroups this cycle's loose text and inline tags (see LynxElement's
 * #regroup) — a free-function wrapper over `LynxElement.commitPendingFlow()`
 * for `LynxRendererFactory2.end()` and the settle flush, after removals and
 * before text normalization and `__FlushElementTree()`.
 */
export const processPendingFlow = (): void => {
  LynxElement.commitPendingFlow();
};

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
 * Called from `LynxDocument`'s element creators, which only run on the main
 * thread (Angular doesn't run on the background thread), so no thread guard is
 * needed here. It schedules ONE
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
    LynxElement.commitPendingFlow();
    LynxElement.commitPendingAttributeRemovals();
    LynxElement.commitPendingTextNormalization();
    __FlushElementTree();
  });
};

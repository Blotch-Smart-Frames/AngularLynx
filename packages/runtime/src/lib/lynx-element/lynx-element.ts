// cspell:words Textish
import {
  LynxAnimation,
  type LynxAnimationOptions,
  setAfterAnimate,
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
import { tagClassOf } from '../lynx-document/element-tags';
import {
  ATTRIBUTE_STYLED_TAGS,
  attributeClassOf,
} from '../lynx-document/web-tags';
import { globalEvents, type LynxGlobalDocument } from '../global-events';
import {
  isBindingListItem,
  isFirstRenderPending,
  isInsideChangeDetection,
  isRenderingPage,
  runComingTick,
  runAfterFirstRender,
} from '../lynx-render-lifecycle';
import type { ElementRef } from '../types/lynx';
import type { ListItemAttributes } from './lynx-list-element';
import { toLynxDisplay, withLynxDisplay } from './display';
import { flushTreeWithListUpdates } from './list-updates';
import { withFlatCalc } from './nested-calc';
import {
  readsSafeAreaInsets,
  safeAreaInsetsStyle,
  withSafeAreaInsets,
} from './safe-area-insets';
import { dataURLForObjectURL } from '../network/blob-urls';
import { sanitizeSvgContent } from './svg-content';
import {
  ALL_TEXT_PROPERTIES,
  ANONYMOUS_TEXT_CLASS,
  FONT_SIZE_FLAG,
  INHERITANCE_CLASS,
  LYNX_TEXT_INHERITANCE_CLASS,
  LAYOUT_FLAG,
  NOT_BLOCK_CONTAINERS,
  RELATIVE_SIZE_FLAG,
  SMALLER_FLAG,
  type BaselineDistance,
  type ShiftLink,
  VERTICAL_ALIGN_FLAG,
  TAKES_RAW_TEXT,
  hasAncestorTextRules,
  inlineBaselineShift,
  inheritanceCopiesFor,
  inheritanceVariable,
  isRelativeFontSize,
  inheritanceStyleFor,
  inlineTextStyles,
  splitDeclarations,
  isBlankText,
  isBlockDisplay,
  isRowOrientation,
  ancestorTextRulesRead,
  matchedStyleFlagsFor,
  matchedQuotesFor,
  matchedVerticalAlignFor,
  parseVerticalAlign,
  quotesRulesRead,
  hasQuotesRules,
  smallerClassFor,
  styleFlagsFor,
  textPropertyBit,
  textPropertyFlags,
} from './text-flow';
import {
  getDocumentLanguage,
  parseQuotes,
  quotePairFor,
  type QuoteMarks,
} from './quotes';
import {
  type LayoutRect,
  LayoutTracker,
  type LynxDOMRect,
  measureLayout,
  restartWebLayoutChange,
  setMeasureFlush,
  toDOMRect,
} from './layout';
import { POINTER_EVENT_NAMES, PointerEventSource } from './pointer-events';
import { setPendingClassWriter } from './class-writes';
import { setScriptStyleWriter } from './script-styles';
import { setScriptFieldTextNoter } from './script-field-text';
import { noteReleased, scheduleCollection } from './collect-garbage';
import { removeNativeHandler } from './remove-native-handler';
import { addNativeEvent } from './event-registration';
import { dropsTap, WebLongPress } from './web-long-press';
import { webVideoDetail } from './web-video';
import {
  type StaticBlock,
  buildStaticBlock,
} from '../static-blocks/static-block';
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
/**
 * A flag attribute as native reads it from update-list-info: a boolean. A
 * template's `full-span="true"`, or a bare `full-span` (`''`), arrives as a
 * string, and only `false` or `"false"` turn one off.
 */
const listItemFlag = (value: unknown): boolean =>
  value !== false && value !== 'false';

/**
 * The `<list-item>` attributes native lays a list out with, which it reads
 * from the list's update-list-info rather than from the item (see
 * LynxElement._listItemAttributes), each with how its value is sent.
 * `reuse-identifier` isn't one: an element item's type is `list-item`.
 */
const LIST_ITEM_LAYOUT: {
  readonly [
    K in keyof Required<Omit<ListItemAttributes, 'reuse-identifier'>>
  ]: (value: unknown) => ListItemAttributes[K];
} = {
  'estimated-main-axis-size-px': Number,
  'full-span': listItemFlag,
  'sticky-top': listItemFlag,
  'sticky-bottom': listItemFlag,
  recyclable: listItemFlag,
};

const HIDDEN_STYLE = 'display: none; overflow: hidden';

/**
 * An inline style, or one declaration's value, as Lynx gets it: with the
 * safe-area insets the shell sent in place of env(safe-area-inset-*) (see
 * safe-area-insets.ts), and each calc() inside another written as a group,
 * which Lynx reads where it drops a nested calc() (see nested-calc.ts). The
 * element keeps the value as the app wrote it, to write it again.
 */
const forNative = <T>(value: T): T => withFlatCalc(withSafeAreaInsets(value));

/**
 * The inline styles that decide whether an element lays out lines.
 */
const LAYOUT_STYLES: ReadonlySet<string> = new Set([
  'display',
  'linear-orientation',
  'linear-direction',
]);

/**
 * Whether a declaration in an inline style string (`Color: red`) declares
 * `property`, a CSS property's name in lower case. The name is matched in
 * any case, as CSS matches it and inlineTextStyles reads it. Never given a
 * variable's (`--x`), whose case counts: removeStyle and setStyle keep
 * those apart (see #customProperties).
 */
const declares = (declaration: string, property: string): boolean => {
  const colon = declaration.indexOf(':');
  return (
    colon > 0 && declaration.slice(0, colon).trim().toLowerCase() === property
  );
};

/**
 * An inline style string without its declarations of `property`, as the
 * DOM's `style.removeProperty()` leaves the `style` attribute. The string as
 * it was when it declares none.
 */
const withoutDeclaration = (
  style: string | null,
  property: string,
): string | null => {
  if (inlineDeclaration(style, property) === undefined) return style;
  return splitDeclarations(style!)
    .filter((declaration) => !declares(declaration, property))
    .join(';');
};

/**
 * The value an inline style string gives a property, the last if several.
 */
const inlineDeclaration = (
  style: string | null,
  property: string,
): string | undefined => {
  let value: string | undefined;
  for (const declaration of splitDeclarations(style ?? '')) {
    if (declares(declaration, property)) {
      value = declaration.slice(declaration.indexOf(':') + 1).trim();
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
 * Lynx's text fields, whose `value` is the text they show, as a DOM field's
 * is (see LynxElement#setFieldText).
 */
const TEXT_FIELDS: ReadonlySet<string> = new Set(['input', 'textarea']);

/**
 * What iOS and Android answer a UI method with when they haven't made a UI
 * for the element yet: `kUIMethodNoUiForNode`, `NO_UI_FOR_NODE` in
 * `LynxUIMethodConstants`.
 */
const NO_UI_FOR_NODE = 6;

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
const withAddedTraits = (
  own: unknown,
  added: readonly string[] | null,
): unknown => {
  if (!added || added.length === 0 || isAndroid()) return own;
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
 * The variable an element's `font-size` is copied to, which HTML text tags
 * inside it read (see text-flow.ts).
 */
const SIZE_VARIABLE = inheritanceVariable('font-size');

/**
 * What kind of size an element passes to the HTML text tags inside through
 * SIZE_VARIABLE (see LynxElement's #passedSize): none, the size from above
 * passing through, a relative one copied as `1em`, or any other.
 */
const enum PassedSize {
  None,
  Absolute,
  Relative,
}

/** A declaration of a CSS variable in an inline style string. */
const VARIABLE_DECLARATION = /(?:^|;)\s*--/;

/**
 * An inline style string with an element's `[style.x]` styles after it,
 * which win over the string's own declarations of the same names, as
 * `__AddInlineStyle` makes them win (see LynxElement's #setsVariables).
 */
const withStyleKeys = (
  inlineStyle: string | null,
  keys: Map<string, unknown> | null,
): string | null => {
  if (!keys?.size) return inlineStyle;
  const declarations = [...keys]
    .map(([key, value]) => `${key}: ${String(forNative(value))}`)
    .join('; ');
  const own = inlineStyle?.replace(/[\s;]+$/, '');
  return own ? `${own}; ${declarations}` : declarations;
};

/**
 * The children of an element that has none, which LynxElement reads in place
 * of its `#children` while that's null. Frozen, so a write to it by mistake
 * throws rather than giving every childless element the child.
 */
const NO_CHILDREN: readonly LynxElement[] = Object.freeze([]);

/**
 * Starts the public fields LynxElement declares with a constant on its
 * prototype (see LynxElement's tagName). Run by the first element's
 * constructor, as the hooks are, rather than in a static block, which would
 * make the class a side effect of every bundle that imports the runtime (see
 * side-effects.test.ts). Nothing reads them before an element exists.
 */
const setPrototypeDefaults = (): void => {
  const prototype: Pick<
    LynxElement,
    | 'isRootPageElement'
    | '_virtualParent'
    | '_virtualPrev'
    | '_virtualNext'
    | '_listItemAttributes'
    | '_ownedByListSource'
  > = LynxElement.prototype;
  prototype.isRootPageElement = false;
  prototype._virtualParent = null;
  prototype._virtualPrev = null;
  prototype._virtualNext = null;
  prototype._listItemAttributes = undefined;
  prototype._ownedByListSource = false;
};

/**
 * The fewest entries LynxElement's registry holds before it first sweeps out
 * the collected ones (see its #sweepCollected): a screen's worth, so a small
 * app never sweeps.
 */
const MIN_SWEEP_AT = 1024;

const WHITESPACE = /\s/;

/**
 * Whether a class name comes back as itself when its element's class string
 * is split on whitespace: not empty, and without whitespace of its own. An
 * element whose names are all plain looks them up in its class string (see
 * LynxElement's #classesListed).
 */
const isPlainClassName = (name: string): boolean =>
  name !== '' && !WHITESPACE.test(name);

/**
 * The names in a class string, in order.
 */
const splitClasses = (classes: string): string[] =>
  classes.split(/\s+/).filter(Boolean);

const SPACE = 0x20;

/**
 * Where `name` is in `classes`, a class string whose names are joined by
 * single spaces, as a whole name: -1 if it isn't. Found without splitting
 * the string, or making one with spaces around it, as an element looks for
 * each class Angular adds (see LynxElement's #addClassName).
 */
const classNameIndex = (classes: string, name: string): number => {
  // The names are plain, so one that isn't is never among them, though it
  // may be found as a run of them: 'odd name' in 'a odd name'. And
  // indexOf('') finds the empty name at every index, the end included, so
  // the search below would never end.
  if (!isPlainClassName(name)) return -1;
  let at = classes.indexOf(name);
  while (at !== -1) {
    const end = at + name.length;
    if (
      (at === 0 || classes.charCodeAt(at - 1) === SPACE) &&
      (end === classes.length || classes.charCodeAt(end) === SPACE)
    ) {
      return at;
    }
    at = classes.indexOf(name, at + 1);
  }
  return -1;
};

/**
 * Whether `name` is one of the names in `classes` (see classNameIndex).
 */
const hasClassName = (classes: string, name: string): boolean =>
  classNameIndex(classes, name) !== -1;

/**
 * `classes`, a class string whose names are joined by single spaces and are
 * each there once, without `name`; the same string if it isn't there.
 */
const withoutClassName = (classes: string, name: string): string => {
  const at = classNameIndex(classes, name);
  if (at === -1) return classes;
  const end = at + name.length;
  // The space after it goes with it, or the one before it if it's last.
  if (end < classes.length)
    return classes.slice(0, at) + classes.slice(end + 1);
  return classes.slice(0, Math.max(0, at - 1));
};

/**
 * Whether native, given `classes` as a whole class string, has exactly its
 * names, each once: each name plain, as `__SetClasses` splits the string on
 * spaces alone, and none twice, which iOS and Android keep twice and Lynx
 * for Web once.
 */
const isWholeClassList = (classes: string): boolean => {
  if (classes === '') return true;
  const names = classes.split(' ');
  return names.every(isPlainClassName) && new Set(names).size === names.length;
};

/**
 * The classes in one list and not the other, either way: the ones a class
 * string's change added or removed (see LynxElement's #rulesChanged).
 */
const changedTokens = (
  before: Iterable<string>,
  after: ReadonlySet<string>,
): string[] => {
  const old = new Set(before);
  const changed = [...after].filter((name) => !old.delete(name));
  return [...changed, ...old];
};

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
 * attach instead of throwing.
 *
 * The full check walks `parent`'s ancestors up to the root of its tree, two
 * native reads a step, and `__GetParent` hands back a new handle each time.
 * Angular appends nearly every element right after creating it, before its
 * children, so two exact shortcuts answer most attaches in a few reads:
 *
 * - A `candidate` with no native child can't be anyone's ancestor, so only
 *   `parent` being `candidate` itself can form a cycle.
 * - A `candidate` already among `parent`'s children (an `@for` reorder of
 *   rows with children) can't also be one of its ancestors.
 *
 * Otherwise `candidate` has children and no parent of `parent`'s: an `@for`
 * row going in before its anchor, whose `<text>` or `<view>` was built with
 * its children before the row was inserted. Walking up from `parent` costs
 * two reads per level of the screen, for every such row, so a small
 * `candidate` is searched downwards instead: a cycle means `parent` is in
 * its subtree. Past {@link SUBTREE_SEARCH_LIMIT} elements, it walks up after
 * all, so moving a whole screen costs no more than it did.
 *
 * All of these read the native tree, not the wrappers' `#children`: a
 * list's items, anonymous texts and hydrated elements can have native
 * children no wrapper lists.
 *
 * Compares by unique ID rather than ref identity: native refs must not be used
 * as map/Set keys (hashing one crashes the Lepus engine — see
 * LynxDocument.createComment), and `__GetParent` is not guaranteed to return the
 * same JS handle across calls.
 */
const wouldFormCycle = (
  parent: ElementRef,
  candidate: ElementRef,
  candidateUnplaced: boolean,
): boolean => {
  const candidateId = __GetElementUniqueID(candidate);
  const parentId = __GetElementUniqueID(parent);
  if (parentId === candidateId) return true;
  const first = __FirstElement(candidate);
  if (!first) return false;
  // A candidate its wrapper knows is in no tree has no parent to read (see
  // LynxElement's #unplaced).
  const current = candidateUnplaced ? null : __GetParent(candidate);
  if (current && __GetElementUniqueID(current) === parentId) return false;
  const inSubtree = subtreeHolds(first, parentId);
  if (inSubtree !== undefined) return inSubtree;
  for (let cur = __GetParent(parent); cur; cur = __GetParent(cur)) {
    if (__GetElementUniqueID(cur) === candidateId) return true;
  }
  return false;
};

/**
 * How many elements wouldFormCycle searches below a candidate before it
 * walks up from the parent instead. An `@for` row is a few elements, and a
 * screen is a few levels of component hosts and containers deep, a dozen
 * or more in an app's real screens.
 */
const SUBTREE_SEARCH_LIMIT = 16;

/**
 * Whether the element with unique id `id` is `first`, one of its following
 * siblings, or inside one of them: so, with `first` a candidate's first
 * child, inside the candidate. Undefined once it has looked at
 * {@link SUBTREE_SEARCH_LIMIT} elements without finding it.
 */
const subtreeHolds = (first: ElementRef, id: number): boolean | undefined => {
  const pending: ElementRef[] = [first];
  let seen = 0;
  while (pending.length > 0) {
    // Each pending element stands for itself and its following siblings.
    for (
      let element: ElementRef | null = pending.pop()!;
      element;
      element = __NextElement(element)
    ) {
      if (++seen > SUBTREE_SEARCH_LIMIT) return undefined;
      if (__GetElementUniqueID(element) === id) return true;
      const child = __FirstElement(element);
      if (child) pending.push(child);
    }
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
 * The inline styles that change how far a `<sub>` or `<sup>` moves the HTML
 * text tags inside it (see LynxElement's #shiftLink).
 */
const SHIFT_STYLES = new Set(['font-size', 'vertical-align']);

/**
 * The inline `vertical-align` that moves an HTML text tag inside a `<sub>`,
 * a `<sup>` or another tag with a `vertical-align` off the baseline as far
 * as the tags around it do together, which Lynx doesn't do for it (see
 * baselineShiftFor). None where nothing above moves it, and none in the web
 * preview, whose browser moves it already, so it would move twice. An `em`
 * inline resolves against the tag's own size (iOS 27 Simulator and Android
 * API 34 emulator, November 2026).
 */
const baselineShiftStyle = (chain: readonly ShiftLink[]): string => {
  if (__WEB__) return '';
  const shift = inlineBaselineShift(chain);
  if (!shift) return '';
  const [em, px] = shift;
  return `vertical-align: ${px ? `${px}px` : `${em}em`}`;
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
 *
 * iOS sends `scroll` on every frame of a scroll, so while the placeholder is
 * the only listener, #dispatch drops the event before doing anything else,
 * flush included: it changes nothing, and a flush costs the engine thread a
 * patch pass and the UI thread an operation on each frame.
 */
export const listenForScrollsFromTheStart = (element: LynxElement): void => {
  if (__WEB__ || !isIOS()) return;
  element.addEventListener('bindscroll', ignoreScroll);
};

const ignoreScroll = (): void => {};

/**
 * The stopPropagation()/preventDefault()/stopImmediatePropagation() an event
 * without them gets (see #dispatch). One function for every event, rather
 * than three new ones per event: touchmove and scroll come on every frame.
 */
const noop = (): void => {};

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
 * Whether inserting `child` on Lynx for Web moves it: it's in the tree
 * already, so the browser takes it off the page and puts it back, which
 * stops its `layoutchange` (see restartWebLayoutChange). A native element
 * moves without that, and an element going in for the first time was never
 * on the page.
 */
const isWebMove = (child: LynxElement): boolean =>
  __WEB__ && __GetParent(child.element) !== null;

/**
 * A raw-text leaf or a <text> container — the only elements that carry trimmable
 * inline text. Used to decide when a mutation should queue text normalization.
 */
const isTextish = (el: LynxElement): boolean =>
  el.tagName === 'text' || el.tagName === 'raw-text';

/**
 * Whether the first LynxElement has made layout reads ask for a flush, and
 * animations count as writes waiting for one (see the constructor).
 */
let hooksInstalled = false;

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

  // The public fields below start as a constant, and nearly every element
  // keeps it: they're declared here, and start on the prototype (see
  // setPrototypeDefaults), so an element has a property of its own only
  // once one is set. In PrimJS each property of its own costs an element
  // about 45 bytes, whatever its value (see "In PrimJS every own property
  // costs each object about 45 bytes" in
  // investigations/lynx-vs-web-differences.md). The build plugin does the
  // same for the private fields (see private-methods.ts in the rsbuild
  // plugin), but leaves public ones alone, which code outside can tell from
  // an own property.

  /**
   * When true, this element is the root page element and must not be
   * re-parented (appendChild/insertBefore) or removed from the tree.
   * Angular calls appendChild/remove as part of normal component lifecycle,
   * but the page element is the immutable root — moving or removing it
   * would corrupt the native element tree.
   */
  declare isRootPageElement: boolean;

  /**
   * Virtual tree tracking — used when parent manages children outside the
   * native element tree (e.g., list manages children via componentAtIndex
   * callbacks rather than __AppendElement)
   */
  declare _virtualParent: LynxElement | null;
  declare _virtualPrev: LynxElement | null;
  declare _virtualNext: LynxElement | null;

  /**
   * @internal A `<list-item>`'s layout attributes (`full-span`, `sticky-top`
   * and the rest, see LIST_ITEM_LAYOUT), as they've been set on it. Native
   * reads them from the list's update-list-info, not from the item, so the
   * list sends them from here (see LynxListElement.#collectSlots). A new
   * object for each change, so the list can tell one by identity. Undefined
   * until one is set, as on most items.
   */
  declare _listItemAttributes: ListItemAttributes | undefined;

  /**
   * @internal Set on the `<list-item>` of a `*lynxListFor` item. Its list
   * learns about it from the directive, which builds it when native asks for
   * it, so the list keeps it out of its children (see
   * LynxListElement.appendChild). A plain field rather than a set of
   * elements: the list checks it while componentAtIndex runs, where keying a
   * Set on an element is what crashed (see create-list-element.ts).
   */
  declare _ownedByListSource: boolean;

  // Tracks animations started on this element via animate().
  // Canceled when the element is destroyed (see #doRemove) to clear stale
  // animation state from Lynx's native element pool — without this, pooled
  // elements retain animation values (e.g. opacity: 0) that poison
  // newly-created elements reusing the slot.
  #activeAnimations: LynxAnimation[] | null = null;

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
  //
  // The caches below that are collections, like the element's other
  // collections, are null until their first write. Every view, text,
  // raw-text and anchor is a LynxElement, and most use two or three of them,
  // if any: a dozen empty Maps, Sets and arrays made with each element would
  // live as long as its screen, as work for PrimJS's collector, and as heap
  // PrimJS keeps for each (see #children).
  #attrs: Map<string, unknown> | null = null;
  /**
   * The static block built under this element, and its scope class, which
   * recreation builds again: its elements are native only (see
   * static-blocks/static-block.ts).
   */
  #staticBlock: { block: StaticBlock; scope: string } | null = null;
  #id: string | null = null;
  #dataset: Record<string, unknown> | null = null;
  /** Full space-separated class string, mirroring __SetClasses semantics. */
  #classes = '';
  /**
   * Set while #classes is exactly the join of its names with single spaces,
   * each a plain class name (see isPlainClassName) and each once. addClass
   * then adds a name by appending it, after looking for it in the string
   * (see hasClassName), rather than splitting and joining the whole string
   * again: Angular adds a `[class]` binding's classes one at a time, often
   * ten or more on a component's host. Unset until the first class, and
   * after a removal that takes the classes from native (see removeClass);
   * the next addClass builds the string again, as it always did.
   *
   * A flag rather than a Set of the names: every element with a class kept
   * one, which cost PrimJS about 540 bytes for each (issue #708), and a
   * look-up in a string of a few names is as quick.
   */
  #classesListed = false;
  /**
   * What the native element's class list is known to be:
   *
   * - `true`: the names in #classes, each once. An element LynxDocument made
   *   starts so (see markNew), with none, and so does one whose whole class
   *   string was written with each name plain.
   * - A string: the same, except that #classes changed during this change
   *   detection, and native still has this string's names. The change waits
   *   for the end of the cycle (see #pendingClasses). Never on Lynx for Web.
   * - `false`: not known. Native may hold what #classes doesn't: an element
   *   a server render's snapshot made has classes only native knows (see
   *   LynxHydrateDocument), a name added twice is there twice on iOS and
   *   Android and once on Lynx for Web, and a class string written whole
   *   splits a name with a space in it. Each change then goes to native at
   *   once, as `__AddClass`, or a read of native's list for a removal, as it
   *   always did, until a whole class string with plain names is written.
   *
   * Only change detection on iOS and Android holds changes back. Outside it,
   * and on Lynx for Web, every change goes to native at once, as before: the
   * saving is the C++ crossings, which only native Lynx has, and a web
   * element's layout and styles (getBoundingClientRect, getComputedStyle)
   * are read from the DOM at once. A removal there reads native's list, as
   * it always did, so it keeps a class a raw `__AddClass` gave.
   */
  #nativeClasses: string | boolean = false;
  /**
   * ViewEncapsulation.Emulated's scope classes (see EmulatedLynxRenderer).
   * Angular writes static and bound classes as one whole class string through
   * setAttribute('class'), which would drop them, so they're added back each
   * time.
   */
  #scopeClasses: string[] | null = null;
  /** Whole-string inline style set via setInlineStyles (style="..."). */
  #inlineStyleWhole: string | null = null;
  /** Per-key inline styles set via setStyle ([style.x] bindings). */
  #inlineStyleKeys: Map<string, unknown> | null = null;
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
  #customProperties: Map<string, string> | null = null;
  /**
   * Set once the element's inline style string has declared a CSS variable.
   * From then on its `[style.x]` styles go into that string too, rather than
   * through `__AddInlineStyle`: native Lynx parses a string waiting for the
   * flush as soon as `__AddInlineStyle` reaches the element, and parsed
   * there it doesn't note which variables changed, so the descendants
   * already drawn keep their old values (see "A CSS variable set inline
   * doesn't reach drawn descendants when `__AddInlineStyle` follows it" in
   * investigations/lynx-vs-web-differences.md). It stays set, because a
   * variable taken out is a change the descendants need to see too.
   */
  #setsVariables = false;
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
  #addedTraits: string[] | null = null;
  /** Every listener Angular added, in the order it added them. */
  #listeners: Listener[] | null = null;
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
   * The text of an `<input>` or `<textarea>`, as far as the runtime knows:
   * what the app last set (see #setFieldText) or the user last typed (see
   * #dispatch). Null until the app first sets it.
   */
  #fieldText: string | null = null;
  /**
   * The handler registered natively for each event (see nativeEventKey). It
   * runs every listener for that event, since native Lynx keeps only one.
   */
  #nativeHandlers: Map<
    string,
    {
      eventType: LynxEventType;
      eventName: string;
      dispatch: (event: any) => unknown;
    }
  > | null = null;
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
   *
   * Null until the first child, as most elements never have one: a `@for`
   * row's `<view>`, every raw-text and anchor. A constant start keeps it off
   * the instance until then (see "In PrimJS every own property costs each
   * object about 45 bytes" in investigations/lynx-vs-web-differences.md), and
   * an empty array made with each element cost each one an array too. Reads
   * go through NO_CHILDREN.
   */
  #children: LynxElement[] | null = null;
  /**
   * Back-pointer to the JS parent, for O(1) detach from its #children.
   *
   * Undefined, rather than null, from when LynxDocument makes the element's
   * native element (see markNew) until it's first put in a parent: the
   * native element is then in no tree, so an insert needn't ask native for
   * its parent (see #unplaced). Null is a wrapper whose native element may be
   * anywhere: one made for an element already in the tree (a hydrated one, a
   * query's hit), one a list took (see adoptVirtualChild), or one removed.
   * markNew gives the element this property of its own a little early, as
   * nearly every element gets it when it's inserted anyway.
   */
  #jsParent: LynxElement | null | undefined = null;
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
   * The class for its level of `<small>`s it has (see #setSmallerClass).
   */
  #smallerClass: string | null = null;
  /**
   * The inline declarations that give a #webText element the text styles
   * it inherits: one `var()` for each property its own rules don't set.
   * Ahead of the app's own inline style, which wins over them.
   */
  #inheritStyle = '';
  /**
   * The inline `vertical-align` that moves a #webText element whose own
   * inline style sets one by its distance and those of the HTML text tags
   * above it together (see #baselineShift). After the app's own inline
   * style, the one place it isn't in #inheritStyle: it adds to the app's
   * value, so it has to win over it, where an inherited style gives way
   * (issue #736). #inlineStyle still reads the app's value, which the next
   * total starts from.
   */
  #ownShiftStyle = '';
  /**
   * Set once a #webText element has been inside it: it has INHERITANCE_CLASS,
   * which gives it the variables its rules copy text styles to, for the
   * #webText elements inside to read (see #passTextStyles). Its ancestors
   * have it too. Never cleared: an element the text left keeps passing
   * styles down, which is what every element did before.
   */
  #passesTextStyles = false;
  /**
   * Set once the level of `<small>`s of an HTML text tag inside it was worked
   * out from the size it passes on (see #sizedRelatively): what kind of size
   * that was then, a PassedSize. A change of its classes, its inline size or
   * its place that changes the kind works the tags' levels out again (see
   * #passedSizeChanged). Undefined on an element no tag read it of, whose
   * changes then change no level. Never cleared, as #passesTextStyles isn't:
   * one the text left only costs a walk of its children.
   */
  #passedSizeSeen: PassedSize | undefined = undefined;
  /**
   * Set once loose text or an inline tag has been a child: the element's
   * children are regrouped when they change, or when its classes do, as
   * they decide whether it lays out lines (see #regroup).
   */
  #hasFlow = false;
  /** Regroup the children when a removed element comes back (see #regroup). */
  #regroupWhenRecreated = false;
  /**
   * A `<q>`'s quotation marks: raw-texts that are its first and last native
   * children, which Angular never sees, as a browser's `q::before` and
   * `q::after` aren't nodes (see markQuote).
   */
  #quoteMarks: [open: LynxElement, close: LynxElement] | null = null;
  /** One of a `<q>`'s quotation marks (see #quoteMarks). */
  #quoteMark = false;
  /**
   * Set once a `<q>` has been inside it, as on its ancestors then: a `<q>`
   * in it may need other marks when it moves (see #setQuoteDepth). Never
   * cleared, as #passesTextStyles isn't: one the `<q>` left only costs a
   * walk of its children when it moves.
   */
  #holdsQuote = false;
  /**
   * Its `lang` attribute, which a `<q>` in it draws the marks of (see
   * #setQuoteDepth); undefined without one.
   */
  #lang: string | undefined = undefined;
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
   * Elements whose classes changed during this change detection, which get
   * their final class string at its end, in one `__SetClasses` each (see
   * commitPendingClasses), rather than a native call for each change.
   * Angular applies a `[class]` binding's change one class at a time: a
   * host switching variants, as ui-button's ten-to-twenty class strings do,
   * made a call for each class it added, and two (`__GetClasses`, then
   * `__SetClasses`) for each it removed. Each call crosses into C++ and
   * marks the element's styles dirty, and native resolves its styles only
   * when the tree is flushed (or an element animates, see class-writes.ts),
   * so the calls between flushes drew nothing. Only on iOS and Android (see
   * #nativeClasses). Keyed by the wrapper, never a native ref (see
   * #pendingRemovals).
   */
  static #pendingClasses = new Set<LynxElement>();

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
  #removedAttributes: Set<string> | null = null;

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
   * How many entries #byNativeId may hold before #register sweeps out the
   * ones whose wrapper was collected (see #sweepCollected).
   */
  static #sweepAt = MIN_SWEEP_AT;

  static #register(id: number, element: LynxElement): void {
    const registry = LynxElement.#byNativeId;
    registry.set(id, new WeakRef(element));
    if (registry.size > LynxElement.#sweepAt) LynxElement.#sweepCollected();
  }

  /**
   * Deletes the entries whose wrapper was collected (see #byNativeId), and
   * sweeps again once the registry has grown to twice what's left, so the
   * sweeps cost each registration a step or two however many there are.
   * Entries whose element Angular destroyed go at once (see #release), so
   * these are the few nobody released: the wrappers a renderer that wraps
   * this one made and dropped, and the throwaways #canonicalFor makes.
   *
   * A sweep rather than a FinalizationRegistry, which deleted each entry
   * as its wrapper was collected: registering every element with one kept
   * a record for each as long as the element lived (about 70 bytes under
   * V8, issue #708), to delete the few entries nobody released.
   */
  static #sweepCollected(): void {
    const registry = LynxElement.#byNativeId;
    for (const [id, ref] of registry) {
      if (!ref.deref()) registry.delete(id);
    }
    LynxElement.#sweepAt = Math.max(MIN_SWEEP_AT, registry.size * 2);
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
    // And a touch on a <q>'s quotation mark is the <q>'s (see markQuote).
    // (markQuote gives each mark its <q> as its #jsParent.)
    if (element && element.#quoteMark) return element.#jsParent as LynxElement;
    return element;
  }

  constructor(element: ElementRef) {
    // Every layout read asks for the flush its UI method waits for: an
    // element's (getBoundingClientRect, ResizeObserver) and an
    // IntersectionObserver's, which measures from timers and other events'
    // listeners and imports layout.ts alone. And every animation operation
    // counts as a write the next event flushes, a main-thread script's
    // included (see setAfterAnimate). Installed by the first element rather
    // than when this module loads, because a module-level call is a side
    // effect that keeps this module in every bundle that imports the runtime
    // (see side-effects.test.ts); nothing is measured or animated before an
    // element exists.
    if (!hooksInstalled) {
      hooksInstalled = true;
      setPrototypeDefaults();
      setMeasureFlush(scheduleSettleFlush);
      setAfterAnimate(countNativeWrite);
      // What reads native's classes, or has native resolve the tree, without
      // the element module writes the cycle's classes first (see
      // class-writes.ts).
      setPendingClassWriter(() => LynxElement.commitPendingClasses());
      // A main-thread script's inline styles go through the element's
      // LynxElement, as its [style.x] bindings do (see script-styles.ts).
      setScriptStyleWriter((ref, styles) => {
        const target = LynxElement.#registered(__GetElementUniqueID(ref));
        if (!target) return false;
        target.#setScriptStyles(styles);
        return true;
      });
      // And the text a script sets on a field (see script-field-text.ts).
      setScriptFieldTextNoter((ref, text) => {
        const target = LynxElement.#registered(__GetElementUniqueID(ref));
        if (target) target.#noteFieldText(text);
      });
    }
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
    // A field's `value` is the text it shows, as the DOM property is, and
    // Lynx has no attribute for it (see #setFieldText).
    if (name === 'value' && TEXT_FIELDS.has(this.tagName)) {
      this.#setFieldText(value == null ? '' : String(value));
      return;
    }
    this.setAttribute(name, value);
  }

  /**
   * Shows `text` in an `<input>` or `<textarea>`.
   *
   * A Lynx text field has no attribute for its text: XElement's
   * LynxUIBaseInput registers no prop for `value` on iOS or Android, so only
   * its setValue UI method changes it. A UI method reaches only a UI native
   * has made, and native makes an element's UI when the element tree is next
   * flushed, so a field created since the last flush has none. iOS and
   * Android answer setValue on it with NO_UI_FOR_NODE and drop it, and a form
   * opened on data it already held showed empty fields (#339).
   *
   * So the text goes two ways: with setValue, for a field that's on screen,
   * and as `default-value`, which Lynx applies as it makes the field's UI and
   * ignores from then on (XElement marks it consumed in `onNodeReady`).
   * Whether the field has a UI or not, one of them shows the text, without
   * the runtime having to know which. The field shows it from its first
   * frame, where a setValue sent after the flush would come a frame late, and
   * a `<textarea>` is laid out with it. Lynx for Web has no `default-value`
   * and needs none: its fields are DOM elements from the start, and take
   * setValue at once.
   *
   * Text the field holds already is left alone, as a DOM field's is when its
   * `value` is set to its own text. A field bound to a model gets its typed
   * text back after each keystroke, and setting it again would only disturb
   * the user's typing. #dispatch keeps #fieldText up with what's typed, so
   * the runtime listens to the field's `input` itself: Lynx sends a field's
   * events only to a handler, and the app may have none.
   */
  #setFieldText(text: string): void {
    if (text === this.#fieldText) return;
    if (this.#fieldText === null) {
      this.addEventListener('bindinput', () => {});
    }
    this.#fieldText = text;
    this.#sendFieldText(this.element);
  }

  /**
   * Sends #fieldText to `element` both ways (see #setFieldText).
   */
  #sendFieldText(element: ElementRef): void {
    const value = this.#fieldText;
    // Not cached in #attrs: a rebuilt field gets the text it has then, which
    // may be what the user typed since (see #recreateSubtree).
    if (!__WEB__) __SetAttribute(element, 'default-value', value);
    __InvokeUIMethod(element, 'setValue', { value }, () => {});
    // Both reach native with the element's next flush (see invoke()).
    scheduleSettleFlush();
  }

  /**
   * Builds a static block's elements under this element (see
   * static-blocks/static-block.ts), or, when `build` is false, takes the ones
   * a server render already put there (LynxHydrateDocument). Kept so a
   * recreated element gets them again (see #recreateSubtree).
   */
  setStaticBlock(block: StaticBlock, scope: string, build = true): void {
    this.#staticBlock = { block, scope };
    // The root's own creation asked for the flush that sends them (see
    // LynxDocument.createElement).
    if (build) buildStaticBlock(this.element, block, scope);
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
   * pass. Keeps #text in sync with the displayed value so a remounted raw-text
   * rebuilds with the correct text.
   */
  #setDisplayedText(displayed: string): void {
    if (this.#text === displayed) return;
    __SetAttribute(this.element, 'text', displayed);
    this.#text = displayed;
  }
  setAttribute(name: string, value: any): void {
    // A class, id, data-* or `hidden` asks for no flush itself (see
    // nativeWriteEpoch).
    nativeWriteEpoch++;
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
    // HTML's `lang`, whose language a <q> in it draws the marks of (see
    // #setQuoteDepth). It still goes to native below.
    if (name === 'lang') this.#setLang(value);
    // An `<a href>` or `<abbr title>` gets the class the build's browser
    // styles for it match, as Lynx can't match `a[href]` (see
    // ATTRIBUTE_STYLED_TAGS). The attribute still goes to native below.
    const styledTag = ATTRIBUTE_STYLED_TAGS.get(name);
    if (styledTag && this.#scopeClasses?.includes(tagClassOf(styledTag))) {
      this.setRuntimeClass(attributeClassOf(styledTag, name), value != null);
    }
    if (this.tagName === 'list-item' && name in LIST_ITEM_LAYOUT) {
      this.#noteListItemLayout(name as keyof typeof LIST_ITEM_LAYOUT, value);
    }
    if (name === 'class') {
      // Use __SetClasses (not __AddClass) because setAttribute replaces the
      // entire class attribute with a space-separated list. __AddClass treats
      // its argument as a single class name — passing 'foo bar baz' would set
      // the literal class 'foo bar baz' rather than three separate classes,
      // so no CSS rule would ever match. __SetClasses correctly parses the
      // space-separated list. This matches how React Lynx handles className.
      const names = new Set(
        String(value ?? '')
          .split(/\s+/)
          .filter(Boolean),
      );
      // What it had, to tell which classes changed (see #rulesChanged):
      // unknown while native has classes the string doesn't. Kept as the
      // string, and split only if #rulesChanged asks which changed, as it
      // does for few elements: the split and the comparison were a tenth of
      // the runtime's work for each `@for` row.
      const before = this.#nativeClasses === false ? undefined : this.#classes;
      // The split's names are plain, and the scope classes Angular and the
      // runtime name are too; an odd one an app gave setRuntimeClass leaves
      // the set to the next addClass.
      let plain = true;
      if (this.#scopeClasses) {
        for (const scope of this.#scopeClasses) {
          names.add(scope);
          if (!isPlainClassName(scope)) plain = false;
        }
      }
      const classes = [...names].join(' ');
      if (
        !__WEB__ &&
        plain &&
        this.#nativeClasses !== false &&
        isInsideChangeDetection()
      ) {
        // Written at the end of the cycle, with the classes added and
        // removed after it (see #pendingClasses).
        this.#deferClasses(this.#classes);
      } else {
        // The whole string replaces whatever native has, what waited for the
        // end of the cycle included.
        if (typeof this.#nativeClasses === 'string') {
          LynxElement.#pendingClasses.delete(this);
        }
        __SetClasses(this.element, classes);
        this.#nativeClasses = plain;
      }
      this.#classes = classes;
      this.#classesListed = plain;
      this.#rulesChanged(
        before === undefined
          ? undefined
          : () => changedTokens(splitClasses(before), names),
      );
    } else if (name === 'style') {
      this.setInlineStyles(value);
    } else if (name === 'id') {
      __SetID(this.element, value);
      const before = this.#id;
      this.#id = value ?? null;
      this.#rulesChanged(
        [before, this.#id].filter((id) => id).map((id) => `#${id}`),
      );
    } else if (name.startsWith('data-')) {
      // __SetDataset gets the whole dataset, never the one key. The web
      // preview's replaces the element's dataset with the object it's given
      // (dropping the other data-* attributes, and the keys its events carry
      // in target.dataset), while native's merges it in, keeping each key it
      // isn't given: so a removed key goes as undefined, or native would
      // keep its old value. __AddDataset, which sets one key, would keep the
      // others, but the web preview's removes the attribute for any falsy
      // value, a `data-index="0"` included. A copy, as the web preview keeps
      // the object itself, and later writes to #dataset would change it.
      const key = name.slice(5);
      const dataset = (this.#dataset ??= {});
      if (value == null) {
        delete dataset[key];
        __SetDataset(this.element, { ...dataset, [key]: undefined });
      } else {
        dataset[key] = value;
        __SetDataset(this.element, { ...dataset });
      }
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
      // An object URL (`URL.createObjectURL(blob)`) names a Blob that only
      // this thread holds (network/blob.ts), which the native <image> can't
      // load: it gets the Blob's bytes as a data: URL instead. The web
      // preview's object URLs are the browser's own, and stay as they are.
      if (
        this.tagName === 'image' &&
        (name === 'src' || name === 'placeholder') &&
        typeof value === 'string'
      ) {
        value = dataURLForObjectURL(value) ?? value;
      }
      if (name === 'accessibility-traits') {
        this.#ownTraits = value ?? null;
        value = withAddedTraits(this.#ownTraits, this.#addedTraits);
      }
      if (value == null) {
        // At the flush, unless it's set again first: see #removedAttributes.
        (this.#removedAttributes ??= new Set()).add(name);
        LynxElement.#pendingAttributeRemovals.add(this);
        scheduleSettleFlush();
      } else {
        this.#removedAttributes?.delete(name);
        __SetAttribute(this.element, name, value);
        // Set outside change detection (from a timer, a promise, a gesture),
        // it reaches native only with a flush (see scheduleSettleFlush).
        scheduleSettleFlush();
      }
      // raw-text carries its text via the 'text' attribute (renderer.setValue).
      // It isn't mirrored with the other attributes: #text holds it, which a
      // rebuilt raw-text is made with (see #recreateSubtree), and a Map for
      // it alone cost each raw-text about 170 bytes of PrimJS's heap (issue
      // #708).
      const isRawText = this.tagName === 'raw-text' && name === 'text';
      // Mirror for recreation. removeAttribute() funnels here with value=null,
      // so drop the key then rather than replaying a cleared attribute.
      if (value == null) {
        this.#attrs?.delete(name);
      } else if (!isRawText) {
        (this.#attrs ??= new Map()).set(name, value);
      }
      if (isRawText) {
        // The renderer feeds this the COLLAPSED-but-untrimmed value (see
        // renderer.setValue → collapseWhitespace). Stash it as the raw source and
        // queue the enclosing text for the positional edge-trim pass; #text is
        // the provisional display until that pass corrects it (#setDisplayedText).
        const text = value == null ? undefined : String(value);
        const blankChanged = isBlankText(this.#rawText) !== isBlankText(text);
        this.#text = text;
        this.#rawText = text;
        LynxElement.#enqueueTextNormalization(this);
        // Its anonymous <text> hides while all it holds is blank, which only
        // a change between blank and not can change: a regroup reads the text
        // for nothing else (see #regroup), so a counter's every tick needn't
        // regroup its parent's children.
        const parent = this.#jsParent;
        if (blankChanged && parent && parent.#anonymous && parent.#jsParent) {
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
      this.#setRuntimeStyle(androidBlurMaterialStyle(this.#attrs ?? new Map()));
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
    const traits = this.#addedTraits;
    if ((traits?.includes(trait) ?? false) === on) return;
    // Taking one away, the element has it, so has traits.
    this.#addedTraits = on
      ? traits
        ? [...traits, trait]
        : [trait]
      : traits!.filter((added) => added !== trait);
    this.setAttribute('accessibility-traits', this.#ownTraits);
  }

  /**
   * Records one of a `<list-item>`'s layout attributes, as native reads it
   * from update-list-info, and tells the list it's in, which sends it with
   * its next update. It's set on the element all the same.
   */
  #noteListItemLayout(
    name: keyof typeof LIST_ITEM_LAYOUT,
    value: unknown,
  ): void {
    const attributes: Record<string, unknown> = {
      ...this._listItemAttributes,
    };
    if (value == null) {
      delete attributes[name];
    } else {
      attributes[name] = LIST_ITEM_LAYOUT[name](value);
    }
    this._listItemAttributes = attributes as ListItemAttributes;
    (
      this._virtualParent as { listItemChanged?(): void } | null
    )?.listItemChanged?.();
  }

  getAttribute(name: string) {
    // The testing library's DOM, which runs the native code paths, reads
    // `class` from the DOM element, which has the classes this cycle changed
    // only once they're written (see #pendingClasses).
    if (name === 'class') this.#writeDeferredClasses();
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
      if (this.#customProperties?.get(key) === text) return;
      (this.#customProperties ??= new Map()).set(key, text);
      if (readsSafeAreaInsets(text)) this.#readsSafeArea = true;
      this.#rewriteInlineStyle();
      // It decides whether the size passed down is relative (see
      // #relativeSize), so the tags inside work out their levels again.
      if (key === SIZE_VARIABLE) {
        this.#inheritAgain();
        this.#passedSizeChanged();
      }
      return;
    }
    // `[style.display]="open ? 'block' : 'none'"` would lay the element out
    // as a row: Lynx has no block layout (see display.ts).
    if (key === 'display') value = toLynxDisplay(value);
    // `[style.padding-bottom]="'calc(1rem + env(safe-area-inset-bottom))'"`
    // gets the inset the shell sends (see safe-area-insets.ts), and is kept
    // as written to get the next one.
    if (readsSafeAreaInsets(value)) this.#readsSafeArea = true;
    const textStyles = this.#textStylesBefore(key);
    (this.#inlineStyleKeys ??= new Map()).set(key, value);
    // An element that passes text styles down copies a text style to its
    // variable too, which only the whole string can set (see
    // #inlineTextCopies).
    // A `vertical-align` the runtime adds to (see #ownShiftStyle) keeps the
    // runtime's total, which the end of the cycle works out again.
    if (
      this.#setsVariables ||
      (textStyles >= 0 && this.#passesTextStyles) ||
      (key === 'vertical-align' && this.#ownShiftStyle)
    ) {
      this.#rewriteInlineStyle();
    } else {
      __AddInlineStyle(this.element, key, forNative(value));
    }
    if (textStyles >= 0) this.#inlineTextStylesChanged(textStyles);
    // A view's inline size decides the levels of <small>s below it too (see
    // #sizedRelatively), which #inlineTextStylesChanged doesn't reach.
    if (key === 'font-size') this.#passedSizeChanged();
    if (LAYOUT_STYLES.has(key)) this.#layoutChanged();
    if (SHIFT_STYLES.has(key)) this.#shiftStylesChanged();
    if (key === 'quotes') this.#inlineQuotesChanged();
    // A style set outside change detection, as a transition's last frame is
    // from a timer, reaches native only with a flush (see scheduleSettleFlush).
    scheduleSettleFlush();
  }
  removeStyle(key: string): void {
    if (isCustomProperty(key)) {
      if (this.#customProperties?.delete(key)) {
        this.#rewriteInlineStyle();
        if (key === SIZE_VARIABLE) {
          this.#inheritAgain();
          this.#passedSizeChanged();
        }
      }
      return;
    }
    const textStyles = this.#textStylesBefore(key);
    this.#inlineStyleKeys?.delete(key);
    // It goes from the style="..." string too, as `removeProperty()` takes
    // it out of the attribute on the web. Native drops it either way, but
    // a string written again later, as an element that sets variables
    // writes it for each change (see #setsVariables), brought it back: a
    // `<view style="color: red; height: 100px">` with HTML text inside
    // sets copies of its color (see #inlineTextCopies), and a script's
    // `removeProperty('height')` on it kept the height.
    this.#inlineStyleWhole = withoutDeclaration(this.#inlineStyleWhole, key);
    // Removing the key natively would remove the runtime's own declaration
    // of it too, such as an inherited `color` or a <sup>'s offset (see
    // #withRuntimeStyle), which the binding only covered. An HTML text tag
    // whose inline style set the text style has no such declaration yet:
    // it inherits again at the end of the cycle (see
    // #inlineTextStylesChanged), which gives it one, and a native removal
    // meanwhile would leave the default showing until then.
    if (
      this.#setsVariables ||
      (textStyles >= 0 &&
        (this.#passesTextStyles || this.#readsInlineTextStyles())) ||
      this.#runtimeDeclares(key)
    ) {
      this.#rewriteInlineStyle();
    } else {
      __AddInlineStyle(this.element, key, null);
    }
    if (textStyles >= 0) this.#inlineTextStylesChanged(textStyles);
    // A view's inline size decides the levels of <small>s below it too (see
    // #sizedRelatively), which #inlineTextStylesChanged doesn't reach.
    if (key === 'font-size') this.#passedSizeChanged();
    if (LAYOUT_STYLES.has(key)) this.#layoutChanged();
    if (SHIFT_STYLES.has(key)) this.#shiftStylesChanged();
    if (key === 'quotes') this.#inlineQuotesChanged();
    scheduleSettleFlush();
  }
  /**
   * Sets the inline styles a main-thread script set on this element (see
   * script-styles.ts). They go with the `[style.x]` bindings' styles, so
   * whichever was set last wins, as a script's `element.style` write and a
   * binding do on the web, and they're kept when the whole inline style is
   * written again. An empty or null value removes the style, as the DOM's
   * `style.setProperty()` does.
   */
  #setScriptStyles(styles: Record<string, string | null | undefined>): void {
    for (const key in styles) {
      const value = styles[key];
      if (value == null || value === '') this.removeStyle(key);
      else this.setStyle(key, value);
    }
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
    const textStyles = this.#readsInlineTextStyles()
      ? this.#inlineTextFlags()
      : -1;
    const before = this.#inlineStyleWhole;
    const sizeVariable = inlineDeclaration(before, SIZE_VARIABLE);
    this.#inlineStyleWhole = inlineStyle;
    // Written as #rewriteInlineStyle writes it, with the [style.x] styles
    // the app hasn't removed: __SetInlineStyles replaces them all, and the
    // copies of its text styles read them (see #inlineTextCopies), so a
    // `[style.font-size]` lost here left its copy for the tags inside to
    // draw at a size the element no longer had. A style="--x: …" makes the
    // [style.x] styles go into the string (see #setsVariables).
    this.#rewriteInlineStyle();
    if (textStyles >= 0) this.#inlineTextStylesChanged(textStyles);
    // A variable of its own decides whether the size it passes down is
    // relative (see #relativeSize).
    if (inlineDeclaration(inlineStyle, SIZE_VARIABLE) !== sizeVariable) {
      this.#inheritAgain();
    }
    // And so does a view's, as its inline size does (see #sizedRelatively).
    this.#passedSizeChanged();
    this.#layoutChanged();
    for (const property of SHIFT_STYLES) {
      if (
        inlineDeclaration(before, property) !==
        inlineDeclaration(inlineStyle, property)
      ) {
        this.#shiftStylesChanged();
        break;
      }
    }
    if (
      inlineDeclaration(before, 'quotes') !==
      inlineDeclaration(inlineStyle, 'quotes')
    ) {
      this.#inlineQuotesChanged();
    }
    scheduleSettleFlush();
  }

  /**
   * Whether the runtime's own inline declarations (see #withRuntimeStyle)
   * set this property.
   */
  #runtimeDeclares(property: string): boolean {
    return (
      inlineDeclaration(
        [
          this.#hidden ? HIDDEN_STYLE : '',
          this.#inheritStyle,
          this.#runtimeStyle,
          this.#ownShiftStyle,
        ].join('; '),
        property,
      ) !== undefined
    );
  }

  /**
   * An inline `font-size` or `vertical-align` came or went: the HTML text
   * tags from here down work out again how far a `<sub>` or `<sup>` moves
   * them (see #shiftLink).
   */
  #shiftStylesChanged(): void {
    if (this.#webText) this.#inheritAgain();
  }

  /**
   * The element's classes or id changed: so may the text styles it sets
   * itself, which it doesn't inherit, and whether it lays out lines.
   * `changed` holds the tokens added or removed (see #styleTokens), when
   * they're known.
   */
  #rulesChanged(changed?: Iterable<string> | (() => Iterable<string>)): void {
    // Which tokens changed, worked out the first time it's read, if it is
    // (read only while they're known, `changed` given).
    let tokens = changed;
    const read = (): Iterable<string> =>
      typeof tokens === 'function' ? (tokens = tokens()) : tokens!;
    // A Lynx <text>'s rules decide which styles the HTML text tags inside it
    // inherit, and an HTML text tag's decide its own and those of the tags
    // inside it (see #drawnAtDefault).
    if (!this.#anonymous && (this.#webText || this.tagName === 'text')) {
      this.#inheritAgain();
    }
    // A rule of an HTML text tag or a Lynx <text> further down may need this
    // element, as `.card b` needs a `.card` above the `<b>` (see
    // #ownTextStyles and #drawnAtDefault). Only one whose rules require a
    // changed token of an ancestor can have changed: matching them all
    // again below a page that toggles `dark` cost a few milliseconds for
    // every 2,000 tags.
    // (#ancestorsChanged does nothing for an element without either flag,
    // so it's checked before the tokens are.)
    if (
      !this.#anonymous &&
      (this.#webText || this.#passesTextStyles) &&
      (tokens === undefined || ancestorTextRulesRead(read()))
    ) {
      this.#ancestorsChanged();
    }
    // A view's rules decide the levels of <small>s below it too, when a tag
    // read the size it passes on (see #sizedRelatively).
    this.#passedSizeChanged();
    this.#layoutChanged();
    // And the marks of a <q> it is or is in, where a `quotes` rule requires
    // a changed token (see #ownQuotes): through every element below it, as
    // a lang does (see #setLang), since a wrapper made after a hydrated <q>
    // has no flag for it.
    if (quotesRulesRead(tokens === undefined ? undefined : read))
      this.#refreshQuotes(true);
  }

  /**
   * The elements above this one, or their classes, changed: gives each
   * #webText element from here down its inherited styles again, as which of
   * its own rules apply may have changed with them (see #ownTextStyles), and
   * which of the rules of a Lynx `<text>` around it (see #drawnAtDefault).
   * Only a #webText element and an element with one inside (which has
   * #passesTextStyles) can have any, and only a rule that requires an
   * ancestor can change.
   *
   * It goes on below each `<text>`: an HTML `<p>` is a `<text>` too, with
   * tags of its own inside, and so is a Lynx `<text>` inside it. A list's
   * items are outside its #children (see virtualChildren).
   */
  #ancestorsChanged(): void {
    if (!(this.#webText || this.#passesTextStyles)) return;
    if (!hasAncestorTextRules()) return;
    if (this.#webText) LynxElement.#pendingInheritance.add(this);
    for (const child of this.#children ?? NO_CHILDREN)
      child.#ancestorsChanged();
    for (const item of this.virtualChildren()) item.#ancestorsChanged();
  }

  /**
   * Gives this element, if it's a #webText element, and each #webText
   * element inside it through other #webText elements, their inherited
   * styles again at the end of the cycle: what they inherit depends on the
   * elements around them (see #drawnAtDefault). An element of another kind
   * in between ends that, since the styles inside it don't depend on what's
   * above it.
   */
  #inheritAgain(): void {
    if (this.#webText) LynxElement.#pendingInheritance.add(this);
    for (const child of this.#children ?? NO_CHILDREN) {
      if (child.#webText) child.#inheritAgain();
    }
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
   *
   * Native's class list, while #classes may not hold all of it (see
   * #nativeClasses): an element a server render's snapshot made has classes
   * only native knows, and a `.card` there must still count for the `.card
   * .total` of a `<text>` rendered inside it (see #matchedStyleFlags).
   */
  #styleTokens(): Set<string> {
    const tokens = new Set(
      this.#nativeClasses === false
        ? __GetClasses(this.element)
        : splitClasses(this.#classes),
    );
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
    if (!isBlockDisplay(this.#inlineStyle('display'))) return false;
    if (
      isRowOrientation(this.#inlineStyle('linear-orientation')) ||
      isRowOrientation(this.#inlineStyle('linear-direction'))
    ) {
      return false;
    }
    return !(styleFlagsFor(this.#styleTokens()) & LAYOUT_FLAG);
  }

  /**
   * The app's inline value of a property: its `[style.x]` binding's, or its
   * style="..." attribute's.
   */
  #inlineStyle(property: string): unknown {
    return (
      this.#inlineStyleKeys?.get(property) ??
      inlineDeclaration(this.#inlineStyleWhole, property)
    );
  }

  /**
   * The app's inline `vertical-align`, or undefined where it has none.
   */
  #inlineVerticalAlign(): string | undefined {
    const value = this.#inlineStyle('vertical-align');
    return value == null || value === '' ? undefined : String(value);
  }

  /**
   * This element's link in baselineShiftFor's chain, from its flags (an
   * inline size among them, see #textTagChain): the distance of its
   * `vertical-align`, its inline one's if it has one, which wins over its
   * rules.
   */
  #shiftLink(flags: number): ShiftLink {
    const inline = this.#inlineVerticalAlign();
    return [
      flags,
      inline !== undefined
        ? parseVerticalAlign(inline)
        : flags & VERTICAL_ALIGN_FLAG
          ? this.#matchedVerticalAlign()
          : undefined,
    ];
  }

  /**
   * The inline `vertical-align` that moves this #webText element with the
   * HTML text tags above it (see baselineShiftFor), or none: from the
   * elements of #textTagChain. Only a tag above with a `vertical-align` moves
   * it. A tag whose own inline style sets one gets its own distance added
   * to those above, as a browser draws it (issue #736), where Lynx can hold
   * the sum (see inlineBaselineShift): `2px` inside a tag raised `4px` is
   * `6px`, but `0.5em` inside it is no single length, so the tag keeps its
   * own value alone.
   */
  #baselineShift(elements: readonly [LynxElement, number][]): string {
    if (
      !elements.some(
        ([element, flags], index) =>
          index > 0 &&
          (flags & VERTICAL_ALIGN_FLAG ||
            element.#inlineVerticalAlign() !== undefined),
      )
    ) {
      return '';
    }
    return baselineShiftStyle(
      elements.map(([element, flags]) => element.#shiftLink(flags)),
    );
  }

  /**
   * Gives a #webText element the inherited value of each text style its own
   * rules don't set (see #inheritStyle). An anonymous `<text>` has no rules
   * of its own, and takes them all.
   *
   * An HTML text tag's own rules are the ones that would match it on the
   * web, so a rule whose selector names `text` isn't one. Lynx matches it,
   * since the `<p>` is a `<text>`, so the theme's `view > text` gave every
   * `<p>` in a `<view>` the color `--foreground`, whatever color the view
   * set (issue #610). Read the variable instead, and the nearest ancestor's
   * color wins over that rule. The theme sets the page's color, which the
   * page passes down too, so a `<p>` no other ancestor colors takes that,
   * as on the web. Where no ancestor sets the variable, the `var()` makes
   * the declaration unset, so the rule doesn't apply either (seen on iOS and
   * in the web preview), which is again what the web draws.
   */
  #applyInheritance(): void {
    // A <small>'s own rule divides the size around it once: the text inside
    // it, or a second <small>, needs a class that divides it more (see
    // #sizeChain). The class sets the size, so it reads no variable.
    const tags = this.#textTagChain();
    const sized = this.#sizeChain(tags);
    const levels = sized.filter(([, flags]) => flags & SMALLER_FLAG).length;
    const ownLevel = this.#ruleFlags(false) & SMALLER_FLAG ? 1 : 0;
    const smaller =
      levels > ownLevel && !this.#sizedRelatively(tags, sized.length)
        ? smallerClassFor(levels)
        : null;
    this.#setSmallerClass(smaller);
    const inherited = inheritanceStyleFor(
      this.#ownTextStyles(true) |
        this.#drawnAtDefault() |
        (smaller ? FONT_SIZE_FLAG : 0),
    );
    const shift = this.#baselineShift(tags);
    // A tag's own inline `vertical-align` would win over a shift ahead of
    // it, and the shift includes it, so it goes after it (see
    // #ownShiftStyle).
    const ownShift = this.#inlineVerticalAlign() !== undefined ? shift : '';
    const style =
      shift && !ownShift
        ? [inherited, shift].filter(Boolean).join('; ')
        : inherited;
    if (style === this.#inheritStyle && ownShift === this.#ownShiftStyle) {
      return;
    }
    this.#inheritStyle = style;
    this.#ownShiftStyle = ownShift;
    // One removed this cycle gets it when it's rebuilt (see #recreateSubtree).
    if (!this.#paintingDead) this.#rewriteInlineStyle();
  }

  /**
   * The text properties this element's own rules set, as a bitmask (see
   * INHERITED_TEXT_PROPERTIES). An anonymous `<text>` has none. An HTML text
   * tag's leave out the rules whose selector names `text`, which match it on
   * Lynx, as it's a `<text>`, but not on the web (see #applyInheritance): it
   * reads the variable for those, and has no copy of them for the tags inside
   * it (see LYNX_TEXT_INHERITANCE_CLASS).
   *
   * Each rule is checked against the elements above it (see
   * #matchedStyleFlags): `.card b { font-size: 24px }` counted for every
   * `<b>` left a `<b>` outside `.card` at Lynx's default size, not that of
   * the text around it (issue #667). A rule for a state counts when
   * `inState` is true (see matchedStyleFlagsFor).
   */
  #ownTextStyles(inState: boolean): number {
    const flags = this.#ruleFlags(inState);
    // A <small>'s rule sets its size too, from the size around it. Its
    // inline style sets them as its rules do: an HTML text tag's wins over
    // what it would inherit, and a Lynx `<text>`'s goes to the tags inside
    // through the copies (see #inlineTextCopies), rather than leaving them
    // at the default (issue #690).
    return (
      (flags & ALL_TEXT_PROPERTIES) |
      (flags & SMALLER_FLAG ? FONT_SIZE_FLAG : 0) |
      this.#inlineTextFlags()
    );
  }

  /**
   * The style index flags of this element's own rules (see #ownTextStyles):
   * none for an anonymous `<text>`, and an HTML text tag's leave out the
   * rules whose selector names `text`. Each rule is checked against the
   * elements above it, and a rule for a state counts when `inState` is true
   * (see #matchedStyleFlags).
   */
  #ruleFlags(inState: boolean): number {
    if (this.#anonymous) return 0;
    return this.#matchedStyleFlags(this.#ruleTokens(), inState);
  }

  /**
   * The tokens this element's own rules match it by (see #ruleFlags).
   */
  #ruleTokens(): Set<string> {
    const tokens = this.#styleTokens();
    if (this.#webText) tokens.delete('<text>');
    // The runtime's own class for nested <small>s follows from these flags
    // (see #setSmallerClass), so it can't count among them.
    if (this.#smallerClass) tokens.delete(this.#smallerClass);
    return tokens;
  }

  /**
   * Gives this element the class for its level of `<small>`s (see
   * smallerClassFor), or none, in place of the one it had. It's kept with the
   * scope classes, so an app's class binding keeps it, as setRuntimeClass
   * does. Unlike there, it changes nothing the runtime reads, so it skips
   * #rulesChanged, which would work this element's inheritance out again.
   */
  #setSmallerClass(name: string | null): void {
    const current = this.#smallerClass;
    if (current === name) return;
    this.#smallerClass = name;
    if (current) {
      const index = this.#scopeClasses!.indexOf(current);
      this.#scopeClasses!.splice(index, 1);
      this.#removeClassName(current);
    }
    if (name) {
      (this.#scopeClasses ??= []).push(name);
      this.#addClassName(name);
    }
  }

  /**
   * Of #textTagChain's elements, this #webText element and the HTML text
   * tags above it up to the nearest ancestor whose rules set the size with a
   * copy, which the variable holds. Those with SMALLER_FLAG are the
   * `<small>`, `<sub>` and `<sup>` tags that make its text smaller, itself
   * included.
   *
   * The build's rule for the tags divides the parent's variable by 1.2 and,
   * reading the variable it would be copied to, has no copy (see
   * SMALLER_FLAG). So the text inside a `<small>` read the size around it:
   * `<small>a <b>b</b></small>` drew the `<b>` at the full size, and a
   * `<small>` in a `<small>` at the outer one's (issue #663). Each level
   * divides again, as in a browser.
   *
   * Each element's rules are checked against the elements above it (see
   * #matchedStyleFlags): `.compact .label` with the build's smaller size
   * makes no level for a `.label` outside `.compact`. It stops at an element
   * that isn't an HTML text tag, as #drawnAtDefault does: a Lynx `<text>` or
   * a view sizes its own text. Moving the element or changing an ancestor's
   * classes works it out again (see #inheritAgain and #ancestorsChanged).
   */
  #sizeChain(tags: [LynxElement, number][]): [LynxElement, number][] {
    if (tags[0]![1] & FONT_SIZE_FLAG) return tags.slice(0, 1);
    const sized = tags.findIndex(
      ([, flags], index) => index > 0 && flags & FONT_SIZE_FLAG,
    );
    return sized < 0 ? tags : tags.slice(0, sized);
  }

  /**
   * Whether the size the variable holds at the tags of #sizeChain, the first
   * `length` of `tags`, is relative (see #relativeSize): that of the tag
   * above them that sets it, or where none does, that of the nearest element
   * above the tags that sets it, the Lynx `<text>` they're in, as in
   * `<text class="big">a <small>b <b>c</b></small></text>`, or a view further
   * up, as in `<div class="text-[2em]">a <small>b <b>c</b></small></div>`.
   * Reading only the `<text>` left the `<b>` there divided again, a level
   * smaller than in a browser (issue #750).
   *
   * Each element it reads above the tags keeps what kind of size it passed
   * (#passedSizeSeen), so a change to it that changes the kind works the
   * tags' levels out again (see #passedSizeChanged). Only the `<small>`s
   * whose levels it read pay for that.
   */
  #sizedRelatively(tags: [LynxElement, number][], length: number): boolean {
    // A variable a tag of the chain sets itself is what the tags inside read,
    // whatever is above it, and it isn't `1em` (see #relativeSize): in
    // `<small style="--angular-lynx-font-size: 20px">b <b>c</b></small>`
    // the `<small>` divides it, so the `<b>` must too (review of #786). A
    // change to it inherits again from that tag down (see setStyle).
    for (let index = 0; index < length; index++) {
      if (tags[index]![0].#ownSizeVariable() !== undefined) return false;
    }
    const sizer = tags[length]?.[0];
    if (sizer) return sizer.#relativeSize();
    // A list's item has the list as its parent (see #passTextStyles).
    const last = tags[tags.length - 1]![0];
    for (
      let parent = last._virtualParent ?? last.#jsParent;
      parent;
      parent = parent._virtualParent ?? parent.#jsParent
    ) {
      const kind = parent.#passedSize();
      parent.#passedSizeSeen = kind;
      if (kind !== PassedSize.None) return kind === PassedSize.Relative;
    }
    return false;
  }

  /**
   * What kind of size this element passes to the HTML text tags inside
   * through the variable (see #sizedRelatively): none where neither its
   * rules, nor its inline style, nor a variable the app sets itself sets it,
   * and the size from above passes through. A `<small>`'s rule sets no copy
   * (see SMALLER_FLAG), so it passes none either. An anonymous `<text>` is
   * never an element's #jsParent, so it isn't asked.
   */
  #passedSize(): PassedSize {
    if (
      this.#ownSizeVariable() === undefined &&
      !((this.#ruleFlags(false) | this.#inlineTextFlags()) & FONT_SIZE_FLAG)
    ) {
      return PassedSize.None;
    }
    return this.#relativeSize() ? PassedSize.Relative : PassedSize.Absolute;
  }

  /**
   * Its classes or inline style changed: if an HTML text tag inside read the
   * size it passes on (see #passedSizeSeen) and its kind is now another, the
   * tags inside work their levels of `<small>`s out again. A change that
   * keeps the kind, such as `20px` to `24px`, or a page's `dark` class,
   * changes no level and walks nothing.
   */
  #passedSizeChanged(): void {
    if (this.#passedSizeSeen === undefined) return;
    const kind = this.#passedSize();
    if (kind === this.#passedSizeSeen) return;
    this.#passedSizeSeen = kind;
    this.#outerSizeChanged();
  }

  /**
   * The size passed to this element from above may have changed (see
   * #passedSizeChanged), or it moved: gives each #webText element from here
   * down its inherited styles again, through the elements whose size a tag
   * read (#passedSizeSeen), as only those have such tags inside, or are
   * HTML text tags.
   */
  #outerSizeChanged(): void {
    if (this.#webText) LynxElement.#pendingInheritance.add(this);
    else if (this.#passedSizeSeen === undefined) return;
    for (const child of this.#children ?? NO_CHILDREN) {
      child.#outerSizeChanged();
    }
    for (const item of this.virtualChildren()) item.#outerSizeChanged();
  }

  /**
   * The `--angular-lynx-font-size` the app's inline style sets itself, from
   * a `[style.--angular-lynx-font-size]` binding or its style="..." string,
   * or undefined where it sets none.
   */
  #ownSizeVariable(): string | undefined {
    return (
      this.#customProperties?.get(SIZE_VARIABLE) ??
      inlineDeclaration(this.#inlineStyleWhole, SIZE_VARIABLE)
    );
  }

  /**
   * Whether the size this element passes to the text inside is relative to
   * its parent's (see RELATIVE_SIZE_FLAG): its inline `font-size`'s, which
   * wins over its rules, or else its rules'. Its copy is then `1em`, the size
   * of the parent of the tag that reads it. Below it, each `<small>`'s own
   * rule divides that once, and the text inside it reads it as it is: a class
   * dividing it for each `<small>` above would divide it again (issue #701).
   *
   * A variable the app's inline style sets itself wins over the copies, the
   * runtime's and its rules' (see #inlineTextCopies): it isn't `1em`, so the
   * levels divide it as they divide any size.
   */
  #relativeSize(): boolean {
    if (this.#ownSizeVariable() !== undefined) return false;
    const inline = this.#inlineStyle('font-size');
    if (inline != null && inline !== '') {
      return isRelativeFontSize(String(inline));
    }
    return !!(this.#ruleFlags(false) & RELATIVE_SIZE_FLAG);
  }

  /**
   * This #webText element and each HTML text tag above it, nearest first,
   * with the style index flags of its rules: for #sizeChain, and for
   * baselineShiftFor, which follows the tags with a `vertical-align` past
   * one that sets its size, as a `px` distance there still moves the text
   * inside it. It stops at an element that isn't an HTML text tag, as
   * #drawnAtDefault does: a Lynx `<text>` or a view lays out its own text.
   */
  #textTagChain(): [LynxElement, number][] {
    // A state's rule counts for none of them, as in #drawnAtDefault: the
    // levels are those of the tags as they usually draw.
    // An inline size sets it as a rule does, and an ancestor's has its copy
    // in the variable (see #inlineTextCopies).
    const chain: [LynxElement, number][] = [
      [this, this.#ruleFlags(false) | this.#inlineTextFlags()],
    ];
    for (
      let parent = this.#jsParent;
      parent && parent.#webText;
      parent = parent.#jsParent
    ) {
      chain.push([
        parent,
        parent.#ruleFlags(false) | parent.#inlineTextFlags(),
      ]);
    }
    return chain;
  }

  /**
   * The text properties the app's inline style sets, as a bitmask (see
   * inlineTextStyles).
   */
  #inlineTextFlags(): number {
    if (!this.#inlineStyleWhole && !this.#inlineStyleKeys?.size) return 0;
    return textPropertyFlags(
      inlineTextStyles(this.#inlineStyleWhole, this.#inlineStyleKeys),
    );
  }

  /**
   * Whether which text properties its inline style sets decides what HTML
   * text tags inherit (see #ownTextStyles): its own, as one, or those inside
   * it, as a Lynx `<text>`. An element of another kind passes its inline
   * values down through the copies alone, whose `var()`s Lynx resolves.
   */
  #readsInlineTextStyles(): boolean {
    return !this.#anonymous && (this.#webText || this.tagName === 'text');
  }

  /**
   * Before a `[style.x]` change: the text properties the inline style sets,
   * if `key` is one and the element reads them (see #readsInlineTextStyles),
   * 0 if it's one the element doesn't read, and -1 for any other key.
   */
  #textStylesBefore(key: string): number {
    if (!textPropertyBit(key)) return -1;
    return this.#readsInlineTextStyles() ? this.#inlineTextFlags() : 0;
  }

  /**
   * After an inline style change: if the text properties it sets aren't
   * those it set before, the HTML text tags in and below it inherit again.
   */
  #inlineTextStylesChanged(before: number): void {
    if (!this.#readsInlineTextStyles()) return;
    if (this.#inlineTextFlags() !== before) this.#inheritAgain();
  }

  /**
   * The copies of the app's inline text styles to the variables the HTML
   * text tags inside read (see inheritanceCopiesFor), on an element that
   * passes text styles down (see #passTextStyles). `inlineStyle` is the
   * style="..." string about to be written.
   */
  #inlineTextCopies(inlineStyle: string | null): string {
    if (!this.#passesTextStyles || this.#anonymous) return '';
    if (!inlineStyle && !this.#inlineStyleKeys?.size) return '';
    return inheritanceCopiesFor(
      inlineTextStyles(inlineStyle, this.#inlineStyleKeys),
    );
  }

  /**
   * The text properties this #webText element should leave at Lynx's
   * default, as a bitmask (see INHERITED_TEXT_PROPERTIES): in a Lynx
   * `<text>`, those the `<text>` draws at its own default, which no rule of
   * its or of an HTML text tag between them sets.
   *
   * A Lynx `<text>` reads none of the variables (see text-flow.ts), so it
   * draws a property its rules don't set at Lynx's default, whatever its
   * ancestors set: `color` at black under a red `<view>`. The variable an
   * inline tag in it reads comes from those ancestors, so
   * `<text>Total: <b>12</b></text>` drew the `<b>` at the theme's 16px
   * beside 14px text (issue #646). Left out, the tag draws as the `<text>`
   * does: at the default, at the `<text>`'s `color` and `font-family`, which
   * Lynx passes to a `<text>` inside a `<text>`, and at its `font-size`,
   * which the native build has Lynx inherit (`customCSSInheritanceList`,
   * issue #685); the web preview inherits through the DOM either way. A property one of them does set has its copy in the variable
   * (each gets INHERITANCE_CLASS, see #passTextStyles), which the tag reads,
   * as before.
   *
   * Which of their rules apply is checked against the elements above them
   * (see matchedStyleFlagsFor): a rule such as `.card .total { font-size:
   * 24px }` that counted for a `<text class="total">` outside `.card` too
   * let the tag read the variable, and take its ancestors' value, there
   * (issue #652). It's worked out again when their classes change, or those
   * of an element above them (see #ancestorsChanged).
   */
  #drawnAtDefault(): number {
    let set = 0;
    for (let parent = this.#jsParent; parent; parent = parent.#jsParent) {
      // Above the HTML text tags, only a Lynx <text>'s rules count: the
      // element around the tags is matched only if it's one.
      if (!parent.#webText && parent.tagName !== 'text') return 0;
      // The rules that give each one a copy of the property (see
      // #ownTextStyles): an HTML text tag's leave out those naming `text`,
      // and each is checked against the elements above it. A state's rule
      // counts for none of them, as the <text> draws at the default
      // without it.
      set |= parent.#ownTextStyles(false);
      if (!parent.#webText) return ALL_TEXT_PROPERTIES & ~set;
    }
    return 0;
  }

  /**
   * The flags of the app's rules that apply to this element, with these of
   * its tokens, checked against its ancestors (see matchedStyleFlagsFor).
   * It reads them up the tree as a list item's parent is its list (see
   * #passTextStyles), and only as far as a rule needs. The ancestors keep
   * every token, as Lynx matches them natively: a `<p>` above is a `<text>`
   * there.
   */
  #matchedStyleFlags(tokens: ReadonlySet<string>, inState: boolean): number {
    return matchedStyleFlagsFor(tokens, this.#ancestorTokens(), inState);
  }

  /**
   * The distance of the `vertical-align` this element's rules give it (see
   * matchedVerticalAlignFor).
   */
  #matchedVerticalAlign(): BaselineDistance | null | undefined {
    return matchedVerticalAlignFor(this.#ruleTokens(), this.#ancestorTokens());
  }

  /**
   * The tokens of this element's ancestors, nearest first, read as a rule
   * asks for them (see matchedStyleFlagsFor).
   */
  #ancestorTokens(): (index: number) => Set<string> | undefined {
    const ancestors: Set<string>[] = [];
    let next = this._virtualParent ?? this.#jsParent;
    return (index) => {
      while (ancestors.length <= index && next) {
        ancestors.push(next.#styleTokens());
        next = next._virtualParent ?? next.#jsParent;
      }
      return ancestors[index];
    };
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
   * @internal Gives a `<q>` its quotation marks, which a browser draws with
   * `q::before { content: open-quote }` and `q::after { content: close-quote
   * }`. Lynx has no `::before`/`::after` content, so the marks are raw-texts
   * of the `<q>`'s own, at the start and the end of its native children,
   * kept out of #children: Angular never sees them, as it never sees a
   * browser's generated content. Its children go between them (see
   * #appendPrepared), and nextSibling() ends at the closing one.
   *
   * With `existing`, the marks a server render drew, which the snapshot
   * holds (see LynxHydrateDocument). A hydrated element is already in the
   * snapshot's tree, and hydration inserts nothing, so its depth and
   * language are read from its native ancestors, which hydrate before it
   * (see #quoteParent), and they're flagged as holding it, for a `lang` of
   * theirs that changes later.
   */
  markQuote(existing?: [open: ElementRef, close: ElementRef]): void {
    const open = LynxElement.#quoteMarkText(existing?.[0]);
    const close = LynxElement.#quoteMarkText(existing?.[1]);
    open.#jsParent = this;
    close.#jsParent = this;
    this.#quoteMarks = [open, close];
    if (!existing) {
      __AppendElement(this.element, open.element);
      __AppendElement(this.element, close.element);
    }
    // Flags its hydrated ancestors (with itself, which changes nothing: a
    // <q> is visited for its own marks anyway).
    if (existing) this.#holdQuote();
    this.#refreshQuotes();
  }

  /**
   * The element a `<q>` in this one counts as being in, for its depth and
   * language: its JS parent, or a list item's list (see adoptVirtualChild),
   * or, for a hydrated element, which hydration puts in no JS parent (the
   * snapshot's tree is built already), its nearest native ancestor with a
   * wrapper. Its native ancestors hydrated before it, with their
   * attributes. A snapshot's anonymous texts have no wrapper, so they're
   * passed over, as Angular never sees them.
   */
  #quoteParent(): LynxElement | null {
    const parent = this._virtualParent ?? this.#jsParent;
    if (parent) return parent;
    for (let at = __GetParent(this.element); at; at = __GetParent(at)) {
      const ancestor = LynxElement.#registered(__GetElementUniqueID(at));
      if (ancestor) return ancestor;
    }
    return null;
  }

  /**
   * Gives the `<q>`s in this element, itself included, their marks again
   * (see #setQuoteDepth), from how many `<q>`s are around it, and the
   * language and `quotes` it inherits. An element in nothing has no `<q>`s
   * around it, the document's language, and `quotes: auto`.
   */
  #refreshQuotes(everyChild = false): void {
    const parent = this.#quoteParent();
    if (parent) {
      this.#setQuoteDepth(
        parent.#quoteDepth(),
        parent.#language(),
        parent.#quotes(),
        everyChild,
      );
    } else this.#setQuoteDepth(0, getDocumentLanguage(), 'auto', everyChild);
  }

  /**
   * The `quotes` of this element: its own (see #ownQuotes), or else the one
   * it inherits, as `quotes` is an inherited property, up to the initial
   * `auto`.
   */
  #quotes(): QuoteMarks {
    const own = this.#ownQuotes();
    if (own !== 'inherit') return own;
    const parent = this.#quoteParent();
    return parent ? parent.#quotes() : 'auto';
  }

  /**
   * The `quotes` this element's inline style or rules give it, or `inherit`
   * where neither does. The runtime can't read a computed style on Lynx, so
   * the rules are the build's index of them (see matchedQuotesFor): the one
   * that wins the cascade, which an inline style beats unless the rule is
   * `!important` and it isn't. A rule the runtime can't tell applies (see
   * the build plugin's QuotesRule) draws the language's marks, as without
   * one.
   */
  #ownQuotes(): QuoteMarks | 'inherit' {
    const rules = hasQuotesRules();
    if (!rules && !LynxElement.#inlineQuotesSeen) return 'inherit';
    const inline = String(this.#inlineStyle('quotes') ?? '');
    // An inline `revert-layer` rolls the inline style back to the rules, as
    // though there were none (the style attribute is a layer of its own
    // above them); a rule's, like `revert`, goes back to inheriting, as no
    // rule of the build's index is in a `@layer` (see its QuotesRule).
    const inlineValue =
      inline && !/^[ \t\n\r\f]*revert-layer\b/i.test(inline)
        ? parseQuotes(inline)
        : undefined;
    const matched = rules
      ? matchedQuotesFor(this.#ruleTokens(), this.#quoteAncestorTokens())
      : undefined;
    if (
      inlineValue !== undefined &&
      (!matched?.important || /!\s*important\s*$/i.test(inline))
    ) {
      return inlineValue;
    }
    if (!matched) return 'inherit';
    if (matched.value === null) return 'auto';
    return parseQuotes(matched.value) ?? 'inherit';
  }

  /**
   * The tokens of this element's ancestors, nearest first, for a `quotes`
   * rule (see #ownQuotes): up the elements #quoteParent goes through, so a
   * hydrated element, which has no JS parent, has its native ancestors, and
   * passing over the anonymous `<text>`s loose text shares with a `<q>` (see
   * #regroup), which a browser has no element for, so that `.card > q`
   * matches the `<q>` in one. Each has the tokens its own rules match (see
   * #ruleTokens): an HTML text tag such as a `<p>` is a `<text>` natively,
   * but a browser has no `text` above the `<q>`.
   */
  #quoteAncestorTokens(): (index: number) => Set<string> | undefined {
    const ancestors: Set<string>[] = [];
    let next = this.#quoteParent();
    return (index) => {
      while (ancestors.length <= index && next) {
        if (!next.#anonymous) ancestors.push(next.#ruleTokens());
        next = next.#quoteParent();
      }
      return ancestors[index];
    };
  }

  /**
   * An inline `quotes` came, went or changed: the `<q>`s in this element,
   * itself included, draw its marks (see #ownQuotes). Until one is set, no
   * element reads its inline style for it.
   */
  #inlineQuotesChanged(): void {
    LynxElement.#inlineQuotesSeen = true;
    // Through every element below, as for a class (see #rulesChanged).
    this.#refreshQuotes(true);
  }

  /** Whether an inline `quotes` was ever set (see #ownQuotes). */
  static #inlineQuotesSeen = false;

  /**
   * The language of this element: the nearest `lang` attribute on it or
   * above it, or the document's, as a browser's content language is.
   */
  #language(): string {
    if (this.#lang !== undefined) return this.#lang;
    const parent = this.#quoteParent();
    return parent ? parent.#language() : getDocumentLanguage();
  }

  /**
   * Records a `lang` attribute, and gives the `<q>`s in this element the
   * marks of their language now, as a browser restyles them.
   */
  #setLang(value: unknown): void {
    const lang = value == null ? undefined : String(value);
    if (lang === this.#lang) return;
    this.#lang = lang;
    // Every element below it, not only the flagged ones (see
    // #eachQuoteChild): a hydrated <q> flags the wrappers its native
    // ancestors had when it hydrated, and a wrapper made later, which may
    // since have JS children of its own, has no flag. A lang that changes
    // is rare, and a static one is set before Angular puts children in.
    this.#refreshQuotes(true);
  }

  /**
   * @internal Whether `ref` is a `<q>`'s quotation mark (see markQuote),
   * which a server render's snapshot holds but Angular never asks for.
   */
  static isQuoteMark(ref: ElementRef): boolean {
    const element = LynxElement.#registered(__GetElementUniqueID(ref));
    return element !== undefined && element.#quoteMark;
  }

  /**
   * A quotation mark's raw-text (see markQuote and #setQuoteDepth).
   */
  static #quoteMarkText(existing?: ElementRef): LynxElement {
    const mark = new LynxElement(existing ?? __CreateRawText(''));
    mark.tagName = 'raw-text';
    mark.#quoteMark = true;
    return mark;
  }

  /**
   * Flags this element and its ancestors as holding a `<q>` (see
   * #holdsQuote). One that has the flag has its own ancestors flagged
   * already: that's how it got it, and an element that moves flags its new
   * ones in #adoptChild.
   */
  #holdQuote(): void {
    if (this.#holdsQuote) return;
    this.#holdsQuote = true;
    const parent = this.#quoteParent();
    if (parent) parent.#holdQuote();
  }

  /**
   * How many `<q>`s this element is in, itself included: the depth of a
   * `<q>` put in it.
   */
  #quoteDepth(): number {
    const own = this.#quoteMarks ? 1 : 0;
    const parent = this.#quoteParent();
    return own + (parent ? parent.#quoteDepth() : 0);
  }

  /**
   * Gives the `<q>`s in this element, itself included, the marks for how
   * deep each is, for its language and for its `quotes`, `depth` being this
   * one's and `outerLanguage` and `outerQuotes` the ones it inherits. As a
   * browser's `quotes: auto` does, a `<q>` draws its language's outer pair
   * outside any other (“ ” in English, « » in French) and its inner pair
   * inside one (‘ ’, « »), which deeper ones repeat; each takes the
   * language of its own nearest `lang` (see quotes.ts). A `quotes` of its
   * own or inherited, from a rule or an inline style (see #ownQuotes), gives
   * it those pairs instead, or none for `none` (see quotePairFor). Run when a `<q>`, or an element one is in, goes
   * into an element (see #adoptChild): when Angular builds one, when
   * content projection moves one into another, and when an element built
   * with a `<q>` inside goes in after it; when a `lang` changes (see
   * #setLang), with `everyChild`, which goes through every element below
   * rather than only those that hold a `<q>`; and when a `quotes` may have
   * (see #rulesChanged and #inlineQuotesChanged).
   */
  #setQuoteDepth(
    depth: number,
    outerLanguage: string,
    outerQuotes: QuoteMarks,
    everyChild = false,
  ): void {
    let inner = depth;
    const language = this.#lang ?? outerLanguage;
    const own = this.#ownQuotes();
    const quotes = own === 'inherit' ? outerQuotes : own;
    if (this.#quoteMarks) {
      const [open, close] = this.#quoteMarks;
      const [openMark, closeMark] = quotePairFor(quotes, depth, language);
      open.#setQuoteMark(openMark);
      close.#setQuoteMark(closeMark);
      inner++;
    }
    const pass = (child: LynxElement): void => {
      if (everyChild || child.#holdsQuote || child.#quoteMarks) {
        child.#setQuoteDepth(inner, language, quotes, everyChild);
      }
    };
    // The native children, not #children: a hydrated element's aren't in
    // it (hydration inserts nothing), and a list's items are its virtual
    // children instead.
    LynxElement.#eachQuoteChild(this.element, pass);
    for (const child of this.virtualChildren()) pass(child);
  }

  /**
   * Calls `fn` with the wrapper of each native child of `ref`, looking
   * through what isn't one of Angular's elements, which a `<q>` can be in:
   * an anonymous `<text>` (see #regroup) and a snapshot's element without
   * a wrapper.
   */
  static #eachQuoteChild(
    ref: ElementRef,
    fn: (child: LynxElement) => void,
  ): void {
    for (let at = __FirstElement(ref); at; at = __NextElement(at)) {
      const child = LynxElement.#registered(__GetElementUniqueID(at));
      if (!child || child.#anonymous) LynxElement.#eachQuoteChild(at, fn);
      else fn(child);
    }
  }

  /**
   * A new native raw-text for a quotation mark, with its text, for its
   * `<q>`'s rebuilt element (see #recreateSubtree).
   */
  #renewQuoteMark(): ElementRef {
    this.deregisterNative();
    // #setQuoteDepth gave it its text when its <q> was made.
    this.#nativeRef = __CreateRawText(this.#text as string);
    LynxElement.#register(__GetElementUniqueID(this.#nativeRef), this);
    return this.#nativeRef;
  }

  /**
   * Sets a quotation mark's text (see #setQuoteDepth).
   */
  #setQuoteMark(text: string): void {
    if (this.#rawText === text) return;
    this.#rawText = text;
    this.#text = text;
    __SetAttribute(this.element, 'text', text);
    // The marks are text of the line (see #collectRawTextLeaves), so the
    // spaces beside them are trimmed again: `quotes: none` leaves the space
    // in `<q> hi </q>` at the edge of the line, where a browser drops it, and
    // marks that come back keep it again. A mark's JS parent is its <q>,
    // which markQuote sets before it draws the marks.
    LynxElement.#enqueueTextNormalization(this.#jsParent!);
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
   * then the copies of the app's text styles (see #inlineTextCopies), then
   * the app's style="...", then the runtime's total of its own
   * `vertical-align` (see #ownShiftStyle), then its `[style.--x]`
   * variables, which win over the attribute as bindings do on the web.
   * Without runtime declarations or variables it's the app's value as is.
   */
  #withRuntimeStyle(inlineStyle: string | null): string | null {
    const customProperties = this.#customProperties;
    const copies = this.#inlineTextCopies(inlineStyle);
    if (
      !this.#hidden &&
      !this.#inheritStyle &&
      !this.#runtimeStyle &&
      !this.#ownShiftStyle &&
      !copies &&
      !customProperties?.size
    ) {
      return inlineStyle;
    }
    const variables = customProperties
      ? [...customProperties]
          .map(([name, value]) => `${name}: ${value}`)
          .join('; ')
      : '';
    return [
      this.#hidden ? HIDDEN_STYLE : '',
      this.#inheritStyle,
      this.#runtimeStyle,
      // Ahead of the app's own declarations, so a `--angular-lynx-color` it
      // sets itself wins over the copy of its `color`, as the build keeps
      // one a rule sets.
      copies,
      inlineStyle?.replace(/[\s;]+$/, ''),
      this.#ownShiftStyle,
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
    return forNative(this.#withRuntimeStyle(inlineStyle));
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
    // Custom properties, `hidden` and the runtime's own styles (materials,
    // insets, inheritance) ask for no flush themselves (see
    // nativeWriteEpoch).
    nativeWriteEpoch++;
    const whole = this.#inlineStyleFor(this.#inlineStyleWhole);
    if (whole && VARIABLE_DECLARATION.test(whole)) this.#setsVariables = true;
    // An element that sets variables gets its [style.x] styles in the same
    // string: an __AddInlineStyle after it would hide a variable's change
    // from the descendants (see #setsVariables).
    if (this.#setsVariables) {
      __SetInlineStyles(this.element, withStyleKeys(whole, this.#nativeKeys()));
      return;
    }
    __SetInlineStyles(this.element, whole);
    // __SetInlineStyles replaces every inline style, including the [style.x]
    // ones __AddInlineStyle set, which the app didn't ask to drop.
    const keys = this.#nativeKeys();
    if (keys) {
      for (const [key, value] of keys) {
        __AddInlineStyle(this.element, key, forNative(value));
      }
    }
  }

  /**
   * The `[style.x]` styles to give the native element after its whole
   * inline style: all of them, but a `[style.vertical-align]` where the
   * runtime's total of it, already in the string after the app's own
   * declarations, has to win over it (see #ownShiftStyle).
   */
  #nativeKeys(): Map<string, unknown> | null {
    const keys = this.#inlineStyleKeys;
    if (!this.#ownShiftStyle || !keys?.has('vertical-align')) return keys;
    const rest = new Map(keys);
    rest.delete('vertical-align');
    return rest;
  }

  insertBefore(newChild: LynxElement, refChild: LynxElement | null): void {
    // Inserts and moves ask for no flush themselves (see nativeWriteEpoch).
    nativeWriteEpoch++;
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
      // The checks above are #append's own, done once (see #appendPrepared).
      this.#appendPrepared(newChild);
    } else {
      // Never insert an element into its own subtree — Lynx would build a cyclic
      // native tree and hang the layout pass (see wouldFormCycle). Skipping is
      // safe: a cyclic insert is a corrupt request, and leaving newChild where it
      // is beats freezing the app.
      if (this.#wouldFormCycle(newChild)) return;
      const moving = isWebMove(newChild);
      if (insertHidesBlurView(this, newChild)) {
        this.#appendBefore(newChild, refChild);
      } else {
        __InsertElementBefore(this.element, newChild.element, refChild.element);
      }
      if (moving) newChild.#restartWebLayoutChanges();
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
    nativeWriteEpoch++;
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
    this.#appendPrepared(newChild);
  }

  /**
   * #append once its checks on `newChild` have run, which #attach runs
   * itself. Running them twice did nothing more the second time, but read
   * the child's native parent again, and for a move to another parent walked
   * both ancestries again (see #removeIfMoveWouldBeLost).
   */
  #appendPrepared(newChild: LynxElement): void {
    // Guard against a cycle-forming attach (see wouldFormCycle) — the same hang
    // insertBefore protects against.
    if (this.#wouldFormCycle(newChild)) return;
    const moving = isWebMove(newChild);
    // A <q>'s children go before its closing mark (see markQuote).
    const close = this.#quoteMarks?.[1];
    if (close) {
      __InsertElementBefore(this.element, newChild.element, close.element);
    } else {
      __AppendElement(this.element, newChild.element);
    }
    if (moving) newChild.#restartWebLayoutChanges();
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
      const i = prev.#children!.indexOf(newChild);
      // Defensive: if newChild is tracked as a child of `prev`, indexOf always
      // finds it. The i < 0 branch would only fire on a bookkeeping mismatch
      // that shouldn't happen through the public API.
      /* v8 ignore next */
      if (i >= 0) prev.#children!.splice(i, 1);
      // The loose text it leaves may need regrouping (see #regroup).
      if (prev !== this && !LynxElement.#regrouping) {
        const holder = prev.#anonymous ? prev.#jsParent : prev;
        if (holder && holder.#hasFlow) LynxElement.#pendingFlow.add(holder);
      }
    }
    newChild.#jsParent = this;
    const children = (this.#children ??= []);
    if (refChild) {
      // From the end: `@for` puts each new item before its anchor, which
      // follows them all, so searching from the front cost a step per item
      // already there. A child is in #children once, so both find the same.
      const idx = children.lastIndexOf(refChild);
      // Defensive: refChild always sits in #children when it's used as an
      // anchor for insertBefore. If a caller passes a foreign refChild, fall
      // back to appending at the tail rather than throwing.
      /* v8 ignore next */
      children.splice(idx < 0 ? children.length : idx, 0, newChild);
    } else {
      children.push(newChild);
    }
    if (newChild.#webText || newChild.#passesTextStyles) {
      this.#passTextStyles();
    }
    // What it inherits depends on its new parent (see #drawnAtDefault),
    // and so do the tags in a Lynx <text> inside it.
    if (newChild.#webText) newChild.#inheritAgain();
    newChild.#ancestorsChanged();
    // And the levels of <small>s inside it on the size its new ancestors
    // pass on, where a tag read that (see #sizedRelatively).
    if (newChild.#passedSizeSeen !== undefined) newChild.#outerSizeChanged();
    // And a <q>'s marks on how many <q>s it's in (see #setQuoteDepth).
    if (newChild.#quoteMarks || newChild.#holdsQuote) {
      this.#holdQuote();
      newChild.#setQuoteDepth(
        this.#quoteDepth(),
        this.#language(),
        this.#quotes(),
      );
    }
  }

  /**
   * Gives this element and its ancestors INHERITANCE_CLASS, which the build
   * narrows the variables its rules copy text styles to (see text-flow.ts),
   * as a #webText element is now inside it. An ancestor that has it already
   * has every ancestor of its own with it: that's how each one got it, and
   * an element that moves passes it to its new ancestors here.
   */
  #passTextStyles(): void {
    if (this.#passesTextStyles) return;
    this.#passesTextStyles = true;
    // An anonymous <text> passes on its parent's, as it takes them: it has
    // no rules of its own (see #applyInheritance). A rule for every <text>
    // in a <view>, such as the theme's `view > text`, still matches it, and
    // its copies would hide the parent's from the inline tags inside.
    if (!this.#anonymous) {
      // Kept with the scope classes, so an app's class binding keeps it, as
      // setRuntimeClass does. Unlike there, its rules change nothing the
      // runtime reads, so there's nothing to regroup or inherit again, and
      // it goes with the insert's own flush.
      (this.#scopeClasses ??= []).push(INHERITANCE_CLASS);
      this.#addClassName(INHERITANCE_CLASS);
      // A Lynx <text> takes the copies of the rules naming `text` too, which
      // an HTML text tag mustn't (see LYNX_TEXT_INHERITANCE_CLASS).
      if (this.tagName === 'text' && !this.#webText) {
        this.#scopeClasses.push(LYNX_TEXT_INHERITANCE_CLASS);
        this.#addClassName(LYNX_TEXT_INHERITANCE_CLASS);
      }
      // Its inline text styles, set before the text went in as Angular sets
      // a static style, get their copies now (see #inlineTextCopies). One
      // removed this cycle gets them when it's rebuilt (see
      // #recreateSubtree).
      if (this.#inlineTextFlags() && !this.#paintingDead) {
        this.#rewriteInlineStyle();
      }
    }
    // A list's item has the list as its parent (see LynxListElement), as
    // parentNode() says: an item that moved into a list from another
    // element still has that element as its #jsParent, which the list
    // doesn't set.
    const parent = this._virtualParent ?? this.#jsParent;
    if (parent) parent.#passTextStyles();
  }

  /**
   * @internal A list took `child` as a virtual child (see LynxListElement):
   * as #adoptChild, it passes text styles down to the #webText inside.
   */
  adoptVirtualChild(child: LynxElement): void {
    // The list puts its native element in the native list when native asks
    // for it (see create-list-element.ts), not through #adoptChild.
    if (child.#unplaced()) child.#jsParent = null;
    if (child.#webText || child.#passesTextStyles) this.#passTextStyles();
    child.#ancestorsChanged();
    if (child.#passedSizeSeen !== undefined) child.#outerSizeChanged();
    // And a <q> in it takes the list's language (see #setQuoteDepth).
    if (child.#quoteMarks || child.#holdsQuote) {
      this.#holdQuote();
      child.#setQuoteDepth(
        this.#quoteDepth(),
        this.#language(),
        this.#quotes(),
      );
    }
  }

  /**
   * After a move on Lynx for Web: gets `layoutchange` firing again on this
   * element and each element inside it that has a handler for it, which the
   * move stopped (see restartWebLayoutChange). A main-thread directive's
   * script (`[mainThreadBindlayoutchange]`) is one of the handler's
   * listeners, so it counts too.
   */
  #restartWebLayoutChanges(): void {
    if (this.#nativeHandlers?.has('layoutchange')) {
      restartWebLayoutChange(this.element);
    }
    for (const child of this.#children ?? NO_CHILDREN)
      child.#restartWebLayoutChanges();
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
    // Both hold what they're asked about, so neither is without children.
    const members = wrapper.#children!;
    const moving = members.slice(members.indexOf(member));
    const children = this.#children!;
    const after = children[children.indexOf(wrapper) + 1] ?? null;
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
    text.markNew();
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
    // An element regroups once loose text or an inline tag has gone into it
    // (see #hasFlow), but one whose insert was refused as a cycle (see
    // #appendPrepared) never took it, and may have no children at all. Each
    // anonymous text has its members: it's made for them.
    const children = this.#children ?? NO_CHILDREN;
    const nodes: LynxElement[] = [];
    for (const child of children) {
      if (child.#anonymous) nodes.push(...child.#children!);
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
      if (children[at] !== target) {
        this.#attach(target, children[at] ?? null);
      }
      at++;
      if (!Array.isArray(item)) continue;
      item.forEach((member, index) => {
        if (target.#children?.[index] !== member) {
          target.#attach(member, target.#children?.[index] ?? null);
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
    for (const unused of children.slice(at)) {
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
    this.#addClassName(name);
    this.#rulesChanged([name]);
    scheduleSettleFlush();
  }

  /**
   * addClass without what a class change means for the runtime's own
   * reading of the app's rules (see #rulesChanged), or a flush of its own.
   */
  #addClassName(name: string): void {
    const before = this.#classes;
    // Keep the cached class string in sync (deduped) so recreation replays the
    // full class list in one __SetClasses.
    const plain = isPlainClassName(name);
    if (this.#classesListed && plain) {
      // #classes is the names' join, so a new name goes on its end: the
      // same string the rebuild below makes.
      if (!hasClassName(before, name)) {
        this.#classes = before ? `${before} ${name}` : name;
      }
    } else {
      const rebuilt = new Set(splitClasses(before));
      rebuilt.add(name);
      this.#classes = [...rebuilt].join(' ');
      this.#classesListed = plain;
    }
    // While native has the names in #classes and no others (see
    // #nativeClasses), a plain name the string didn't have is one native
    // doesn't have: native gets the same list from the whole string as from
    // __AddClass.
    const added =
      plain && this.#classes !== before && this.#nativeClasses !== false;
    if (added && !__WEB__ && isInsideChangeDetection()) {
      this.#deferClasses(before);
    } else {
      // What waited for the end of the cycle goes first, as it would have.
      this.#writeDeferredClasses(before);
      __AddClass(this.element, name);
      // A name native has already, which iOS and Android then hold twice
      // and Lynx for Web once, or one a class string would split: native's
      // list may differ from #classes from here.
      if (!added) this.#nativeClasses = false;
    }
  }

  addScopeClass(name: string): void {
    if (this.#scopeClasses?.includes(name)) return;
    (this.#scopeClasses ??= []).push(name);
    this.addClass(name);
  }

  /**
   * Adds or removes a class the runtime keeps on the element itself, such as
   * the page's `dark` (see followColorScheme). It's kept with the scope
   * classes, so the class string Angular writes for an app's own
   * `<page class="…">` doesn't drop it.
   *
   * @returns Whether the class changed, so a caller can skip a flush.
   */
  setRuntimeClass(name: string, on: boolean): boolean {
    const index = this.#scopeClasses?.indexOf(name) ?? -1;
    if (on === (index !== -1)) return false;
    if (on) {
      (this.#scopeClasses ??= []).push(name);
      this.addClass(name);
    } else {
      // Found above, so there are scope classes.
      this.#scopeClasses!.splice(index, 1);
      this.removeClass(name);
    }
    return true;
  }

  /**
   * Lynx has no __RemoveClass PAPI — we must filter the current classes and
   * set them back. During change detection on iOS and Android, while native
   * has the names in #classes (see #nativeClasses), they're its list, and the
   * string waits for the end of the cycle. Otherwise native's list is read,
   * as it always was.
   */
  removeClass(name: string): void {
    this.#removeClassName(name);
    this.#rulesChanged([name]);
    scheduleSettleFlush();
  }

  /**
   * removeClass without what a class change means for the runtime's own
   * reading of the app's rules (see #rulesChanged), or a flush of its own.
   */
  #removeClassName(name: string): void {
    const before = this.#classes;
    if (
      this.#nativeClasses !== false &&
      !__WEB__ &&
      isInsideChangeDetection()
    ) {
      // Each name is there once, so the string stays their join.
      const joined = this.#classesListed
        ? withoutClassName(before, name)
        : before
            .split(' ')
            .filter((c) => c !== name)
            .join(' ');
      this.#classes = joined;
      // A class that wasn't there changes nothing, on native either.
      if (joined !== before) this.#deferClasses(before);
    } else {
      // What waited for the end of the cycle goes first, as it would have.
      this.#writeDeferredClasses(before);
      const classes = __GetClasses(this.element).filter((c) => c !== name);
      const joined = classes.join(' ');
      __SetClasses(this.element, joined);
      this.#classes = joined;
      // Native's list is the truth here, and may hold what a list of names
      // can't (a name twice), so the next addClass builds one from #classes.
      this.#classesListed = false;
      // Native has the string's names now, and if each is plain and there
      // once, it has what #classes says from here.
      this.#nativeClasses = isWholeClassList(joined);
    }
  }

  /**
   * @internal LynxDocument has just made this element's native element,
   * which has no classes yet: its class changes during change detection can
   * wait for the end of the cycle (see #nativeClasses).
   */
  markNew(): void {
    this.#nativeClasses = true;
    this.markUnplaced();
  }

  /**
   * @internal LynxDocument has just made this element's native element, which
   * is in no tree yet (see #unplaced). markNew does it too; a raw-text and a
   * comment, which never have classes, have only this.
   */
  markUnplaced(): void {
    this.#jsParent = undefined;
  }

  /**
   * Whether this element's native element is known to be in no tree: made
   * by LynxDocument (see markNew) and put in no parent since. #adoptChild
   * ends it on every insert through a LynxElement, and adoptVirtualChild when
   * a list takes it, as the list puts it in the native list itself. The other
   * places the runtime puts an element's native element in a parent (a <q>'s
   * marks, a rebuilt subtree, a static block's elements) don't put a new
   * one there.
   */
  #unplaced(): boolean {
    return this.#jsParent === undefined;
  }

  /**
   * Whether inserting `child` here would put an element inside its own
   * subtree (see wouldFormCycle), with no native read for what this wrapper
   * knows: an unplaced child (see #unplaced) is the root of its own tree, so
   * it has no parent to read, and if nothing was ever put in it either, only
   * this being the child itself can form a cycle. A wrapper of another
   * element is never it: a second wrapper is made only for a native element
   * no wrapper is registered for (see #canonicalFor), and a new one is
   * registered until it's released. These are the `@for` rows' inserts: the
   * native reads cost the same as the insert itself on PrimJS, and each
   * `__GetParent` or `__FirstElement` makes a handle.
   */
  #wouldFormCycle(child: LynxElement): boolean {
    if (!child.#unplaced()) {
      return wouldFormCycle(this.element, child.element, false);
    }
    // The ways the runtime puts native children in an element: #attach and
    // #appendPrepared (which keep #children), a <q>'s marks, a static block's
    // elements, and a list's items, which it keeps apart (see
    // LynxListElement). Without the last three, an unplaced element's native
    // children are its #children.
    if (child.#quoteMarks || child.#staticBlock || child.tagName === 'list') {
      return wouldFormCycle(this.element, child.element, true);
    }
    const children = child.#children;
    if (!children) return child === this;
    // A `<text>` row holds its raw-text: a raw-text or an anchor that nothing
    // was put in has no children, wherever its native element came from, so
    // the subtree is the child and these.
    for (const node of children) {
      const leaf = node.tagName === 'raw-text' || node.tagName === 'comment';
      if (!leaf || node.#children?.length) {
        return wouldFormCycle(this.element, child.element, true);
      }
    }
    return child === this || children.includes(this);
  }

  /**
   * Notes that the element's classes change during this change detection,
   * which writes them at its end (see #pendingClasses). `native` is the
   * class string native has meanwhile: #classes, before the change.
   */
  #deferClasses(native: string): void {
    if (typeof this.#nativeClasses === 'string') return;
    this.#nativeClasses = native;
    LynxElement.#pendingClasses.add(this);
  }

  /**
   * Writes the class string that waited for the end of the cycle, unless
   * native has it already, as when a class added during the cycle was
   * removed again. `classes` is the string native is to have: #classes, or
   * #classes before a change that goes to native at once right after.
   */
  #writeDeferredClasses(classes = this.#classes): void {
    const native = this.#nativeClasses;
    if (typeof native !== 'string') return;
    LynxElement.#pendingClasses.delete(this);
    this.#nativeClasses = true;
    if (native !== classes) __SetClasses(this.element, classes);
  }

  /**
   * Writes the classes that changed during the change detection now ending,
   * one `__SetClasses` for each element (see #pendingClasses). Called by
   * `LynxRendererFactory2.end()` before its other commit passes and the
   * flush, on every path: while the first render or a list item's binding
   * leaves the flush to native or componentAtIndex, and while a server
   * render hydrates. Each element has the classes it would have had from a
   * call for each change, in the same order.
   */
  static commitPendingClasses(): void {
    if (LynxElement.#pendingClasses.size === 0) return;
    const elements = [...LynxElement.#pendingClasses];
    LynxElement.#pendingClasses.clear();
    for (const el of elements) el.#writeDeferredClasses();
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
    // A removal waits for the next flush, and asks for none itself, so that
    // a re-insert in the meantime is a move (see #pendingRemovals and
    // nativeWriteEpoch).
    nativeWriteEpoch++;
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
      // Queued only by a removal, which made the set.
      const removed = el.#removedAttributes!;
      for (const name of removed) {
        __SetAttribute(el.element, name, null);
      }
      removed.clear();
    }
  }

  /**
   * Commits every queued genuine removal. Called by `LynxRendererFactory2.end()`
   * once per change-detection cycle, BEFORE `__FlushElementTree()`, so the
   * `__RemoveElement` calls are committed to the main thread in the same flush as
   * the cycle's other mutations (see #pendingRemovals for why the timing
   * matters). Any element that was re-inserted (a move) has already removed
   * itself from the set via #cancelPendingRemoval, so only genuine destroys
   * remain.
   *
   * An element goes before anything inside it, whatever order Angular asked
   * for them in (see #outermostFirst).
   */
  static commitPendingRemovals(): void {
    if (LynxElement.#pendingRemovals.size > 0) {
      const items = LynxElement.#outermostFirst([
        ...LynxElement.#pendingRemovals,
      ]);
      LynxElement.#pendingRemovals.clear();
      for (const el of items) {
        el.#doRemove();
      }
    }
    LynxElement.#commitPendingReleases();
    scheduleCollection();
  }

  /**
   * Orders removals so that an element comes before its descendants, keeping
   * Angular's order otherwise.
   *
   * Lynx draws a `position: fixed` element (an `<overlay>` styled for the
   * web, as `ui-menu`'s and the dialogs' are) from the page, not from its
   * parent. When something holding one is removed, Lynx queues the fixed
   * element's own removal from the page on the parent it was removed from,
   * and runs it when that parent flushes (`RemovedFrom` and
   * `PrepareAndGenerateChildrenActions` in `fiber_element.cc`). A parent that is
   * itself removed before the flush never flushes again, so the queued
   * removal is lost: the page goes on drawing an element that is freed once
   * its last reference goes, and the next layout walks into it and crashes
   * (#345). Angular can ask for both in one change detection, the inner one
   * first: a row's `@if` drops its menu, and then, in a second pass, the
   * `@if` around the list drops the card the rows are in.
   *
   * With the outer element removed first, Lynx queues the fixed element's
   * removal on the outer element's parent, which is still on the page and
   * flushes. Removing the inner element afterwards, from a parent that has
   * left the page, queues nothing, so it's harmless.
   *
   * Depth is counted through the wrappers' own parents (#jsParent), which
   * follow the element tree, rather than asking native for each ancestor.
   */
  static #outermostFirst(items: LynxElement[]): LynxElement[] {
    if (items.length < 2) return items;
    const depth = (el: LynxElement): number => {
      let count = 0;
      for (let p = el.#jsParent; p; p = p.#jsParent) count++;
      return count;
    };
    // Elements at one depth keep the order Angular removed them in. The
    // index says so itself rather than trusting the engine's sort to be
    // stable.
    return items
      .map((el, index) => ({ el, index, depth: depth(el) }))
      .sort((a, b) => a.depth - b.depth || a.index - b.index)
      .map(({ el }) => el);
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
    // A <q>'s marks are text of the line, as a browser's generated content
    // is: the space after `<q>` sits after the opening mark, not at an edge.
    if (el.#quoteMarks) out.push(el.#quoteMarks[0]);
    for (const child of el.#children ?? NO_CHILDREN) {
      if (child.tagName === 'raw-text') {
        out.push(child);
      } else if (child.tagName === 'text') {
        LynxElement.#collectRawTextLeaves(child, out);
      }
    }
    if (el.#quoteMarks) out.push(el.#quoteMarks[1]);
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
    // A new element, being put in its first parent: nothing to move from.
    if (this.#unplaced()) return;
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
    const animations = this.#activeAnimations;
    if (animations && animations.length > 0) {
      for (const anim of animations) {
        anim.cancel();
      }
      // Cancel clears the animation's active effect, but Lynx may leave
      // residual computed values on the element (observed: opacity stays at
      // the initial keyframe value 0 after cancel). Nulling the inline styles
      // forces a full reset so the pooled element has no lingering overrides.
      __AddInlineStyle(this.element, 'opacity', null);
      __AddInlineStyle(this.element, 'transform', null);
      // splice() rather than a shorter length: PrimJS keeps what an array
      // held past its length alive, and only pop(), shift() and splice()
      // clear it (see the build plugin's vacated-slots.js). A pooled element
      // outlives its view, and its animations' callbacks reach the view's
      // component.
      animations.splice(0);
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
      const i = jsParent.#children!.indexOf(this);
      // Defensive: jsParent's #children was kept in lock-step with the native
      // tree via #adoptChild, so indexOf always finds `this` here.
      /* v8 ignore next */
      if (i >= 0) jsParent.#children!.splice(i, 1);
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
   *   (see #recreateSubtree). Its caches are kept for that;
   * - counts it towards the next full collection (see scheduleCollection),
   *   which frees what the collections that run as the app goes leave behind.
   */
  #release(): void {
    this.#destroyed = false;
    this.#paintingDead = true;
    noteReleased();
    this.deregisterNative();
    if (this.#nativeHandlers) {
      for (const { eventType, eventName } of this.#nativeHandlers.values()) {
        removeNativeHandler(this.element, eventType, eventName);
      }
    }
    for (const child of this.#children ?? NO_CHILDREN) child.#release();
    for (const child of this.virtualChildren()) child.#release();
    if (this.#quoteMarks) {
      for (const mark of this.#quoteMarks) mark.deregisterNative();
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
    for (const child of this.#children ?? NO_CHILDREN) {
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
    // A copy, for the reason setAttribute's data-* branch gives.
    if (this.#dataset && Object.keys(this.#dataset).length > 0) {
      __SetDataset(fresh, { ...this.#dataset });
    }
    if (this.#attrs) {
      for (const [name, value] of this.#attrs) {
        __SetAttribute(fresh, name, value);
      }
    }
    // A field's text, which the destroyed UI took with it.
    if (this.#fieldText !== null) this.#sendFieldText(fresh);
    if (this.#classes) __SetClasses(fresh, this.#classes);
    // The new native element has the class string as it is now, the changes
    // waiting for the end of the cycle included (see #pendingClasses).
    if (typeof this.#nativeClasses === 'string') {
      this.#nativeClasses = this.#classes;
    }
    // Whole-string styles first, then per-key overrides — same order as the
    // original setAttribute('style') vs [style.x] application.
    const inlineStyle = this.#inlineStyleFor(this.#inlineStyleWhole);
    if (inlineStyle != null) {
      __SetInlineStyles(fresh, inlineStyle);
    }
    const keys = this.#nativeKeys();
    if (keys) {
      for (const [key, value] of keys) {
        __AddInlineStyle(fresh, key, forNative(value));
      }
    }
    if (this.#nativeHandlers) {
      for (const {
        eventType,
        eventName,
        dispatch,
      } of this.#nativeHandlers.values()) {
        addNativeEvent(fresh, eventType, eventName, {
          type: 'worklet',
          value: dispatch,
        });
      }
    }
    // A <q>'s quotation marks went with its old element, and come back
    // around its children (see markQuote).
    const marks = this.#quoteMarks;
    if (marks) __AppendElement(fresh, marks[0].#renewQuoteMark());
    for (const child of this.#children ?? NO_CHILDREN) {
      child.#recreateSubtree();
      __AppendElement(fresh, child.element);
    }
    if (marks) __AppendElement(fresh, marks[1].#renewQuoteMark());
    // A static block's elements went with the old element: they have no
    // wrappers to rebuild them, so the block builds them again.
    if (this.#staticBlock) {
      buildStaticBlock(fresh, this.#staticBlock.block, this.#staticBlock.scope);
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
    // A <q>'s closing mark ends its children (see markQuote).
    if (element.#quoteMark) return null;
    if (!element.#anonymous) return element;
    const first = __FirstElement(element.element);
    return first
      ? LynxElement.#entering(LynxElement.#canonicalFor(first))
      : element.nextSibling();
  }

  querySelector(selector: string): LynxElement | null {
    // A class selector matches the classes native has, and this cycle's
    // changes reach it at the cycle's end (see #pendingClasses).
    LynxElement.commitPendingClasses();
    const element = __QuerySelector(this.element, selector, {});
    if (!element) return null;
    // Canonical wrapper, not a throwaway: a caller that mutates the query result
    // (appendChild, setAttribute) must drive the SAME wrapper the rest of the
    // tree references, or those mutations are lost on the next remount.
    return LynxElement.#canonicalFor(element);
  }
  querySelectorAll(selector: string): LynxElement[] {
    // Same classes and canonical-wrapper requirement as querySelector.
    LynxElement.commitPendingClasses();
    return __QuerySelectorAll(this.element, selector, {}).map((e) =>
      LynxElement.#canonicalFor(e),
    );
  }
  /**
   * Invokes a native UI method on this element by name: `focus`,
   * `scrollIntoView`, a text field's `setValue`… Lynx exposes some of what an
   * element does only this way.
   *
   * A UI method reaches only a UI native has made, which it does for an
   * element when the element tree is next flushed. The build plugin turns on
   * Lynx's pending invokes (`enableElementInvokeUIMethodPendingTask`), which
   * keep the call on its element until the element's next flush, and send it
   * to the UI after the operations that make and change the UI. So a method
   * called on an element made since the last flush, as `ngAfterViewInit()`
   * sees one its change detection created, or `afterNextRender()` does on
   * the first screen, reaches the UI it's for, as a DOM element's would. It
   * matters most in the apps `ng build --platform` makes, which run Lynx's
   * engine off the UI thread: the flush reaches the UI thread later there,
   * and a call sent at once could get there first. Outside change detection
   * there may be no flush for a while, so one is scheduled (see
   * scheduleSettleFlush).
   *
   * A host that ignores the setting (a Lynx before 4.1) runs the call at
   * once. On the UI thread, iOS and Android then answer at once that an
   * element has no UI (NO_UI_FOR_NODE), and drop the call, so it's called
   * again after the flush that makes the UI. Only once: an element still
   * without a UI then isn't on the page.
   *
   * The result callback is otherwise ignored. Callers that need a result
   * (e.g. getValue, boundingClientRect) should use MainThreadElement.invoke(),
   * which returns a Promise. This method covers fire-and-forget cases like
   * focus where only the side-effect matters.
   */
  invoke(methodName: string, params?: Record<string, unknown>): void {
    // The app setting a field's text itself, which a `value` set to the
    // same text afterwards mustn't take for the text the field has (see
    // #setFieldText).
    if (methodName === 'setValue') {
      this.#noteFieldText(String(params?.['value'] ?? ''));
    }
    const call = (): boolean => {
      let made = true;
      __InvokeUIMethod(this.element, methodName, params ?? {}, (result) => {
        made = result?.code !== NO_UI_FOR_NODE;
      });
      return made;
    };
    if (call()) {
      scheduleSettleFlush();
    } else {
      afterNextFlush(call);
    }
  }

  /**
   * Notes the text the app or a main-thread script set on the field with
   * `setValue`, which a `value` set to the same text afterwards mustn't take
   * for the text the field has (see #setFieldText). Nothing to note for a
   * field whose text the runtime doesn't track yet.
   */
  #noteFieldText(text: string): void {
    if (this.#fieldText !== null) this.#fieldText = text;
  }

  /**
   * Makes the calls waiting for this flush (see afterNextFlush). Called right
   * after the flush, so the UIs it made are there.
   */
  static commitPendingInvokes(): void {
    if (awaitingFlush.length === 0) return;
    for (const callback of awaitingFlush.splice(0)) callback();
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
    (this.#activeAnimations ??= []).push(anim);
    // Starting, pausing, playing and canceling an animation all reach native
    // with the next flush, like a style: one started or canceled from a
    // timer, outside change detection, needs a flush of its own (see
    // scheduleSettleFlush).
    scheduleSettleFlush();
    for (const method of ['cancel', 'pause', 'play'] as const) {
      const run = anim[method].bind(anim);
      anim[method] = () => {
        run();
        scheduleSettleFlush();
      };
    }
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
    (this.#listeners ??= []).push(entry);
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
    const entry = this.#listeners?.find(
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
      // The UI method waits for the element's next flush (see invoke()),
      // which measureLayout asks for (see setMeasureFlush in the constructor).
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
      // Its own listeners, added below, made the list.
      const entry = this.#listeners!.find(
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
    // `entry` was added (see #add), which made the list.
    const listeners = this.#listeners!;
    const i = listeners.indexOf(entry);
    // Removing a listener a second time does nothing, as on the DOM.
    if (i < 0) return;
    listeners.splice(i, 1);
    this.#syncNativeHandler(entry);
  }

  /**
   * The listeners that share `entry`'s native handler, in the order added,
   * the trailing ones last.
   */
  #listenersLike(entry: Listener): Listener[] {
    const key = nativeEventKey(entry.eventType, entry.eventName);
    // `entry` was added (see #add), which made the list.
    const like = this.#listeners!.filter(
      (other) => nativeEventKey(other.eventType, other.eventName) === key,
    );
    return [
      ...like.filter((other) => !other.trailing),
      ...like.filter((other) => other.trailing),
    ];
  }

  /**
   * Whether iOS's scroll placeholder (see listenForScrollsFromTheStart) is
   * all that listens for `entry`'s native event. A loop rather than
   * #listenersLike, which builds four arrays: this runs on every scroll
   * frame. Any other listener on the same handler, the app's or an
   * IntersectionObserver's, hears the event as before.
   */
  #hearsOnlyScrollPlaceholder(entry: Listener): boolean {
    const key = nativeEventKey(entry.eventType, entry.eventName);
    // A handler is registered only for a listener (see #add).
    for (const other of this.#listeners!) {
      if (
        other.listener !== ignoreScroll &&
        nativeEventKey(other.eventType, other.eventName) === key
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Brings the native handler for `entry`'s event in line with its listeners:
   * registers it for the first one, changes its type when a listener needs
   * another (see combinedEventType), and removes it after the last one.
   */
  #syncNativeHandler(entry: Listener): void {
    const key = nativeEventKey(entry.eventType, entry.eventName);
    const listeners = this.#listenersLike(entry);
    const current = this.#nativeHandlers?.get(key);
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
      // It was found there.
      this.#nativeHandlers!.delete(key);
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
    (this.#nativeHandlers ??= new Map()).set(key, handler);
    // type: 'worklet' routes the callback through Lynx's worklet system
    // (runWorklet), which is the only way to receive events in the JS thread.
    // Direct function callbacks also work here (not just worklet handles) —
    // the native engine checks the value type at runtime. On Lynx for Web,
    // a handler added or removed while a Lynx event runs, as Angular's
    // `@defer (on interaction)` removes its own as it fires, waits for the
    // event to finish (see addNativeEvent).
    addNativeEvent(this.element, eventType, entry.eventName, {
      type: 'worklet',
      value: handler.dispatch,
    });
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
    // iOS sends a scroll-view's `scroll` on every frame, to the placeholder
    // every scroll-view and list has there (see listenForScrollsFromTheStart).
    // While it's the only listener, nothing runs that could change anything,
    // so the event goes no further: no shims, no listener walk, and no flush
    // unless something is waiting for one. ignoreScroll returns undefined,
    // as this does.
    if (
      !__WEB__ &&
      entry.eventName === 'scroll' &&
      this.#hearsOnlyScrollPlaceholder(entry)
    ) {
      // What was written since the last flush of the whole tree, from a
      // timer, a promise or an observer, or what a list item left behind,
      // still reaches the screen with the next event, as when every event
      // flushed: on iOS that's the next frame of any scroll (see
      // hasUnflushedWrites).
      if (hasUnflushedWrites()) scheduleSettleFlush();
      return undefined;
    }
    if (event && typeof event === 'object') {
      if (typeof event.stopPropagation !== 'function') {
        event.stopPropagation = noop;
      }
      if (typeof event.preventDefault !== 'function') {
        event.preventDefault = noop;
      }
      if (typeof event.stopImmediatePropagation !== 'function') {
        event.stopImmediatePropagation = noop;
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
    // What the user typed, which the field shows now (see #setFieldText).
    if (
      this.#fieldText !== null &&
      entry.eventName === 'input' &&
      typeof event?.detail?.value === 'string'
    ) {
      this.#fieldText = event.detail.value;
    }
    let result: unknown;
    // The stop-propagation bits any listener asked for (see eventResultBits).
    let stopBits = 0;
    // The first error a listener threw, rethrown once the others have run.
    let failure: { error: unknown } | null = null;
    // As a DOM event does: the listeners are those registered when the event
    // fires, so one that removes itself doesn't make the next one skip, and a
    // listener an earlier one removed (an @if hiding part of the element, say)
    // doesn't run. A listener that throws doesn't stop the others either, as
    // a browser reports a listener's error and goes on: a main-thread script
    // that throws would otherwise silence the template's listener and an
    // IntersectionObserver's after it. Angular's own listener wrapper catches
    // what a template listener throws, so this matters for the rest.
    for (const other of this.#listenersLike(entry)) {
      if (!this.#listeners!.includes(other)) continue;
      try {
        result = other.listener(event);
        stopBits |= eventResultBits(result);
      } catch (error) {
        failure ??= { error };
      }
    }
    // Native events are delivered straight to this callback by the Lynx SDK —
    // OUTSIDE Angular's begin()/end() change-detection cycle. So a handler that
    // imperatively mutates the native tree (e.g. `el.setStyle(...)` for a press
    // animation) but changes NO signal schedules no CD, and LynxRendererFactory2
    // .end() therefore never flushes those mutations. On native the effect is a
    // delayed paint; on web (@lynx-js/web-core's offscreen document) the mutation
    // never reaches the real DOM at all, so imperative animations silently do
    // nothing (verified in a headless browser). Most writes schedule the same
    // coalesced safety-net flush used for content built outside a cycle
    // themselves; the ones that leave it to their caller (see
    // nativeWriteEpoch) get it here. So do those made earlier outside both
    // change detection and a listener, from a timer, a promise, an observer
    // or a gesture callback: every event used to flush, and such a write
    // reached the screen with the next one.
    //
    // Only when something was written since the last flush of the whole
    // tree, or a list item left work behind (see hasUnflushedWrites). A
    // flush with nothing to commit isn't free: Lynx still runs its patch pass
    // on the engine thread and queues an operation for the UI thread. Scroll
    // listeners that change nothing on most frames (ui-bar-scroll's) paid it
    // on every frame, and a template listener that only sets signals paid it
    // as well as its change detection's flush, which comes a task later.
    if (hasUnflushedWrites()) {
      scheduleSettleFlush();
    } else {
      // A listener's code that runs in a microtask it queued (an async
      // listener after an `await`) writes after this returns, and before
      // the flush scheduled here would have run: it got that flush, so it
      // still does.
      queueMicrotask(checkDispatchWrites);
    }
    // To native, as when the listener had the handler to itself: Lynx
    // reports an error a handler throws.
    if (failure) throw failure.error;
    // A main-thread script can return the bits native stops the event with.
    // A later listener's result mustn't drop them.
    if (stopBits && eventResultBits(result) !== stopBits) {
      return { eventReturnResult: stopBits };
    }
    return result;
  }
}

/**
 * The bits of Lynx's `EventResult` a handler's result asks for: native reads
 * `eventReturnResult` from what a worklet handler returns, 1 to stop the
 * event's propagation and 2 to stop it immediately
 * (TouchEventHandler::FireElementWorklet). 0 for any other result.
 */
const eventResultBits = (result: unknown): number => {
  const bits = (result as { eventReturnResult?: unknown } | null | undefined)
    ?.eventReturnResult;
  return typeof bits === 'number' ? bits : 0;
};

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
 * Writes the classes changed during this change detection, one
 * `__SetClasses` per element (see LynxElement's `#pendingClasses`). A
 * free-function wrapper over `LynxElement.commitPendingClasses()` for
 * `LynxRendererFactory2.end()`, before its other commit passes and the
 * flush, and for whatever reads the classes native has, such as a server
 * render's snapshot (see serializeElementTree).
 */
export const processPendingClasses = (): void => {
  LynxElement.commitPendingClasses();
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

/**
 * Makes the UI method calls that waited for this flush (see
 * LynxElement.invoke) — a free-function wrapper over
 * `LynxElement.commitPendingInvokes()` for `LynxRendererFactory2.end()`,
 * right after its flush.
 */
export const processPendingInvokes = (): void => {
  LynxElement.commitPendingInvokes();
};

/**
 * Calls waiting for the element tree's next flush (see afterNextFlush).
 */
const awaitingFlush: Array<() => void> = [];

/**
 * After a list's componentAtIndex has built or rebound `*lynxListFor` items
 * and flushed them (see bindListItem).
 *
 * The item's own flush commits the item and nothing else, so the next native
 * event flushes once (see settleSkippedForListItem). The binding may have
 * left work elsewhere: a write that leaves its flush to its caller (a class,
 * a custom property, see nativeWriteEpoch), or one the item's own change
 * detection made outside the item (an app's write to a header, a UI method
 * on another element), whose settle flush was skipped inside the cycle
 * without a note. Every event used to flush, and that work reached the screen
 * with the next one, the next scroll frame on iOS.
 *
 * And it flushes again on a task of its own if a call is waiting for a
 * flush, such as a UI method on an element the item just made (see
 * LynxElement.invoke). The settle flush it would have asked for was skipped
 * while the item was built, and only a macrotask runs after native's layout
 * pass has returned: a microtask would still run inside it.
 */
export const settleAfterListItems = (): void => {
  settleSkippedForListItem = true;
  if (awaitingFlush.length === 0) return;
  setTimeout(scheduleSettleFlush, 0);
};

/**
 * Runs `callback` after the element tree's next flush, once what the app has
 * changed so far has reached native: after the native flush that ends the
 * first render while it's under way, else after
 * LynxRendererFactory2.end()'s, or a settle flush's (scheduled here, for a
 * call outside change detection). A UI method waits for it to reach the UI
 * the flush makes (LynxElement.invoke), and the splash screen to go once the
 * screen under it is drawn (LynxSplashScreen).
 */
export const afterNextFlush = (callback: () => void): void => {
  if (isFirstRenderPending()) {
    runAfterFirstRender(callback);
    return;
  }
  awaitingFlush.push(callback);
  scheduleSettleFlush();
};

let settleFlushScheduled = false;

/**
 * Whether elements built outside a cycle during the first render have a
 * microtask coming that runs the tick Angular scheduled for them (see
 * scheduleSettleFlush).
 */
let firstRenderTickScheduled = false;

/**
 * Whether a list item left work for a later flush, with no settle flush
 * since: a settle flush was asked for, and skipped, while an item was being
 * built (see scheduleSettleFlush), or componentAtIndex built or rebound one
 * (see settleAfterListItems). The item's own flush covers the item only, so
 * a change it made elsewhere waits for the next flush. The next native event
 * brings it, even one whose listeners change nothing (see #dispatch), as
 * every event did when each one flushed.
 */
let settleSkippedForListItem = false;

/**
 * Counts the writes to native that leave their flush to whoever made them:
 * setAttribute (a class, id, data-* or `hidden`), #rewriteInlineStyle (custom
 * properties, `hidden` and the runtime's own styles), appendChild,
 * insertBefore and remove, and an animation's start, play, pause and cancel
 * (see countNativeWrite). The other writes (a style, a class added, a UI
 * method, a handler, a new element) call scheduleSettleFlush themselves.
 * Compared with flushedEpoch, its value at the last flush of the whole tree,
 * so the next native event can tell whether one is still waiting for a
 * flush (see hasUnflushedWrites). A counter rather than a flag, so a write
 * costs one increment and a flush one assignment, with nothing to clear.
 */
let nativeWriteEpoch = 0;

/**
 * nativeWriteEpoch as it was at the last flush of the whole tree that
 * committed everything written before it (see markTreeFlushed).
 */
let flushedEpoch = 0;

/**
 * @internal Notes that the whole element tree is flushed next, after the
 * commit passes (removals, loose text, attribute removals and text
 * normalization), so every write counted so far reaches native with it. The
 * settle flush and `LynxRendererFactory2.end()` call it right before their
 * `__FlushElementTree()`, after the commit passes, which can write
 * themselves. A list item's flush, which covers the item only, and the flush
 * for lists changed outside a cycle with no settle flush coming (see
 * scheduleListUpdate), which runs none of the commit passes, don't.
 */
export const markTreeFlushed = (): void => {
  flushedEpoch = nativeWriteEpoch;
};

/**
 * Whether the next native event flushes (see #dispatch): something was
 * written to native since the last flush of the whole tree (see
 * nativeWriteEpoch), or a list item left work for a later flush (see
 * settleSkippedForListItem). Every event used to flush, so a write made
 * outside change detection and outside a listener, from a timer, a promise,
 * an observer or a gesture callback, reached the screen with the next one.
 * This keeps that, and lets an event with nothing pending skip the flush. An
 * app calling the raw `__*` element functions isn't counted.
 */
const hasUnflushedWrites = (): boolean =>
  nativeWriteEpoch !== flushedEpoch || settleSkippedForListItem;

/**
 * Counts a write made outside LynxElement that leaves its flush to whoever
 * made it: an animation a main-thread script starts, plays, pauses or
 * cancels on a MainThreadElement, which schedules no flush, and which the
 * next event's flush brought to the screen when every event flushed (see
 * setAfterAnimate).
 */
const countNativeWrite = (): void => {
  nativeWriteEpoch++;
};

/**
 * Flushes, a microtask after a dispatch with nothing to flush, if something
 * was written since: an async listener's code after its first `await` (see
 * #dispatch).
 */
const checkDispatchWrites = (): void => {
  if (nativeWriteEpoch !== flushedEpoch) scheduleSettleFlush();
};

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
 * The same goes for a style, class, attribute or animation an element gets
 * outside a cycle: a transition's last frame set from a timer, or a gesture's
 * from a native callback, stayed unflushed on iOS and Android (the web
 * preview applies them at once, so it didn't show there), and a pushed page's
 * covered page stayed half visible under it (see LynxStackOutlet).
 *
 * Called from `LynxDocument`'s element creators and those `LynxElement`
 * mutations, which only run on the main thread (Angular doesn't run on the
 * background thread), so no thread guard is needed here. It schedules ONE
 * coalesced microtask (matching the list guard's `queueMicrotask`, not
 * `setTimeout` — flushing from a macrotask crashes the native engine), and is a
 * no-op while:
 *  - inside a CD cycle — end() will flush;
 *  - the first render is pending — native flushes after renderPage, and any
 *    `<list>` defers its own first flush (see isFirstRenderPending()). Only
 *    a tick Angular has scheduled runs, from a microtask, inside renderPage
 *    (see runComingTick());
 *  - a list's componentAtIndex is building a `*lynxListFor` item, which it
 *    flushes itself (see bindListItem). What else is left for a flush then
 *    waits for the next one (see settleSkippedForListItem); calls waiting for
 *    it are seen to by settleAfterListItems().
 * When the microtask runs, a tick Angular has scheduled runs instead of the
 * flush, and its end() flushes (see runComingTick()).
 * The near-no-op cost when nothing is layout-dirty (the core's `need_layout_`
 * gate) keeps the steady-state overhead negligible.
 */
export const scheduleSettleFlush = (): void => {
  if (settleFlushScheduled || isInsideChangeDetection()) {
    return;
  }
  if (isFirstRenderPending()) {
    // Native flushes after renderPage(), and the microtasks run before it
    // returns: the first screen's route is built in them, outside a cycle.
    // Its tick runs in one too, so that flush draws the whole screen (see
    // runComingTick), rather than leaving the tick for a later task. Not in
    // a test, which has no renderPage(), and whose first render never ends:
    // its ticks keep the timing they always had.
    if (isRenderingPage() && !firstRenderTickScheduled) {
      firstRenderTickScheduled = true;
      queueMicrotask(() => {
        firstRenderTickScheduled = false;
        if (!isInsideChangeDetection()) runComingTick();
      });
    }
    return;
  }
  if (isBindingListItem()) {
    settleSkippedForListItem = true;
    return;
  }
  settleFlushScheduled = true;
  queueMicrotask(() => {
    settleFlushScheduled = false;
    // A CD cycle began in the meantime — its end() will flush; don't double up
    // (and avoid a re-entrant flush).
    if (isInsideChangeDetection()) return;
    // Angular has a tick scheduled (a routed screen, marked for check after
    // its static elements were built): it runs now, and its end() flushes
    // what it builds with what was built before it (see runComingTick).
    if (runComingTick()) return;
    // Cleared before the flush: a list item built inside it (its layout pass
    // calls componentAtIndex) leaves the next flush its own leftovers.
    settleSkippedForListItem = false;
    // Mirror end()'s ordering: commit any queued removals, then re-derive text
    // whitespace, so both land in the same flush as the new content (see
    // #pendingRemovals / #pendingTextNormalization). A class changes during
    // change detection only, and its end() writes it (see #pendingClasses):
    // this writes any a cycle left without one.
    LynxElement.commitPendingClasses();
    LynxElement.commitPendingRemovals();
    LynxElement.commitPendingFlow();
    LynxElement.commitPendingAttributeRemovals();
    LynxElement.commitPendingTextNormalization();
    // After the commit passes, which write themselves (a regroup inserts):
    // everything written so far goes with this flush. So does the
    // update-list-info of a list changed outside the cycle too (a lazy
    // route's static items), rather than with a flush of its own after this
    // one (see flushTreeWithListUpdates).
    markTreeFlushed();
    try {
      flushTreeWithListUpdates();
    } finally {
      // The flush was made even if a list threw (its error is thrown after
      // it): the calls waiting for it go now, rather than with the next one.
      LynxElement.commitPendingInvokes();
    }
  });
};

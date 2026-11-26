/**
 * What text written for the browser needs from its surroundings on Lynx:
 * which text styles an element takes from its ancestors (inheritance), and
 * whether text and inline tags beside each other share a line (inline flow).
 *
 * Lynx inherits neither. A `<text>` doesn't take its parent's `color` (only
 * `font-size`, which the build plugin has Lynx inherit), and only a `<text>`
 * lays text out in lines, so `<div>Hi
 * <b>there</b></div>` has no line to share. The runtime puts such text and
 * tags in an anonymous `<text>` (see LynxElement's #regroup), and gives the
 * elements that stand for HTML's text the inherited styles through CSS
 * variables, which Lynx does pass down to descendants: the build plugin copies
 * each inheritable declaration in the app's CSS to a variable of its own
 * (`color: red` also sets `--angular-lynx-color: red`, see its
 * text-inheritance.ts), and those elements read the variables.
 *
 * Elements written as Lynx elements (`<view>`, `<text>`) never read them,
 * so they look as they always have, apart from the inherited `font-size`.
 */

/**
 * The text properties an element takes from its parent, as on the web: the
 * list Lynx inherits with `enableCSSInheritance` turned on. The build
 * plugin keeps its own copy (`packages/rsbuild-plugin-angular-lynx/src/
 * text-inheritance.ts`), and a test there keeps the two the same: the bit
 * each one has in the style index is its position here.
 */
export const INHERITED_TEXT_PROPERTIES: readonly string[] = [
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-decoration',
  'text-shadow',
  'direction',
];

/** The CSS variable the build copies an inheritable property to. */
export const inheritanceVariable = (property: string): string =>
  `--angular-lynx-${property}`;

/**
 * The class of every element with an HTML text tag or an anonymous `<text>`
 * inside it (see LynxElement's #passTextStyles). The build puts its copies of
 * text styles to variables in rules narrowed to it, so the elements with
 * nothing inside to read them, such as a screen of `<text>`s, don't pay for
 * them: an element that sets custom properties has its whole set copied and
 * resolved by Lynx, where one that sets none shares its parent's. The build
 * plugin keeps its own copy, kept the same by a test.
 */
export const INHERITANCE_CLASS = '_nginherit';

/**
 * The class of every Lynx `<text>` (one written as `<text>`) with
 * INHERITANCE_CLASS. The build narrows the copies of a rule whose selector
 * names `text`, such as the theme's `view > text`, to it instead (see the
 * build plugin's text-inheritance.ts). An HTML text tag is a `<text>` too, so
 * such a rule matches it natively, but on the web no `text` selector matches
 * a `<p>`: with INHERITANCE_CLASS alone, the theme's copy on a `<p>` set
 * `--foreground` for the inline tags in it, hiding the color around the `<p>`
 * (issue #610). It's one class, as INHERITANCE_CLASS is, so the copies keep
 * the specificity they had against each other.
 */
export const LYNX_TEXT_INHERITANCE_CLASS = '_nginherit-text';

/** Every inheritable property, as a bitmask (see INHERITED_TEXT_PROPERTIES). */
export const ALL_TEXT_PROPERTIES = (1 << INHERITED_TEXT_PROPERTIES.length) - 1;

/**
 * The bit in a style index entry for a rule that can change how an element
 * lays out its children: `display` other than block (`flex`, `grid`), or a
 * horizontal `linear-orientation`. Above the text properties' bits.
 */
export const LAYOUT_FLAG = 1 << INHERITED_TEXT_PROPERTIES.length;

/**
 * The inline declarations that give an element the inherited value of each
 * text property not in `ownProperties`, the ones its own rules may set. They
 * go ahead of the app's own inline style, which wins over them. A variable no
 * ancestor sets leaves its property as it would be without the declaration,
 * on iOS, Android and the web alike.
 */
export const inheritanceStyleFor = (ownProperties: number): string =>
  INHERITED_TEXT_PROPERTIES.filter((_, bit) => !(ownProperties & (1 << bit)))
    .map((property) => `${property}: var(${inheritanceVariable(property)})`)
    .join('; ');

/**
 * One step up from a selector's subject, nearest first: the combinator
 * between it and the compound below it (`>` for a child, ` ` for a
 * descendant), and the tokens the ancestor's compound requires.
 */
type AncestorStep = readonly [combinator: '>' | ' ', tokens: readonly string[]];

/**
 * What the build tells the runtime about the app's CSS: for each rule that
 * sets an inheritable text property or changes layout, the classes (and id,
 * as `#id`, or Lynx tag, as `<tag>`) its selector's last part requires,
 * which of those it sets, what the rest of its selector requires of the
 * element's ancestors (left out when nothing), and 1 if it applies only in a
 * state the runtime can't see, such as `:active`. The build plugin prepends
 * it to the main-thread script as `globalThis.__angularLynxStyleIndex` (see
 * its style-index.ts).
 */
type StyleIndex = {
  readonly rules: readonly (readonly [
    tokens: readonly string[],
    flags: number,
    ancestors?: readonly AncestorStep[],
    inState?: 1,
  ])[];
};

/** A rule, by the first token it requires: what else it requires. */
type IndexedRule = {
  readonly rest: readonly string[];
  readonly flags: number;
  readonly ancestors: readonly AncestorStep[];
  readonly inState: boolean;
};

/** The index, by the first token each rule requires. */
type IndexedRules = {
  /** What the rules whose selector's last part requires nothing set. */
  readonly any: number;
  /** Those rules, for matchedStyleFlagsFor. */
  readonly anyRules: readonly IndexedRule[];
  readonly byToken: ReadonlyMap<string, readonly IndexedRule[]>;
  /**
   * Whether a text property's rule requires an ancestor, so an element's
   * text styles can change when its ancestors' classes do.
   */
  readonly hasAncestorRules: boolean;
  /**
   * The tokens those rules require of an ancestor: a class change can change
   * which of them apply below the element only if it adds or removes one.
   */
  readonly ancestorTokens: ReadonlySet<string>;
};

let indexed: IndexedRules | null | undefined;

const readIndex = (): IndexedRules | null => {
  if (indexed !== undefined) return indexed;
  const index = (globalThis as { __angularLynxStyleIndex?: StyleIndex })
    .__angularLynxStyleIndex;
  if (!index) return (indexed = null);
  let any = 0;
  let hasAncestorRules = false;
  const ancestorTokens = new Set<string>();
  const anyRules: IndexedRule[] = [];
  const byToken = new Map<string, IndexedRule[]>();
  for (const [tokens, flags, ancestors = [], inState] of index.rules) {
    const [first, ...rest] = tokens;
    const rule = { rest, flags, ancestors, inState: inState === 1 };
    if (ancestors.length && flags & ALL_TEXT_PROPERTIES) {
      hasAncestorRules = true;
      for (const [, required] of ancestors) {
        for (const token of required) ancestorTokens.add(token);
      }
    }
    if (first === undefined) {
      any |= flags;
      anyRules.push(rule);
    } else {
      const list = byToken.get(first) ?? [];
      list.push(rule);
      byToken.set(first, list);
    }
  }
  return (indexed = {
    any,
    anyRules,
    byToken,
    hasAncestorRules,
    ancestorTokens,
  });
};

/**
 * @internal Forgets the index read, for tests that set another.
 */
export const resetStyleIndex = (): void => {
  indexed = undefined;
};

/**
 * Display utilities a stylesheet may set, for when there's no style index
 * (a unit test, or a build without the plugin): Tailwind's names, with any
 * variant prefix (`md:flex`).
 */
const LAYOUT_UTILITIES = new Set([
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'contents',
]);

/**
 * The classes the renderer adds, which no app rule sets a style with.
 */
const isRendererClass = (name: string): boolean =>
  name.startsWith('_ngcontent-') ||
  name.startsWith('_nghost-') ||
  name.startsWith('_ngtag-') ||
  name.startsWith('_ngattr-') ||
  name === ANONYMOUS_TEXT_CLASS ||
  name === INHERITANCE_CLASS ||
  name === LYNX_TEXT_INHERITANCE_CLASS;

/**
 * The flags of every rule in the app's CSS that may apply to an element with
 * these tokens (classes, `#id`, `<tag>`). It can say a rule applies when its
 * selector needs an ancestor or a state the element hasn't. LynxElement reads
 * it for layout, where counting such a rule only keeps an element's children
 * as they are rather than regrouping them into lines. For text styles, where
 * it would keep an element from inheriting, matchedStyleFlagsFor checks the
 * rest of the selector.
 */
export const styleFlagsFor = (tokens: ReadonlySet<string>): number => {
  const index = readIndex();
  if (!index) return fallbackFlags(tokens);
  let flags = index.any;
  for (const token of tokens) {
    for (const rule of index.byToken.get(token) ?? []) {
      if (rule.rest.every((other) => tokens.has(other))) flags |= rule.flags;
    }
  }
  return flags;
};

/**
 * The flags of the rules in the app's CSS that apply to an element with
 * these tokens, whose ancestors, nearest first, have the tokens
 * `ancestorAt` gives (undefined past the root). Unlike styleFlagsFor, a rule
 * whose selector needs an ancestor the element hasn't doesn't count. What it
 * can't check (a sibling, an attribute, a structural pseudo-class such as
 * `:first-child`) it still counts.
 *
 * A rule that applies only in a state such as `:active`, which the runtime
 * can't see, counts when `inState` is true. LynxElement's #applyInheritance
 * asks so for an HTML text tag's own rules: one it doesn't count gets the
 * inherited value inline, which would win over the rule while the state
 * holds. #drawnAtDefault doesn't, for a Lynx `<text>` around an inline tag:
 * one it counts lets the tag take its ancestors' text style while the
 * `<text>` draws at the default (issue #652).
 *
 * Both are worked out again when an ancestor's classes change (see
 * LynxElement's #ancestorsChanged). Counting a rule whose ancestor isn't
 * there left an HTML text tag at Lynx's default rather than inheriting
 * (issue #667).
 */
export const matchedStyleFlagsFor = (
  tokens: ReadonlySet<string>,
  ancestorAt: (index: number) => ReadonlySet<string> | undefined,
  inState = false,
): number => {
  const index = readIndex();
  if (!index) return fallbackFlags(tokens);
  const matches = (rule: IndexedRule): boolean =>
    (inState || !rule.inState) &&
    rule.rest.every((other) => tokens.has(other)) &&
    ancestorsMatch(rule.ancestors, 0, 0, ancestorAt);
  let flags = 0;
  for (const rule of index.anyRules) {
    if (matches(rule)) flags |= rule.flags;
  }
  for (const token of tokens) {
    for (const rule of index.byToken.get(token) ?? []) {
      if (matches(rule)) flags |= rule.flags;
    }
  }
  return flags;
};

/**
 * Whether the ancestors from the `from`th up match a selector's steps from
 * the `step`th, as a browser matches a selector right to left. A descendant
 * step tries each ancestor in turn, so `.a > .b .c` finds the `.b` whose
 * parent is `.a` even past a nearer `.b`.
 */
const ancestorsMatch = (
  steps: readonly AncestorStep[],
  step: number,
  from: number,
  ancestorAt: (index: number) => ReadonlySet<string> | undefined,
): boolean => {
  if (step === steps.length) return true;
  const [combinator, required] = steps[step]!;
  for (let at = from; ; at++) {
    const ancestor = ancestorAt(at);
    if (!ancestor) return false;
    if (
      required.every((token) => ancestor.has(token)) &&
      ancestorsMatch(steps, step + 1, at + 1, ancestorAt)
    ) {
      return true;
    }
    if (combinator === '>') return false;
  }
};

/**
 * Whether a rule that sets a text property requires an ancestor: then an
 * element's text styles can change when the classes of an element above it
 * do (see matchedStyleFlagsFor).
 */
export const hasAncestorTextRules = (): boolean =>
  readIndex()?.hasAncestorRules ?? false;

/**
 * Whether a rule that sets a text property requires one of these tokens of
 * an ancestor: only then can adding or removing them on an element change
 * which rules apply to the elements below it (see matchedStyleFlagsFor). The
 * page's `dark` class, which most apps' rules require of no ancestor, then
 * sends nothing down the tree.
 */
export const ancestorTextRulesRead = (tokens: Iterable<string>): boolean => {
  const required = readIndex()?.ancestorTokens;
  if (!required?.size) return false;
  for (const token of tokens) {
    if (required.has(token)) return true;
  }
  return false;
};

const fallbackFlags = (tokens: ReadonlySet<string>): number => {
  let flags = 0;
  for (const token of tokens) {
    if (token.startsWith('<') || isRendererClass(token)) continue;
    // Any class of the app's own may set a text style.
    flags |= ALL_TEXT_PROPERTIES;
    if (LAYOUT_UTILITIES.has(token.slice(token.lastIndexOf(':') + 1))) {
      flags |= LAYOUT_FLAG;
    }
  }
  return flags;
};

/**
 * Whether an inline `display` lays children out as a block does: in a column,
 * where text and inline tags share lines. `block` and the like are Lynx's
 * `linear` by the time they reach here (see display.ts).
 */
export const isBlockDisplay = (display: unknown): boolean =>
  display == null ||
  display === '' ||
  ['linear', 'block', 'flow-root', 'none'].includes(
    String(display).trim().toLowerCase(),
  );

/** Whether a `linear-orientation` or `linear-direction` lays out a row. */
export const isRowOrientation = (orientation: unknown): boolean =>
  orientation != null && /^(horizontal|row)/i.test(String(orientation).trim());

/**
 * The class an anonymous `<text>` carries, so the snapshot of a server render
 * tells it from an app's `<text>` (see LynxHydrateDocument), and an app's
 * global stylesheet can style loose text if it wants to.
 */
export const ANONYMOUS_TEXT_CLASS = '_ngtext';

/**
 * Whether a raw-text's text draws nothing: empty, or a space, which is what
 * the renderer collapses whitespace to (see collapseWhitespace in
 * renderer.ts). A browser gives such text no box; Lynx gives a `<text>` that
 * holds it a line of height, so an anonymous `<text>` holding only blank
 * text is hidden. A non-breaking space is text.
 */
export const isBlankText = (text: string | undefined): boolean =>
  !text || /^[ \t\n\r\f\v]*$/.test(text);

/**
 * The elements a raw-text goes into as it is: a `<text>` (or an
 * `<inline-truncation>` in one), which draws it; elements that draw no
 * children's text, such as an `<input>` or an `<image>`, where the web shows
 * none either; and the flattened wrappers (`<block>`, `<if>`, `<for>`), which
 * may well be inside a `<text>`. A `<list>` handles its own children. Every
 * other element, a `<view>`, a `<div>`'s view or a component's host, draws
 * text in an anonymous `<text>` (see LynxElement's #regroup).
 */
export const TAKES_RAW_TEXT: ReadonlySet<string> = new Set([
  'text',
  'raw-text',
  'inline-truncation',
  'block',
  'if',
  'for',
  'input',
  'textarea',
  'image',
  'svg',
  'video',
  'canvas',
  'webview',
  'frame',
  'list',
  'comment',
]);

/**
 * The elements whose children lay out in a column, as a block's do, unless
 * their CSS says otherwise: views, the page, and component hosts (any tag
 * that isn't one of these Lynx elements renders as a view). Text and inline
 * tags share lines only in these. The others, such as a `<scroll-view>`,
 * which may scroll sideways, or an `<overlay>`, keep each run of text in a
 * `<text>` of its own.
 */
export const NOT_BLOCK_CONTAINERS: ReadonlySet<string> = new Set([
  'scroll-view',
  'list-item',
  'overlay',
  'viewpager',
  'viewpager-item',
  'refresh',
  'refresh-header',
  'title-bar-view',
  'scroll-coordinator',
  'scroll-coordinator-header',
  'scroll-coordinator-toolbar',
  'scroll-coordinator-slot',
  'scroll-coordinator-slot-drag',
  'blur-view',
  'cover-view',
]);

/**
 * What text written for the browser needs from its surroundings on Lynx:
 * which text styles an element takes from its ancestors (inheritance), and
 * whether text and inline tags beside each other share a line (inline flow).
 *
 * Lynx inherits neither. A `<text>` doesn't take its parent's `color` or
 * `font-size`, and only a `<text>` lays text out in lines, so `<div>Hi
 * <b>there</b></div>` has no line to share. The runtime puts such text and
 * tags in an anonymous `<text>` (see LynxElement's #regroup), and gives the
 * elements that stand for HTML's text the inherited styles through CSS
 * variables, which Lynx does pass down to descendants: the build plugin copies
 * each inheritable declaration in the app's CSS to a variable of its own
 * (`color: red` also sets `--angular-lynx-color: red`, see its
 * text-inheritance.ts), and those elements read the variables.
 *
 * Elements written as Lynx elements (`<view>`, `<text>`) never read them,
 * so they look as they always have.
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
 * What the build tells the runtime about the app's CSS: for each rule that
 * sets an inheritable text property or changes layout, the classes (and id,
 * as `#id`, or Lynx tag, as `<tag>`) its selector's last part requires, and
 * which of those it sets. The build plugin prepends it to the main-thread
 * script as `globalThis.__angularLynxStyleIndex` (see its style-index.ts).
 */
type StyleIndex = {
  readonly rules: readonly (readonly [readonly string[], number])[];
};

/** The index, by the first token each rule requires. */
type IndexedRules = {
  /** Rules whose selector requires nothing we can tell, such as `*`. */
  readonly any: number;
  readonly byToken: ReadonlyMap<
    string,
    readonly (readonly [string[], number])[]
  >;
};

let indexed: IndexedRules | null | undefined;

const readIndex = (): IndexedRules | null => {
  if (indexed !== undefined) return indexed;
  const index = (globalThis as { __angularLynxStyleIndex?: StyleIndex })
    .__angularLynxStyleIndex;
  if (!index) return (indexed = null);
  let any = 0;
  const byToken = new Map<string, (readonly [string[], number])[]>();
  for (const [tokens, flags] of index.rules) {
    const [first, ...rest] = tokens;
    if (first === undefined) {
      any |= flags;
    } else {
      const list = byToken.get(first) ?? [];
      list.push([rest, flags]);
      byToken.set(first, list);
    }
  }
  return (indexed = { any, byToken });
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
  name === ANONYMOUS_TEXT_CLASS;

/**
 * The flags of every rule in the app's CSS that may apply to an element with
 * these tokens (classes, `#id`, `<tag>`). It can say a rule applies when its
 * selector needs an ancestor or a state the element hasn't: it only ever errs
 * towards the element setting a style itself.
 */
export const styleFlagsFor = (tokens: ReadonlySet<string>): number => {
  const index = readIndex();
  if (!index) return fallbackFlags(tokens);
  let flags = index.any;
  for (const token of tokens) {
    for (const [rest, ruleFlags] of index.byToken.get(token) ?? []) {
      if (rest.every((other) => tokens.has(other))) flags |= ruleFlags;
    }
  }
  return flags;
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

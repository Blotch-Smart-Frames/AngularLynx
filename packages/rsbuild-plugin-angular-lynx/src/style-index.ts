import postcss, { type AtRule, type Container, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {
  INHERITED_TEXT_PROPERTIES,
  inheritanceVariable,
  isRelativeFontSize,
} from './text-inheritance.js';

/**
 * The bit for a rule that can change how an element lays its children out:
 * a `display` other than a block's, or a horizontal `linear-orientation`.
 * Above the text properties' bits, as in the runtime's text-flow.ts.
 */
export const LAYOUT_FLAG = 1 << INHERITED_TEXT_PROPERTIES.length;

/**
 * The bit for a rule whose `font-size` is the size around the element divided
 * by 1.2, read from the parent's variable: the build's `<small>`, `<sub>`
 * and `<sup>` rule, `calc(var(--angular-lynx-font-size, 14px) / 1.2)` (see
 * styles/html-text-tags.css). It stands in for the `font-size` bit, which
 * tells the runtime that a rule sets the size and that its copy passes the
 * size to the text inside. This one has no copy (see text-inheritance.ts),
 * so the runtime divides the size for the text inside itself, once for each
 * such tag around it (issue #663). Above LAYOUT_FLAG, as in the runtime's
 * text-flow.ts.
 */
export const SMALLER_FLAG = LAYOUT_FLAG << 1;

/**
 * The bit for a rule that sets a `vertical-align`. On iOS, Lynx moves only
 * the text of the `<text>` that has it, not that of the inline `<text>`s
 * inside it, and on both iOS and Android an inner one's offset replaces the
 * outer's rather than adding to it. So the runtime gives the HTML text tags
 * inside such a tag the whole distance themselves (issues #682 and #715),
 * which it reads from the index's `verticalAligns`. Above SMALLER_FLAG, as
 * in the runtime's text-flow.ts.
 */
export const VERTICAL_ALIGN_FLAG = SMALLER_FLAG << 1;

/**
 * The bit for a rule whose `font-size` is relative to the parent's (`2em`,
 * `150%`), which it has with the `font-size` bit. Its copy is `1em` (see
 * text-inheritance.ts), the size of the parent of the tag that reads it, so
 * the runtime gives the text inside no class for its level of `<small>`s,
 * which would divide that size again for each `<small>` above it (issue
 * #701). Above VERTICAL_ALIGN_FLAG, as in the runtime's text-flow.ts.
 */
export const RELATIVE_SIZE_FLAG = VERTICAL_ALIGN_FLAG << 1;

/**
 * How far a `vertical-align` moves the text off the baseline: the `em` of
 * the element's own size, plus pixels. The runtime adds up the distances of
 * the tags around an HTML text tag, so it keeps the two apart (an outer
 * tag's `em` counts for more in a smaller tag inside it).
 */
export type BaselineDistance = [em: number, px: number];

/**
 * The distance a `vertical-align` value moves the text by, or null for one
 * with no fixed length: a keyword such as `super` or `middle`, which Lynx
 * places by the line, a percentage of the line height, a `calc()` or a
 * `var()`, or any other unit. `baseline` and `0` don't move it. The
 * runtime reads an inline `vertical-align` the same way (parseVerticalAlign
 * in its text-flow.ts), and a test keeps the two the same.
 */
export const parseVerticalAlign = (value: string): BaselineDistance | null => {
  const length = value.trim().toLowerCase();
  if (length === 'baseline' || length === '0') return [0, 0];
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(em|px)$/.exec(length);
  if (!match) return null;
  const amount = Number(match[1]) + 0;
  return match[2] === 'em' ? [amount, 0] : [0, amount];
};

/**
 * Whether a `font-size` is the build's smaller size, the parent's variable
 * divided by 1.2, which the runtime divides again for each level (see
 * SMALLER_FLAG). An app's own rule that reads the variable with another
 * divisor keeps the `font-size` bit: it has no copy either, so the text
 * inside it takes the size around it, but the runtime can't give it the
 * rule's size.
 */
const isSmallerSize = (value: string): boolean =>
  SMALLER_SIZE.test(value.trim());

/**
 * The variable alone, with the build's 14px fallback, divided by 1.2: a
 * `calc()` that adds to it, such as `calc((var(--angular-lynx-font-size)
 * + 12px) / 1.2)`, makes a size the runtime's division can't follow, and so
 * does another fallback, which the runtime's classes don't have (they draw
 * the text inside at 14px divided again where no ancestor sets the size).
 */
const SMALLER_SIZE = new RegExp(
  `^calc\\(\\s*var\\(\\s*${inheritanceVariable('font-size')}\\s*,\\s*14px\\s*\\)\\s*/\\s*1\\.2\\s*\\)$`,
  'i',
);

/** The `display` values that lay children out in a column, as a block. */
const BLOCK_DISPLAYS = new Set(['linear', 'block', 'flow-root', 'none']);

/**
 * One step up from a selector's subject, nearest first: the combinator
 * between it and the compound below it (`>` for a child, ` ` for a
 * descendant), and the tokens the ancestor's compound requires.
 */
export type AncestorStep = [combinator: '>' | ' ', tokens: string[]];

/**
 * A rule in the index: the tokens its subject requires, what it sets, the
 * ancestors its selector requires (left out when it requires none), and 1
 * if it applies only in a state the runtime can't see, such as `:active`.
 */
export type StyleIndexRule =
  | [tokens: string[], flags: number]
  | [tokens: string[], flags: number, ancestors: AncestorStep[]]
  | [tokens: string[], flags: number, ancestors: AncestorStep[], inState: 1];

/**
 * A rule that sets a `vertical-align`, for the runtime to tell how far the
 * tags inside the element it styles move (see VERTICAL_ALIGN_FLAG): the
 * tokens its subject requires and the ancestors, as in StyleIndexRule, the
 * distance (null when the runtime can't copy it, see parseVerticalAlign and
 * verticalAlignOf), and where it stands in the cascade, so the runtime can
 * tell which of the rules that match an element wins, as Lynx does: its
 * selector's specificity (see specificityOf), then the stylesheet it's in
 * and its place there. The runtime takes the later rule of a tie only
 * within one stylesheet, whose order is the bundle's.
 */
export type VerticalAlignRule = [
  tokens: string[],
  ancestors: AncestorStep[],
  distance: BaselineDistance | null,
  specificity: number,
  sheet: number,
  order: number,
];

/**
 * What the runtime needs to know about the app's CSS (see the runtime's
 * lynx-element/text-flow.ts): for each rule that sets an inheritable text
 * property or a `vertical-align`, or changes layout, the tokens the last
 * part of its selector requires (classes, `#id`, `<tag>`), a bitmask of what
 * it sets, and what the rest of its selector requires of the element's
 * ancestors. The
 * runtime can't read the stylesheet, which Lynx compiles into the bundle.
 * Each rule that sets a `vertical-align` is in `verticalAligns` too, with
 * its distance, left out when there are none.
 */
export type StyleIndex = {
  rules: StyleIndexRule[];
  verticalAligns?: VerticalAlignRule[];
};

/**
 * What a declaration sets, as style index bits.
 */
const flagsOf = (property: string, value: string): number => {
  const name = property.toLowerCase();
  if (name === 'font-size' && isSmallerSize(value)) return SMALLER_FLAG;
  if (name === 'vertical-align') return VERTICAL_ALIGN_FLAG;
  const bit = INHERITED_TEXT_PROPERTIES.indexOf(name);
  if (name === 'font-size' && isRelativeFontSize(value)) {
    return (1 << bit) | RELATIVE_SIZE_FLAG;
  }
  if (bit >= 0) return 1 << bit;
  const keyword = value.trim().toLowerCase();
  if (name === 'display') return BLOCK_DISPLAYS.has(keyword) ? 0 : LAYOUT_FLAG;
  if (name === 'linear-orientation' || name === 'linear-direction') {
    return /^(horizontal|row)/.test(keyword) ? LAYOUT_FLAG : 0;
  }
  return 0;
};

/**
 * Whether `container` is inside an at-rule whose rules aren't selectors.
 */
const inNonSelectorAtRule = (container: Container): boolean => {
  for (
    let parent = container.parent;
    parent && parent.type !== 'root';
    parent = parent.parent
  ) {
    if (
      parent.type === 'atrule' &&
      /keyframes$|^font-face$|^page$|^property$/i.test((parent as AtRule).name)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * The pseudo-classes for a state the runtime can't see: the user's touch,
 * pointer or focus. Lynx supports only `:active` of them, for a finger on
 * the element (see investigations/lynx-vs-web-differences.md).
 */
const STATE_PSEUDO_CLASSES = new Set([
  ':active',
  ':hover',
  ':focus',
  ':focus-visible',
  ':focus-within',
  ':visited',
]);

/** What a selector requires of the element it styles and its ancestors. */
type Subject = {
  tokens: string[];
  ancestors: AncestorStep[];
  inState: boolean;
  /**
   * Whether the runtime can check all of it: nothing was left out but `*`.
   * A rule it may count for an element the rule doesn't style can't give
   * that element its distance (see verticalAlignOf).
   */
  exact: boolean;
  /** Whether it styles a pseudo-element (`::before`), not the element. */
  pseudoElement: boolean;
  /** Its specificity, as specificityOf packs it. */
  specificity: number;
};

/**
 * A selector's specificity, packed into one number that compares as the
 * three counts do: ids, then classes, attributes and pseudo-classes, then
 * types and pseudo-elements, each up to 999. `:where()` counts nothing, and
 * `:is()`, `:not()` and `:has()` count their most specific argument, as in
 * a browser. Angular's scoping attributes are classes by now, and so are the
 * type selectors the build turns into the runtime's tag classes, which is
 * what Lynx compares, as it reads the CSS the build wrote.
 */
const specificityOf = (selector: selectorParser.Selector): number => {
  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const node of selector.nodes) {
    if (node.type === 'id') ids++;
    else if (node.type === 'class' || node.type === 'attribute') classes++;
    else if (node.type === 'tag') types++;
    else if (node.type === 'pseudo') {
      const name = node.value.toLowerCase();
      if (name.startsWith('::') || PSEUDO_ELEMENTS_WITH_ONE_COLON.has(name)) {
        types++;
      } else if (name === ':is' || name === ':not' || name === ':has') {
        // Its arguments count instead of it: the most specific one.
        const inner = Math.max(0, ...node.nodes.map(specificityOf));
        ids += Math.floor(inner / 1e6);
        classes += Math.floor(inner / 1e3) % 1e3;
        types += inner % 1e3;
      } else if (name !== ':where') classes++;
    }
  }
  const count = (n: number): number => Math.min(n, 999);
  return count(ids) * 1e6 + count(classes) * 1e3 + count(types);
};

/** The pseudo-elements CSS still lets a selector write with one colon. */
const PSEUDO_ELEMENTS_WITH_ONE_COLON = new Set([
  ':before',
  ':after',
  ':first-line',
  ':first-letter',
]);

/**
 * What each selector in a list requires: the classes, id and tag of its
 * last compound, and of each compound before it, back to the first sibling
 * combinator (`+`, `~`). A part the runtime can't check (an attribute, `*`,
 * a pseudo-class other than a state's, a sibling) is left out, so a rule can
 * be counted for an element it doesn't style. For layout the runtime reads
 * only the last compound's tokens, where that only ever makes it leave the
 * element's children as they are. For text styles it checks the ancestors
 * too, since a rule counted where it doesn't apply keeps an HTML text tag
 * from inheriting (see the runtime's matchedStyleFlagsFor).
 */
const subjectsOf = (selectorList: string): Subject[] => {
  const subjects: Subject[] = [];
  try {
    selectorParser((selectors) => {
      selectors.each((selector) => {
        const compounds: string[][] = [[]];
        const combinators: ('>' | ' ')[] = [];
        let inState = false;
        let exact = true;
        let pseudoElement = false;
        for (let i = selector.nodes.length - 1; i >= 0; i--) {
          const node = selector.nodes[i]!;
          const tokens = compounds[compounds.length - 1]!;
          if (node.type === 'combinator') {
            const combinator = node.value.trim();
            // A sibling's compound, and what's before it, is left out.
            if (combinator !== '>' && combinator !== '') {
              exact = false;
              break;
            }
            combinators.push(combinator === '>' ? '>' : ' ');
            compounds.push([]);
          } else if (node.type === 'class') tokens.push(node.value);
          else if (node.type === 'id') tokens.push(`#${node.value}`);
          else if (node.type === 'tag') {
            tokens.push(`<${node.value.toLowerCase()}>`);
          } else if (
            node.type === 'pseudo' &&
            STATE_PSEUDO_CLASSES.has(node.value.toLowerCase())
          ) {
            inState = true;
          } else if (node.type !== 'universal' && node.type !== 'comment') {
            exact = false;
            if (node.type === 'pseudo') {
              const name = node.value.toLowerCase();
              if (
                name.startsWith('::') ||
                PSEUDO_ELEMENTS_WITH_ONE_COLON.has(name)
              ) {
                pseudoElement = true;
              }
            }
          }
        }
        // An outermost compound with nothing we can check, as in
        // `:root .a`, or none at all, as in a nested rule's `> .b`, requires
        // no ancestor we can tell. It still requires an ancestor to be there:
        // `* > * > .a` doesn't match an `.a` with one ancestor, so the rule
        // isn't exact.
        while (
          compounds.length > 1 &&
          !compounds[compounds.length - 1]!.length
        ) {
          compounds.pop();
          combinators.pop();
          exact = false;
        }
        const [tokens, ...ancestors] = compounds.map((c) => c.sort());
        subjects.push({
          tokens: tokens!,
          ancestors: ancestors.map((t, i) => [combinators[i]!, t]),
          inState,
          exact,
          pseudoElement,
          specificity: specificityOf(selector),
        });
      });
    }).processSync(selectorList);
  } catch {
    // A selector PostCSS can't parse styles nothing Lynx can match.
  }
  return subjects;
};

/**
 * Builds the style index of a set of stylesheets: the app's CSS, after the
 * plugin's own PostCSS (type selectors are classes by then, and Angular's
 * scoping is classes too).
 */
export const styleIndexOf = (stylesheets: readonly string[]): StyleIndex => {
  const rulesBySelector = new Map<string, StyleIndexRule>();
  const verticalAligns: VerticalAlignRule[] = [];
  for (const [sheet, css] of stylesheets.entries()) {
    let root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    root.walkRules((rule) => {
      if (inNonSelectorAtRule(rule)) return;
      let flags = 0;
      rule.each((node) => {
        if (node.type === 'decl') flags |= flagsOf(node.prop, node.value);
      });
      if (!flags) return;
      const distance =
        flags & VERTICAL_ALIGN_FLAG ? verticalAlignOf(rule) : undefined;
      for (const subject of subjectsOf(rule.selector)) {
        const { tokens, ancestors, inState } = subject;
        // A state's rule counts for none of the tags' distances, as for their
        // sizes (see the runtime's #sizeChain), and a pseudo-element's moves
        // no text of the element.
        if (distance !== undefined && !inState && !subject.pseudoElement) {
          verticalAligns.push([
            tokens,
            ancestors,
            subject.exact ? distance : null,
            subject.specificity,
            sheet,
            verticalAligns.length,
          ]);
        }
        const entry: StyleIndexRule = inState
          ? [tokens, flags, ancestors, 1]
          : ancestors.length
            ? [tokens, flags, ancestors]
            : [tokens, flags];
        // Rules that require the same share an entry.
        const key = JSON.stringify([tokens, ancestors, inState]);
        const merged = rulesBySelector.get(key);
        if (merged) merged[1] |= flags;
        else rulesBySelector.set(key, entry);
      }
    });
  }
  const rules = [...rulesBySelector.values()];
  return verticalAligns.length ? { rules, verticalAligns } : { rules };
};

/**
 * The distance a rule's `vertical-align` moves its text by, the last one it
 * declares, as a browser takes it. Null where the runtime can't tell it
 * applies as it is: an `!important` one, which beats rules the runtime would
 * rank above it, and one in a `@media` or another at-rule, or nested in
 * another rule, whose selector or condition the index doesn't follow.
 */
const verticalAlignOf = (rule: Rule): BaselineDistance | null => {
  let value: string | undefined;
  let important = false;
  rule.each((node) => {
    if (node.type === 'decl' && node.prop.toLowerCase() === 'vertical-align') {
      value = node.value;
      important ||= node.important;
    }
  });
  if (important || rule.parent?.type !== 'root') return null;
  return parseVerticalAlign(value!);
};

/**
 * The statement that hands the index to the runtime, which reads it as
 * `globalThis.__angularLynxStyleIndex` (see the runtime's text-flow.ts).
 */
export const styleIndexStatement = (index: StyleIndex): string =>
  `globalThis["__angularLynxStyleIndex"]=${JSON.stringify(index)};`;

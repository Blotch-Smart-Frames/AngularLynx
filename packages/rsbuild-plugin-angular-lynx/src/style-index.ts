import postcss, { type AtRule, type Container } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {
  INHERITED_TEXT_PROPERTIES,
  inheritanceVariable,
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
 * The bits for a rule that moves its text off the baseline by a `vertical-align`
 * length: RAISED_FLAG for the build's `<sup>` rule (`0.4em`), LOWERED_FLAG
 * for its `<sub>` rule (`-0.24em`), and VERTICAL_ALIGN_FLAG for any other
 * value, whose distance the runtime doesn't know (see
 * styles/html-text-tags.css). On iOS, Lynx moves only the text of the
 * `<text>` that has the `vertical-align`, not that of the inline `<text>`s
 * inside it, and on both iOS and Android an inner one's offset replaces the
 * outer's rather than adding to it. So the runtime gives the HTML text tags
 * inside a `<sub>` or `<sup>` the whole distance themselves (issue #682),
 * and these tell it which tags move by how much. Above SMALLER_FLAG, as in
 * the runtime's text-flow.ts.
 */
export const RAISED_FLAG = SMALLER_FLAG << 1;
export const LOWERED_FLAG = RAISED_FLAG << 1;
export const VERTICAL_ALIGN_FLAG = LOWERED_FLAG << 1;

/**
 * What a `vertical-align` value moves the text by, as style index bits.
 */
const verticalAlignFlag = (value: string): number => {
  const length = value.trim().toLowerCase();
  if (length === '0.4em') return RAISED_FLAG;
  if (length === '-0.24em') return LOWERED_FLAG;
  return VERTICAL_ALIGN_FLAG;
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
 * What the runtime needs to know about the app's CSS (see the runtime's
 * lynx-element/text-flow.ts): for each rule that sets an inheritable text
 * property or a `vertical-align`, or changes layout, the tokens the last
 * part of its selector requires (classes, `#id`, `<tag>`), a bitmask of what
 * it sets, and what the rest of its selector requires of the element's
 * ancestors. The
 * runtime can't read the stylesheet, which Lynx compiles into the bundle.
 */
export type StyleIndex = {
  rules: StyleIndexRule[];
};

/**
 * What a declaration sets, as style index bits.
 */
const flagsOf = (property: string, value: string): number => {
  const name = property.toLowerCase();
  if (name === 'font-size' && isSmallerSize(value)) return SMALLER_FLAG;
  if (name === 'vertical-align') return verticalAlignFlag(value);
  const bit = INHERITED_TEXT_PROPERTIES.indexOf(name);
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
};

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
        for (let i = selector.nodes.length - 1; i >= 0; i--) {
          const node = selector.nodes[i]!;
          const tokens = compounds[compounds.length - 1]!;
          if (node.type === 'combinator') {
            const combinator = node.value.trim();
            // A sibling's compound, and what's before it, is left out.
            if (combinator !== '>' && combinator !== '') break;
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
          }
        }
        // An outermost compound with nothing we can check, as in
        // `:root .a`, or none at all, as in a nested rule's `> .b`, requires
        // no ancestor we can tell.
        while (
          compounds.length > 1 &&
          !compounds[compounds.length - 1]!.length
        ) {
          compounds.pop();
          combinators.pop();
        }
        const [tokens, ...ancestors] = compounds.map((c) => c.sort());
        subjects.push({
          tokens: tokens!,
          ancestors: ancestors.map((t, i) => [combinators[i]!, t]),
          inState,
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
  for (const css of stylesheets) {
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
      for (const { tokens, ancestors, inState } of subjectsOf(rule.selector)) {
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
  return { rules: [...rulesBySelector.values()] };
};

/**
 * The statement that hands the index to the runtime, which reads it as
 * `globalThis.__angularLynxStyleIndex` (see the runtime's text-flow.ts).
 */
export const styleIndexStatement = (index: StyleIndex): string =>
  `globalThis["__angularLynxStyleIndex"]=${JSON.stringify(index)};`;

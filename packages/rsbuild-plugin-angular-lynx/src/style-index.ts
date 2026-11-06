import postcss, { type AtRule, type Container } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { INHERITED_TEXT_PROPERTIES } from './text-inheritance.js';

/**
 * The bit for a rule that can change how an element lays its children out:
 * a `display` other than a block's, or a horizontal `linear-orientation`.
 * Above the text properties' bits, as in the runtime's text-flow.ts.
 */
export const LAYOUT_FLAG = 1 << INHERITED_TEXT_PROPERTIES.length;

/** The `display` values that lay children out in a column, as a block. */
const BLOCK_DISPLAYS = new Set(['linear', 'block', 'flow-root', 'none']);

/**
 * What the runtime needs to know about the app's CSS (see the runtime's
 * lynx-element/text-flow.ts): for each rule that sets an inheritable text
 * property or changes layout, the tokens the last part of its selector
 * requires (classes, `#id`, `<tag>`) and a bitmask of what it sets. The
 * runtime can't read the stylesheet, which Lynx compiles into the bundle.
 */
export type StyleIndex = {
  rules: [string[], number][];
};

/**
 * What a declaration sets, as style index bits.
 */
const flagsOf = (property: string, value: string): number => {
  const name = property.toLowerCase();
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
 * The tokens each selector in a list requires of the element it styles: the
 * classes, id and tag of its last compound. A part the runtime can't check
 * (a pseudo-class, an attribute, `*`) is left out, so a rule can be counted
 * for an element it doesn't style. That only ever makes the runtime leave
 * the element's text as it is.
 */
const subjectsOf = (selectorList: string): string[][] => {
  const subjects: string[][] = [];
  try {
    selectorParser((selectors) => {
      selectors.each((selector) => {
        const tokens: string[] = [];
        for (let i = selector.nodes.length - 1; i >= 0; i--) {
          const node = selector.nodes[i]!;
          if (node.type === 'combinator') break;
          if (node.type === 'class') tokens.push(node.value);
          else if (node.type === 'id') tokens.push(`#${node.value}`);
          else if (node.type === 'tag') {
            tokens.push(`<${node.value.toLowerCase()}>`);
          }
        }
        subjects.push(tokens.sort());
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
  const flagsBySubject = new Map<string, [string[], number]>();
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
      for (const tokens of subjectsOf(rule.selector)) {
        const key = tokens.join(' ');
        const entry = flagsBySubject.get(key);
        if (entry) entry[1] |= flags;
        else flagsBySubject.set(key, [tokens, flags]);
      }
    });
  }
  return { rules: [...flagsBySubject.values()] };
};

/**
 * The statement that hands the index to the runtime, which reads it as
 * `globalThis.__angularLynxStyleIndex` (see the runtime's text-flow.ts).
 */
export const styleIndexStatement = (index: StyleIndex): string =>
  `globalThis["__angularLynxStyleIndex"]=${JSON.stringify(index)};`;

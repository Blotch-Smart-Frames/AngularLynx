import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { AtRule, Container, Declaration, PluginCreator } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * The text properties an element takes from its parent, as on the web: the
 * list Lynx inherits with `enableCSSInheritance` turned on. A copy of
 * `INHERITED_TEXT_PROPERTIES` in the runtime's lynx-element/text-flow.ts,
 * which this package can't import (it runs in Node, the runtime in Lynx),
 * kept the same by a test: each property's bit in the style index (see
 * style-index.ts) is its position here.
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

const INHERITED = new Set(INHERITED_TEXT_PROPERTIES);

/**
 * The CSS variable an inheritable property is copied to.
 */
export const inheritanceVariable = (property: string): string =>
  `--angular-lynx-${property}`;

/**
 * The class the runtime gives each element that has an HTML text tag or
 * loose text inside it, the only elements whose copies anything reads. A copy
 * of `INHERITANCE_CLASS` in the runtime's lynx-element/text-flow.ts, kept the
 * same by a test.
 */
export const INHERITANCE_CLASS = '_nginherit';

/**
 * Whether a compound selector part only ever matches the page: its copies
 * cost one element, and `:root` with a class before it is a selector Lynx
 * may not read.
 */
const isRoot = (node: selectorParser.Node): boolean =>
  node.type === 'pseudo' && node.value.toLowerCase() === ':root';

/**
 * Narrows each selector in a list to the elements with INHERITANCE_CLASS:
 * `.a:active` becomes `.a._nginherit:active`, `*` becomes `._nginherit`. A
 * selector that styles a pseudo-element (`::placeholder`) goes, since nothing
 * is inside one to read the copies, and one of `:root`, the page, stays as
 * it is.
 */
const narrower = selectorParser((selectors) => {
  selectors.each((selector) => {
    const nodes = selector.nodes;
    let start = nodes.length;
    while (start > 0 && nodes[start - 1]!.type !== 'combinator') start--;
    const compound = nodes.slice(start);
    if (
      compound.some(
        (node) => node.type === 'pseudo' && node.value.startsWith('::'),
      )
    ) {
      selector.remove();
      return;
    }
    if (compound.some(isRoot)) return;
    const scope = selectorParser.className({ value: INHERITANCE_CLASS });
    // `*` alone: `svg|*` never reaches Lynx's CSS as an element.
    const universal = compound.find(
      (node) => node.type === 'universal' && node.toString().trim() === '*',
    );
    if (universal) {
      universal.replaceWith(scope);
      return;
    }
    // Ahead of the pseudo-classes, after the tag, classes and id.
    const firstPseudo = compound.find((node) => node.type === 'pseudo');
    if (firstPseudo) selector.insertBefore(firstPseudo, scope);
    else selector.append(scope);
  });
});

/**
 * The selector list of a rule's copies (see textInheritanceForLynx), or ''
 * if none of its selectors needs them. One PostCSS can't parse is kept as it
 * is: its copies cost what they did, but stay correct.
 */
export const scopedSelector = (selector: string): string => {
  try {
    return narrower.processSync(selector).trim();
  } catch {
    return selector;
  }
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
 * A PostCSS plugin that copies each inheritable text declaration to a CSS
 * variable of its own, for the elements with INHERITANCE_CLASS:
 * `.title { color: red }` is followed by
 * `.title._nginherit { --angular-lynx-color: red }`.
 *
 * Lynx inherits no text style: a `<text>` doesn't take its parent's `color`
 * or `font-size`. It does pass CSS variables down, and keeps them up to date
 * when a class changes. So the elements that stand for HTML's text, the HTML
 * text tags (`<p>`, `<span>`…) and the anonymous `<text>` the runtime draws
 * loose text in, read the variables for the properties their own rules don't
 * set (see the runtime's lynx-element/text-flow.ts), and take the nearest
 * ancestor's value, as on the web. Elements written as Lynx elements don't
 * read them, so they look as they always have.
 *
 * Only an element with one of those inside it needs the copies, and the
 * runtime gives each such element INHERITANCE_CLASS, so the copies go in a
 * rule of their own narrowed to it. In the rule itself, they cost every
 * element it styled: an element that sets custom properties of its own has
 * its whole set (the theme's colors included) copied, parsed and resolved
 * when the tree is flushed, where one that sets none shares its parent's.
 * For a screen of 5,000 `<text class="text">` that was 61 ms on an iPhone 14
 * Pro, though no `<text>` there has anything inside to read them.
 *
 * The copies' rule follows the rule it copies, and every selector gains the
 * same class, so the copies win over each other as the declarations do.
 *
 * It runs at `OnceExit`, after Tailwind 4's lowering, which converts the
 * values Lynx can't read (`oklch()` colors, nesting), so the variables get
 * values Lynx can read. A rule that sets the variable itself keeps its own.
 */
export const textInheritanceForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-text-inheritance',
  OnceExit(root) {
    root.walkRules((rule) => {
      // The walk reaches the copies' rules too, which set custom properties
      // only, so copy nothing.
      if (inNonSelectorAtRule(rule)) return;
      const own = new Set<string>();
      rule.each((node) => {
        if (node.type === 'decl' && node.prop.startsWith('--')) {
          own.add(node.prop);
        }
      });
      const copies: Declaration[] = [];
      rule.each((node) => {
        if (node.type !== 'decl') return;
        const property = node.prop.toLowerCase();
        if (!INHERITED.has(property)) return;
        const variable = inheritanceVariable(property);
        if (own.has(variable)) return;
        own.add(variable);
        const copy = node.clone({ prop: variable, important: false });
        delete copy.raws.important;
        copies.push(copy);
      });
      if (copies.length === 0) return;
      const selector = scopedSelector(rule.selector);
      if (!selector) return;
      rule.after(rule.clone({ selector, nodes: [] }).append(copies));
    });
  },
});
textInheritanceForLynx.postcss = true;

/**
 * Adds `textInheritanceForLynx` to every environment's PostCSS plugins. Call
 * it after applyTailwind, so it runs after Tailwind 4's lowering at OnceExit.
 */
export const applyTextInheritance = (api: RsbuildPluginAPI): void => {
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
    mergeRsbuildConfig(config, {
      tools: {
        postcss: (_options, { addPlugins }) => {
          addPlugins(textInheritanceForLynx());
        },
      },
    }),
  );
};

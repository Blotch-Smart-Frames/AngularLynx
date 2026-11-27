import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type {
  AtRule,
  Container,
  Declaration,
  PluginCreator,
  Rule,
} from 'postcss';
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

const VARIABLES = new Set(INHERITED_TEXT_PROPERTIES.map(inheritanceVariable));

/**
 * Whether a declaration's value reads `variable`: `var(--x)` or
 * `var( --x, 14px)`, not `var(--x-y)`.
 */
const readsVariable = (value: string, variable: string): boolean =>
  new RegExp(`var\\(\\s*${variable}\\s*[,)]`, 'i').test(value);

/**
 * Whether a `font-size` is relative to the parent's size: a length in `em`
 * or a percentage, alone or in a `calc()`, but not `rem`, which is the
 * root's. A copy of `isRelativeFontSize` in the runtime's
 * lynx-element/text-flow.ts, kept the same by a test.
 */
export const isRelativeFontSize = (value: string): boolean =>
  /(?:^|[^\w.-])[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:em|%)(?![\w-])/i.test(value);

/**
 * The class the runtime gives each element that has an HTML text tag or
 * loose text inside it, the only elements whose copies anything reads. A copy
 * of `INHERITANCE_CLASS` in the runtime's lynx-element/text-flow.ts, kept the
 * same by a test.
 */
export const INHERITANCE_CLASS = '_nginherit';

/**
 * The class the runtime gives each Lynx `<text>` with INHERITANCE_CLASS, which
 * the copies of a rule naming `text` are narrowed to instead. A copy of
 * `LYNX_TEXT_INHERITANCE_CLASS` in the runtime's lynx-element/text-flow.ts,
 * kept the same by a test.
 *
 * An HTML text tag (`<p>`) is a `<text>` on Lynx, so `view > text` matches
 * it, but no `text` selector would on the web. The theme's
 * `view > text { color: var(--foreground) }` copied to `--foreground` on a
 * `<p>` hid the color of the view around it from the inline tags in the `<p>`
 * (issue #610). The runtime gives the class to Lynx `<text>`s alone, and one
 * class in place of the other keeps each copy's specificity what it was.
 */
export const LYNX_TEXT_INHERITANCE_CLASS = '_nginherit-text';

/**
 * Narrows each selector in a list to the elements with INHERITANCE_CLASS:
 * `.a:active` becomes `.a._nginherit:active`, `*` becomes `._nginherit`, and
 * one naming `text` to LYNX_TEXT_INHERITANCE_CLASS (`view > text` becomes
 * `view > text._nginherit-text`). A
 * selector that styles a pseudo-element (`::placeholder`) goes, since nothing
 * is inside one to read the copies. `:root` is narrowed too, though it's one
 * element, so its copies stay one class below the others', as they were:
 * Lynx matches `._nginherit:root` on the page, and Lynx for Web moves the
 * `:root` it turns into `[part="page"]` to the front.
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
    // A `text` tag names the Lynx element: an HTML text tag's selector names
    // the tag (`p`), or its class once type selectors are rewritten.
    const namesText = compound.some(
      (node) => node.type === 'tag' && node.value.toLowerCase() === 'text',
    );
    const scope = selectorParser.className({
      value: namesText ? LYNX_TEXT_INHERITANCE_CLASS : INHERITANCE_CLASS,
    });
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
 * values Lynx can read. A rule that sets the variable itself keeps its own,
 * and the copies' rule sets it too: only there does it win over an earlier
 * rule's copy, which the class makes more specific than the rule itself, as
 * it did by coming later. It stays in the rule for a declaration there that
 * reads it, on an element without the class.
 */
export const textInheritanceForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-text-inheritance',
  OnceExit(root) {
    // The walk reaches the copies' rules too, which are left as they are.
    const narrowed = new WeakSet<Rule>();
    root.walkRules((rule) => {
      if (narrowed.has(rule) || inNonSelectorAtRule(rule)) return;
      const own = new Set<string>();
      rule.each((node) => {
        if (node.type === 'decl' && node.prop.startsWith('--')) {
          own.add(node.prop);
        }
      });
      const copies: Declaration[] = [];
      // The variables the rule sets itself.
      const explicit: Declaration[] = [];
      rule.each((node) => {
        if (node.type !== 'decl') return;
        if (VARIABLES.has(node.prop)) {
          explicit.push(node);
          return;
        }
        const property = node.prop.toLowerCase();
        if (!INHERITED.has(property)) return;
        const variable = inheritanceVariable(property);
        if (own.has(variable)) return;
        // A value that reads the variable itself, such as `<small>`'s
        // `font-size: calc(var(--angular-lynx-font-size, 14px) / 1.2)`,
        // would make a copy that refers to itself, which is invalid, and the
        // text inside would lose the value from above too. Without the copy,
        // it keeps that one.
        if (readsVariable(node.value, variable)) return;
        own.add(variable);
        // A custom property keeps its value as written, so a copy of `2em`
        // made each HTML text tag that reads it twice the size of its parent,
        // which is already twice the size around it (issue #701). `1em` is the
        // size of the reading tag's parent, the size it would inherit. A
        // copy can't hold the size `2em` makes instead: it would read the
        // variable from above, which here is its own, a cycle. The runtime
        // copies inline styles the same way (its relativeSizeCopy).
        const copy = node.clone({
          prop: variable,
          important: false,
          ...(property === 'font-size' && isRelativeFontSize(node.value)
            ? { value: '1em' }
            : {}),
        });
        delete copy.raws.important;
        copies.push(copy);
      });
      if (copies.length === 0 && explicit.length === 0) return;
      const selector = scopedSelector(rule.selector);
      if (!selector) return;
      const copiesRule = rule.clone({ selector, nodes: [] });
      copiesRule.append(copies);
      copiesRule.append(explicit.map((declaration) => declaration.clone()));
      narrowed.add(copiesRule);
      rule.after(copiesRule);
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

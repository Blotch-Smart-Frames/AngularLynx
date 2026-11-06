import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';
import type { AtRule, Container, PluginCreator } from 'postcss';

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
 * variable of its own: `.title { color: red }` also sets
 * `--angular-lynx-color: red`.
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
 * It runs at `OnceExit`, after Tailwind 4's lowering, which converts the
 * values Lynx can't read (`oklch()` colors, nesting), so the variables get
 * values Lynx can read. A rule that sets the variable itself keeps its own.
 */
export const textInheritanceForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-text-inheritance',
  OnceExit(root) {
    root.walkRules((rule) => {
      if (inNonSelectorAtRule(rule)) return;
      const own = new Set<string>();
      rule.each((node) => {
        if (node.type === 'decl' && node.prop.startsWith('--')) {
          own.add(node.prop);
        }
      });
      rule.each((node) => {
        if (node.type !== 'decl') return;
        const property = node.prop.toLowerCase();
        if (!INHERITED.has(property)) return;
        const variable = inheritanceVariable(property);
        if (own.has(variable)) return;
        own.add(variable);
        node.cloneAfter({ prop: variable, important: false });
      });
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

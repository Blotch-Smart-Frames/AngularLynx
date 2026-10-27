import type { PluginCreator, Result, Root, Rule } from 'postcss';

import {
  lowerDeclarations,
  lowerTransformVariables,
  TRANSFORM_DEFAULTS,
} from './declarations.js';
import { lowerSelectors } from './selectors.js';
import {
  completeKeyframes,
  flattenNesting,
  removeEmptyContainers,
  takePropertyRegistrations,
  unwrapLayers,
} from './structure.js';
import { resolveNestedVariables } from './variables.js';

/**
 * The name `@tailwindcss/postcss` gives the dependencies it reports for a
 * stylesheet it compiled.
 */
const TAILWIND_POSTCSS = '@tailwindcss/postcss';

/**
 * A PostCSS plugin that makes the CSS Tailwind CSS 4 writes work on Lynx. It
 * runs after `@tailwindcss/postcss`, and only on the stylesheets Tailwind
 * compiled, so every other stylesheet reaches Lynx as it was written.
 *
 * Tailwind 4 writes CSS for current browsers: cascade layers, `@property`,
 * nesting, `oklch()` colors, `color-mix()`, logical properties and the
 * individual `translate`/`rotate`/`scale` properties. Lynx reads none of
 * them, and mostly drops them without a warning, while Lynx for Web passes
 * them to the browser, so the web preview looks right and the app doesn't.
 * Lynx's Tailwind preset avoids this for Tailwind 3 by changing the
 * utilities; Tailwind 4 has no switch to turn its core utilities off, so this
 * rewrites its output instead, into CSS with the same meaning that Lynx
 * reads, on native and on the web alike. See
 * investigations/lynx-vs-web-differences.md for what Lynx does with each.
 */
export const tailwindForLynx: PluginCreator<void> = () => ({
  postcssPlugin: 'angular-lynx-tailwind',
  OnceExit(root, { result, rule }) {
    if (!compiledByTailwind(result)) {
      return;
    }
    lowerForLynx(root, (selector) => rule({ selector }));
  },
});
tailwindForLynx.postcss = true;

/**
 * Whether `@tailwindcss/postcss` compiled this stylesheet.
 */
const compiledByTailwind = (result: Result): boolean =>
  result.messages.some((message) => message.plugin === TAILWIND_POSTCSS);

/**
 * Lowers a stylesheet Tailwind 4 compiled. `createRule` makes the rule that
 * holds the variables' starting values.
 */
export const lowerForLynx = (
  root: Root,
  createRule: (selector: string) => Rule,
): void => {
  flattenNesting(root);
  unwrapLayers(root);
  const registrations = takePropertyRegistrations(root);
  const defaults = new Map(registrations);
  const channelVariables = colorChannelVariables(root);
  root.walkRules((rule) => {
    const inKeyframes =
      rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name);
    if (!inKeyframes && !lowerSelectors(rule)) {
      rule.remove();
      return;
    }
    if (lowerDeclarations(rule, channelVariables).composesTransform) {
      for (const [name, value] of TRANSFORM_DEFAULTS) {
        if (!defaults.has(name)) {
          defaults.set(name, value);
        }
      }
    }
  });
  unwrapLoweredColorMixSupports(root);
  resolveNestedVariables(root, registrations);
  lowerTransformVariables(root);
  completeKeyframes(root);
  removeEmptyContainers(root);
  if (defaults.size > 0) {
    // On every element, as Tailwind's own fallback for browsers without
    // `@property` does: the variables aren't inherited, so each element
    // starts from these values rather than its parent's.
    const defaultsRule = createRule('*');
    for (const [prop, value] of defaults) {
      defaultsRule.append({ prop, value });
    }
    const imports = root.nodes.filter(
      (node) => node.type === 'atrule' && /^(charset|import)$/i.test(node.name),
    );
    if (imports.length > 0) {
      imports[imports.length - 1]!.after(defaultsRule);
    } else {
      root.prepend(defaultsRule);
    }
  }
};

/**
 * The colors the stylesheet sets a `-rgb` channel variable for, without the
 * suffix: `--primary` for `--primary-rgb: 24, 24, 27`, which the @blotch/ui
 * theme sets beside each color.
 */
const colorChannelVariables = (root: Root): Set<string> => {
  const names = new Set<string>();
  root.walkDecls(/^--.+-rgb$/, ({ prop }) => {
    names.add(prop.slice(0, -'-rgb'.length));
  });
  return names;
};

/**
 * Unwraps an `@supports (color: color-mix(…))` block once it holds no
 * `color-mix()`. Tailwind puts an opacity modifier's `color-mix()` in one,
 * after a fallback without the opacity; Lynx passes no `@supports`. Once the
 * mix is `rgba()` (see colors.ts), unwrapping it makes the rule apply, after
 * the fallback, so it wins.
 */
const unwrapLoweredColorMixSupports = (root: Root): void => {
  root.walkAtRules(/^supports$/i, (atRule) => {
    // A statement (no block) has nothing to unwrap.
    if (!atRule.params.includes('color-mix(') || !atRule.nodes) {
      return;
    }
    let mixes = false;
    atRule.walkDecls((declaration) => {
      mixes ||= declaration.value.includes('color-mix(');
    });
    if (!mixes) {
      atRule.replaceWith(atRule.nodes);
    }
  });
};

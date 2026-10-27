import type { Rule } from 'postcss';

/**
 * Rewrites the selectors Tailwind CSS 4 writes into ones Lynx matches.
 * Returns `false` when no selector is left, so the caller removes the rule.
 */
export const lowerSelectors = (rule: Rule): boolean => {
  const selectors = rule.selectors
    // `:root, :host` holds Tailwind's theme variables. Lynx has no shadow
    // host, and an unknown pseudo-class drops the whole selector list, so the
    // theme would be lost. `:root` matches the page on Lynx and on the web.
    .filter((selector) => !/(?<!\\):host\b/.test(selector))
    .flatMap(unwrapWhereAndIs);
  if (selectors.length === 0) {
    return false;
  }
  rule.selectors =
    selectors.every((selector) => NOT_LAST_CHILD.test(selector)) &&
    mirrorBetweenChildren(rule)
      ? selectors.map((selector) =>
          selector.replace(NOT_LAST_CHILD, ' > * + *'),
        )
      : selectors;
  return true;
};

/**
 * Unwraps a selector that is a single `:where(…)` or `:is(…)`, such as
 * `:where(.space-y-2 > :not(:last-child))` or the `*:` variant's
 * `:is(.\*\:p-2 > *)`. Lynx's encoder drops a rule with either pseudo-class.
 * Unwrapped, `:where()` gains its argument's specificity, which only matters
 * against a rule as specific with the same property.
 */
const unwrapWhereAndIs = (selector: string): string[] => {
  const match = /^:(?:where|is)\(/i.exec(selector);
  if (
    !match ||
    closingParenthesis(selector, match[0].length) !== selector.length - 1
  ) {
    return [selector];
  }
  return splitTopLevel(selector.slice(match[0].length, -1)).flatMap(
    unwrapWhereAndIs,
  );
};

/**
 * The index of the parenthesis closing the group that starts at `start`.
 */
const closingParenthesis = (text: string, start: number): number => {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      index++;
    } else if (character === '(') {
      depth++;
    } else if (character === ')' && --depth === 0) {
      return index;
    }
  }
  return -1;
};

/**
 * Splits a selector list on its top-level commas.
 */
const splitTopLevel = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < list.length; index++) {
    const character = list[index]!;
    if (character === '\\') {
      // An escaped character, such as the `\\,` of a class name.
      current += list.slice(index, index + 2);
      index++;
      continue;
    }
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
    } else if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts;
};

/**
 * The selector Tailwind's `space-*` and `divide-*` utilities give the
 * children between which they put space or a border.
 */
const NOT_LAST_CHILD = /\s*>\s*:not\(:last-child\)$/;

/** Physical and logical box sides, each with the one opposite it. */
const OPPOSITE_SIDES: Record<string, string> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
  'block-start': 'block-end',
  'block-end': 'block-start',
  'inline-start': 'inline-end',
  'inline-end': 'inline-start',
};

/**
 * Turns "every child but the last" into "every child but the first", for a
 * rule that only sets margins, paddings, borders and custom properties, by
 * moving each side it sets to the opposite one.
 *
 * Lynx matches neither `:last-child` nor `:not(:last-child)` (the latter
 * matches every child), so `space-y-4` would also put space after the last
 * child. It does match `* + *`, every child after the first. Space or a
 * border on the end side of every child but the last is the same layout as
 * on the start side of every child but the first. Returns `false`, changing
 * nothing, for a rule that sets anything else.
 */
const mirrorBetweenChildren = (rule: Rule): boolean => {
  const sidesOnly = rule.nodes.every(
    (node) =>
      node.type !== 'decl' ||
      node.prop.startsWith('--') ||
      /^(margin|padding|border)-/.test(node.prop),
  );
  if (!sidesOnly) {
    return false;
  }
  rule.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) {
      return;
    }
    declaration.prop = declaration.prop.replace(
      /\b(top|bottom|left|right|block-start|block-end|inline-start|inline-end)\b/,
      (side) => OPPOSITE_SIDES[side]!,
    );
  });
  return true;
};

import type { Container, Declaration, Root } from 'postcss';
import valueParser, {
  type FunctionNode,
  type Node,
} from 'postcss-value-parser';

import { foldCalc } from './calc.js';

/**
 * Resolves the `var()` references that Lynx can't, inside the custom
 * properties Tailwind CSS 4 sets.
 *
 * Lynx substitutes a `var()` that a custom property's value holds directly
 * (`--tw-gradient-from: var(--color-red-500)`), but not one inside another
 * function: `--tw-translate-x: calc(var(--spacing) * 2)` and
 * `--tw-blur: blur(var(--blur-sm))` leave the property invalid, so the
 * utility does nothing on device. That holds even when the variable is set
 * in the same rule or the `var()` has a fallback.
 *
 * Each such reference becomes a value this stylesheet already knows: the
 * variable's declaration in the same rule, else its theme value (the
 * `:root` rule Tailwind writes), else the reference's fallback, else the
 * initial value Tailwind registered with `@property`. Only a variable set by
 * another utility on the same element, such as `ring-offset-2`'s width under
 * `ring-2`, loses its effect, since the value is now fixed.
 */
export const resolveNestedVariables = (
  root: Root,
  registrations: ReadonlyMap<string, string>,
): void => {
  const theme = themeVariables(root);
  root.walkDecls(/^--/, (declaration) => {
    if (!declaration.value.includes('var(')) {
      return;
    }
    const parsed = valueParser(declaration.value);
    const lookup = (name: string) =>
      sameRuleValue(declaration, name) ??
      theme.get(name) ??
      registrations.get(name);
    if (resolveInFunctions(parsed.nodes, false, lookup, new Set())) {
      // `calc(0.25rem * 6)` folds to `1.5rem`, now that it can.
      declaration.value = foldCalc(parsed.toString());
    }
  });
};

/**
 * The custom properties set on `:root`: Tailwind's theme.
 */
const themeVariables = (root: Root): Map<string, string> => {
  const variables = new Map<string, string>();
  root.walkRules((rule) => {
    if (rule.selectors.includes(':root')) {
      rule.walkDecls(/^--/, ({ prop, value }) => {
        variables.set(prop, value);
      });
    }
  });
  return variables;
};

/**
 * The value the declaration's own rule gives a custom property.
 */
const sameRuleValue = (
  declaration: Declaration,
  name: string,
): string | undefined => {
  let value: string | undefined;
  (declaration.parent as Container).each((node) => {
    if (node.type === 'decl' && node.prop === name && node !== declaration) {
      value = node.value;
    }
  });
  return value;
};

/**
 * Replaces each `var()` that sits inside a function other than `var()` with
 * the value `lookup` gives it, or its fallback. Returns whether it changed
 * anything. `seen` stops a variable that refers to itself.
 */
const resolveInFunctions = (
  nodes: Node[],
  insideFunction: boolean,
  lookup: (name: string) => string | undefined,
  seen: ReadonlySet<string>,
): boolean => {
  let changed = false;
  for (const node of nodes) {
    if (node.type !== 'function') {
      continue;
    }
    if (node.value.toLowerCase() !== 'var') {
      changed = resolveInFunctions(node.nodes, true, lookup, seen) || changed;
      continue;
    }
    const resolved = insideFunction
      ? resolveVariable(node, lookup, seen)
      : undefined;
    if (resolved === undefined) {
      // A fallback can hold functions with variables of its own.
      changed =
        resolveInFunctions(node.nodes, insideFunction, lookup, seen) || changed;
      continue;
    }
    Object.assign(node, { type: 'word', value: resolved });
    changed = true;
  }
  return changed;
};

/**
 * The value to put in place of one `var()`, resolved in turn.
 */
const resolveVariable = (
  node: FunctionNode,
  lookup: (name: string) => string | undefined,
  seen: ReadonlySet<string>,
): string | undefined => {
  const name = node.nodes[0]?.value ?? '';
  if (seen.has(name)) {
    return undefined;
  }
  const commaIndex = node.nodes.findIndex(
    (child) => child.type === 'div' && child.value === ',',
  );
  const fallback =
    commaIndex === -1
      ? undefined
      : valueParser.stringify(node.nodes.slice(commaIndex + 1)).trim();
  const value = lookup(name) ?? fallback;
  if (value === undefined) {
    return undefined;
  }
  // The value is in place of a function's argument now, so any `var()` in
  // it is inside a function too.
  const parsed = valueParser(value);
  resolveInFunctions(parsed.nodes, true, lookup, new Set([...seen, name]));
  return parsed.toString();
};

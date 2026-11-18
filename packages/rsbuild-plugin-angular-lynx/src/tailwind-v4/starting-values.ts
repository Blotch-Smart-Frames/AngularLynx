import type { Root, Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';

/**
 * The selectors that need each of Tailwind's variables set to its starting
 * value, and the variables each needs.
 */
export type StartingValueRule = {
  selectors: string[];
  variables: string[];
};

/**
 * Works out where Tailwind's variables need their starting values: on the
 * elements that read them, not on every element.
 *
 * Tailwind registers its variables (`--tw-translate-x`, `--tw-shadow`, …)
 * with `@property`, as not inherited, with an initial value, so every element
 * starts from that value rather than its parent's. Lynx has no `@property`,
 * and browsers without it get the same from Tailwind's own fallback, a
 * `*, ::before, ::after` rule that sets them all. Lynx would read that rule
 * the same way, but it costs every element of every screen: an element that
 * sets custom properties of its own has them all resolved, and checked for
 * cycles, when the tree is flushed. With Tailwind's two dozen, that was 18 µs
 * an element on an iPhone 14 Pro, 90 ms for a screen of 5,000 views, though
 * none of them used a utility that reads one.
 *
 * Only an element that one of the stylesheet's rules applies to reads them,
 * so the starting values go on those rules' elements. For each rule that
 * reads a variable without setting it, its subject (the element it styles)
 * gets the starting value (see subjectSelector), and the rules are grouped by
 * the variables they need, so a `border` gets only `--tw-border-style`.
 *
 * A keyframe that reads one has no element of its own to scope to: the
 * element it animates is in no selector here, so those variables keep the
 * starting value on every element (`*`), as before.
 */
export const startingValueRules = (
  root: Root,
  defaults: ReadonlyMap<string, string>,
): StartingValueRule[] => {
  const subjects = new Map<string, Set<string>>();
  const everywhere = new Set<string>();
  root.walkRules((rule) => {
    const read = readsWithoutSetting(rule, defaults);
    if (read.size === 0) {
      return;
    }
    const inKeyframes =
      rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name);
    if (inKeyframes) {
      for (const name of read) everywhere.add(name);
      return;
    }
    for (const selector of rule.selectors) {
      const subject = subjectSelector(selector);
      const variables = subjects.get(subject) ?? new Set<string>();
      for (const name of read) variables.add(name);
      subjects.set(subject, variables);
    }
  });
  if (everywhere.size > 0) {
    // A selector that also styles everything needs nothing of its own.
    for (const variables of subjects.values()) {
      for (const name of everywhere) variables.delete(name);
    }
  }
  // Grouped by the variables needed, in the order the defaults list them, so
  // the rules come out the same for the same stylesheet.
  const groups = new Map<string, StartingValueRule>();
  const inOrder = (names: Set<string>) =>
    [...defaults.keys()].filter((name) => names.has(name));
  if (everywhere.size > 0) {
    groups.set('*', { selectors: ['*'], variables: inOrder(everywhere) });
  }
  for (const [subject, names] of subjects) {
    const variables = inOrder(names);
    if (variables.length === 0) continue;
    const key = variables.join(',');
    const group = groups.get(key) ?? { selectors: [], variables };
    group.selectors.push(subject);
    groups.set(key, group);
  }
  return [...groups.values()];
};

/**
 * The variables with a starting value that a rule's declarations read and
 * the rule doesn't set itself (`space-y-2` sets `--tw-space-y-reverse` to 0
 * beside the margins that read it).
 */
const readsWithoutSetting = (
  rule: Rule,
  defaults: ReadonlyMap<string, string>,
): Set<string> => {
  const set = new Set<string>();
  const read = new Set<string>();
  rule.each((node) => {
    if (node.type !== 'decl') return;
    if (node.prop.startsWith('--')) set.add(node.prop);
    if (!node.value.includes('var(')) return;
    valueParser(node.value).walk((value) => {
      if (value.type !== 'function' || value.value.toLowerCase() !== 'var') {
        return;
      }
      const name = value.nodes[0];
      if (name?.type === 'word' && defaults.has(name.value)) {
        read.add(name.value);
      }
    });
  });
  for (const name of set) read.delete(name);
  return read;
};

/**
 * A selector for the element a selector styles (its last compound), as
 * specific as one class: the compound's own class, with its pseudo-element
 * if it has one. `.group:hover .group-hover\:scale-110` and
 * `.hover\:scale-110:hover` become `.group-hover\:scale-110` and
 * `.hover\:scale-110`.
 *
 * The starting values go before every utility, so a utility that sets a
 * variable wins over them by coming later, as long as it's at least as
 * specific. The whole selector could be more specific than that utility, and
 * win: `.hover\:scale-110:hover`'s starting `--tw-translate-x` would undo
 * `translate-x-2` on the same element. The element always has the class the
 * selector names, so the class alone reaches it whenever the selector can.
 *
 * A subject with no class of its own, such as the children
 * `.space-x-2 > * + *` styles, keeps the whole selector: it's one class
 * specific already.
 */
const subjectSelector = (selector: string): string => {
  let subject = selector;
  selectorParser((selectors) => {
    const nodes = selectors.first.nodes;
    let start = 0;
    nodes.forEach((node, index) => {
      if (node.type === 'combinator') start = index + 1;
    });
    const compound = nodes.slice(start);
    const classes = compound.filter((node) => node.type === 'class');
    // A variant's class names the utility (`hover:scale-110`); a state class
    // beside it (`.dark`) is on the element too, but on others as well.
    const own = classes.find((node) => node.value.includes(':')) ?? classes[0];
    if (!own) return;
    const pseudoElements = compound.filter(
      (node) => node.type === 'pseudo' && node.value.startsWith('::'),
    );
    subject = [own, ...pseudoElements]
      .map((node) => node.toString().trim())
      .join('');
  }).processSync(selector);
  return subject;
};

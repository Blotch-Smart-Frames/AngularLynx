import type { AtRule, ChildNode, Container, Root, Rule } from 'postcss';

/**
 * Unwraps the CSS structure Tailwind CSS 4 writes and Lynx can't read:
 * nesting, `@layer` blocks and `@property` registrations.
 */

/**
 * Moves nested rules and at-rules out to the top level, the way Sass does:
 * `.a { &:hover { … } }` becomes `.a:hover { … }`, and
 * `.a { @media (…) { … } }` becomes `@media (…) { .a { … } }`.
 *
 * Tailwind 4 writes its variants nested (`hover:`, `md:`, the `@supports`
 * fallback of an opacity modifier). Lynx's CSS parser reads a nested rule as
 * a descendant selector and never sees the `&`, and Lynx for Web throws on
 * it, so neither applies them. A production build already arrives flattened
 * (Tailwind minifies with Lightning CSS); a development build doesn't.
 */
export const flattenNesting = (root: Root): void => {
  root.each((node) => {
    flattenNode(node);
  });
};

const flattenNode = (node: ChildNode): void => {
  if (node.type === 'rule') {
    flattenRule(node);
  } else if (node.type === 'atrule' && node.nodes) {
    // A conditional rule's own rules may hold nesting too.
    node.each((child) => {
      flattenNode(child);
    });
  }
};

/**
 * Moves a rule's nested children out after it, in order, and returns the
 * last node it placed, so its parent places the next one after that.
 */
const flattenRule = (rule: Rule): ChildNode => {
  let last: ChildNode = rule;
  // A copy: the loop moves the children it visits out of the rule.
  for (const child of rule.nodes.slice()) {
    if (child.type === 'rule') {
      child.selectors = resolveNested(child.selectors, rule.selectors);
      last.after(child);
      last = flattenRule(child);
    } else if (child.type === 'atrule') {
      wrapDeclarations(child, rule);
      last.after(child);
      last = child;
      flattenNode(child);
    }
  }
  return last;
};

/**
 * Inside an at-rule nested in `rule`, puts the declarations under `rule`'s
 * selector and resolves the nested rules against it, so the at-rule can move
 * to the top level.
 */
const wrapDeclarations = (atRule: AtRule, rule: Rule): void => {
  if (!atRule.nodes) {
    return;
  }
  for (const child of atRule.nodes) {
    if (child.type === 'rule') {
      child.selectors = resolveNested(child.selectors, rule.selectors);
    } else if (child.type === 'atrule') {
      wrapDeclarations(child, rule);
    }
  }
  const declarations = atRule.nodes.filter((node) => node.type === 'decl');
  if (declarations.length > 0) {
    const wrapper = rule.clone();
    wrapper.removeAll();
    wrapper.append(declarations);
    atRule.prepend(wrapper);
  }
};

/**
 * Resolves nested selectors against their parent's: `&` stands for the
 * parent, and a selector without one is a descendant of it.
 */
const resolveNested = (selectors: string[], parents: string[]): string[] =>
  parents.flatMap((parent) =>
    selectors.map((selector) =>
      /(?<!\\)&/.test(selector)
        ? selector.replaceAll(/(?<!\\)&/g, parent)
        : `${parent} ${selector}`,
    ),
  );

/**
 * Replaces every `@layer` block with its contents and drops `@layer`
 * statements.
 *
 * Lynx ignores a rule inside `@layer`, on native and on the web, so none of
 * Tailwind 4's CSS would apply. Tailwind writes its layers in cascade order
 * (theme, base, components, utilities), so keeping the source order keeps
 * the cascade between them.
 */
export const unwrapLayers = (container: Container): void => {
  container.each((node) => {
    if (node.type !== 'atrule') {
      return;
    }
    if (node.name.toLowerCase() === 'layer') {
      if (node.nodes) {
        unwrapLayers(node);
        node.replaceWith(node.nodes);
      } else {
        node.remove();
      }
    } else if (node.nodes) {
      unwrapLayers(node);
    }
  });
};

/**
 * Removes the `@property` registrations and returns the custom properties
 * that have an initial value, with that value.
 *
 * Lynx has no `@property`, so a variable Tailwind registers with an initial
 * value (`--tw-border-style: solid`, `--tw-translate-x: 0`) is unset until a
 * utility sets it, and every value that reads it breaks: `border` draws no
 * border. A registration without an initial value is left out on purpose: the
 * variable stays unset, so the `var()` fallbacks Tailwind writes apply.
 */
export const takePropertyRegistrations = (root: Root): Map<string, string> => {
  const initialValues = new Map<string, string>();
  root.walkAtRules(/^property$/i, (atRule) => {
    atRule.walkDecls('initial-value', (declaration) => {
      initialValues.set(atRule.params.trim(), declaration.value);
    });
    atRule.remove();
  });
  // Tailwind's own fallback for browsers without `@property` sets every one
  // of them on `*, ::before, ::after, ::backdrop`, inside an `@supports` that
  // only those browsers pass. Its values include `initial`, which Lynx reads
  // as a value, not as "unset", so it's replaced by the rule built from the
  // registrations above.
  root.walkAtRules(/^supports$/i, (atRule) => {
    const rules = atRule.nodes?.filter((node) => node.type === 'rule') ?? [];
    if (
      rules.length > 0 &&
      rules.every((rule) => (rule as Rule).selector.includes('::backdrop'))
    ) {
      atRule.remove();
    }
  });
  return initialValues;
};

/**
 * Removes the rules and at-rules the steps above left empty, such as a
 * nested rule's parent that held only nested rules.
 */
export const removeEmptyContainers = (container: Container): void => {
  container.each((node) => {
    if (node.type !== 'rule' && node.type !== 'atrule') {
      return;
    }
    if (!node.nodes) {
      return;
    }
    removeEmptyContainers(node);
    if (node.nodes.every((child) => child.type === 'comment')) {
      node.remove();
    }
  });
};

/**
 * The values an implied first or last keyframe takes for the properties
 * Tailwind's own animations change. Their initial values stand in for the
 * element's own, which CSS would use.
 */
const IMPLIED_KEYFRAME_VALUES: Record<string, string> = {
  transform: 'none',
  opacity: '1',
};

/**
 * Writes out the `from` and `to` keyframes an animation leaves implied.
 *
 * Lynx doesn't play an animation that lacks either, and Tailwind's `spin`
 * has only `to`, `ping` no `from`, and `pulse` neither, so `animate-spin`
 * did nothing on device.
 */
export const completeKeyframes = (root: Root): void => {
  root.walkAtRules(/^(?:-webkit-)?keyframes$/i, (atRule) => {
    const offsets = new Set<string>();
    const properties = new Set<string>();
    atRule.walkRules((rule) => {
      for (const selector of rule.selectors) {
        offsets.add(
          { from: '0%', to: '100%' }[selector.toLowerCase()] ?? selector,
        );
      }
      rule.walkDecls(({ prop }) => {
        if (prop in IMPLIED_KEYFRAME_VALUES) {
          properties.add(prop);
        }
      });
    });
    const first = atRule.first;
    if (properties.size === 0 || first?.type !== 'rule') {
      return;
    }
    for (const [offset, selector] of [
      ['0%', 'from'],
      ['100%', 'to'],
    ] as const) {
      if (offsets.has(offset)) {
        continue;
      }
      const keyframe = first.clone({ selector });
      keyframe.removeAll();
      for (const prop of properties) {
        keyframe.append({ prop, value: IMPLIED_KEYFRAME_VALUES[prop]! });
      }
      if (selector === 'from') {
        atRule.prepend(keyframe);
      } else {
        atRule.append(keyframe);
      }
    }
  });
};

import { clsx, type ClassValue } from 'clsx';
import {
  createTailwindMerge,
  getDefaultConfig,
  twMerge,
  type Config,
  type DefaultClassGroupIds,
  type DefaultThemeGroupIds,
} from 'tailwind-merge';

type DefaultConfig = Config<DefaultClassGroupIds, DefaultThemeGroupIds>;
type ClassDefinitions = DefaultConfig['classGroups'][DefaultClassGroupIds];

/**
 * The first part of every Tailwind class the `@blotch/ui` components use
 * (`bg` for `bg-card`, `px` for `px-4`), which is also where tailwind-merge's
 * class map branches first.
 *
 * tailwind-merge builds its whole class map on its first call: every one of
 * Tailwind's ~380 utility groups, about 1 MB of PrimJS heap on the main
 * thread (#709). `cn()` builds the map of only the groups with a class under
 * these parts instead, about half of it, and the merge comes out the same
 * as `twMerge()`'s for any class that starts with one of them (see
 * `createComponentConfig`). The first class from another of tailwind-merge's
 * groups, such as `cursor-pointer`, switches `cn()` to the full `twMerge()`
 * for good, so it still merges every class correctly: only an app that uses
 * one pays for the full map.
 *
 * `cn.test.ts` fails when a component uses a class under a part this lacks.
 * The parts after the components' own are for classes an app often passes
 * to a component's `class` input, such as `mr-2` or `italic`, which would
 * otherwise load the full map at the first screen: they cost about a tenth
 * of the component map.
 */
const COMPONENT_CLASS_ROOTS: ReadonlySet<string> = new Set([
  'absolute',
  'accent',
  'backdrop',
  'bg',
  'blur',
  'border',
  'bottom',
  'columns',
  'container',
  'fill',
  'filter',
  'fixed',
  'flex',
  'font',
  'gap',
  'grow',
  'h',
  'hidden',
  'inline',
  'inset',
  'items',
  'justify',
  'leading',
  'left',
  'm',
  'max',
  'mb',
  'min',
  'ml',
  'mt',
  'mx',
  'my',
  'opacity',
  'outline',
  'overflow',
  'p',
  'pb',
  'pl',
  'pr',
  'pt',
  'px',
  'py',
  'relative',
  'right',
  'ring',
  'rounded',
  'self',
  'shadow',
  'shrink',
  'stroke',
  'text',
  'top',
  'tracking',
  'transform',
  'transition',
  'visible',
  'w',
  'z',
  // Classes apps pass: the margins and paddings the components don't use,
  // sizes, spacing between children, and text styles.
  'capitalize',
  'italic',
  'line',
  'lowercase',
  'mbe',
  'mbs',
  'me',
  'mr',
  'ms',
  'no',
  'normal',
  'not',
  'overline',
  'pbe',
  'pbs',
  'pe',
  'ps',
  'size',
  'space',
  'truncate',
  'underline',
  'uppercase',
]);

/**
 * Stands for a function at the top of a group's definitions. A validator
 * there is tried on every class that no branch of the map matched, so a group
 * with one has to be in every map. tailwind-merge's config has one such
 * group, `container-named` (`@container/main`).
 */
const ANY_ROOT = Symbol('any root');

/**
 * The part of a class name that tailwind-merge's class map branches on
 * first, as its `getClassGroupId` splits it: up to the first `-`, after the
 * `-` of a negative value (`-inset-1`). An arbitrary property
 * (`[mask-type:luminance]`) has no part, because tailwind-merge doesn't look
 * it up in the map.
 */
const classRoot = (className: string): string | undefined => {
  if (className.startsWith('[') && className.endsWith(']')) {
    return undefined;
  }
  const start = className.startsWith('-') && className.length > 1 ? 1 : 0;
  const end = className.indexOf('-', start);
  return className.slice(start, end === -1 ? undefined : end);
};

/**
 * Adds the first parts of the classes a group's definitions describe, as
 * tailwind-merge's `createClassMap` reads them: a string is a class, and an
 * object's keys are the start of its classes.
 */
const addRoots = (
  definitions: ClassDefinitions,
  roots: Set<string | typeof ANY_ROOT>,
): void => {
  for (const definition of definitions) {
    if (typeof definition === 'string') {
      roots.add(definition.split('-', 1)[0]);
    } else if (typeof definition === 'function') {
      // A validator, or a theme getter, whose values could be validators.
      roots.add(ANY_ROOT);
    } else {
      for (const key of Object.keys(definition)) {
        roots.add(key.split('-', 1)[0]);
      }
    }
  }
};

/**
 * tailwind-merge's default config, keeping only the groups with a class
 * starting with one of `COMPONENT_CLASS_ROOTS` (and those with a validator at
 * the top). Every group with a class under such a part is kept, so the map
 * below it is the full map's, and tailwind-merge finds the same group for any
 * class starting with one of them as `twMerge()` does.
 *
 * A class starting with another part that some group has would be looked up
 * in a branch this map lacks, or has only some of, so the config's parser
 * calls `onForeignClass` when it parses one.
 */
const createComponentConfig = (onForeignClass: () => void): DefaultConfig => {
  const config: DefaultConfig = getDefaultConfig();
  const classGroups: Partial<DefaultConfig['classGroups']> = {};
  const conflictingClassGroups: DefaultConfig['conflictingClassGroups'] = {};
  const conflictingClassGroupModifiers: DefaultConfig['conflictingClassGroupModifiers'] =
    {};
  // The first parts some group has under it that this map doesn't have all
  // of. A Set of a hundred short strings, against the thousands of objects
  // the left-out groups' branches take.
  const foreignRoots = new Set<string>();
  for (const id of Object.keys(config.classGroups) as DefaultClassGroupIds[]) {
    const roots = new Set<string | typeof ANY_ROOT>();
    addRoots(config.classGroups[id], roots);
    let kept = false;
    for (const root of roots) {
      if (root === ANY_ROOT || COMPONENT_CLASS_ROOTS.has(root)) {
        kept = true;
      } else {
        foreignRoots.add(root);
      }
    }
    if (kept) {
      classGroups[id] = config.classGroups[id];
      // Only a kept group's conflicts are ever looked up: every class this
      // map finds a group for is in one.
      const conflicts = config.conflictingClassGroups[id];
      if (conflicts) {
        conflictingClassGroups[id] = conflicts;
      }
      const modifierConflicts = config.conflictingClassGroupModifiers[id];
      if (modifierConflicts) {
        conflictingClassGroupModifiers[id] = modifierConflicts;
      }
    }
  }
  const checkRoot = (className: string): void => {
    const root = classRoot(className);
    if (root !== undefined && foreignRoots.has(root)) {
      onForeignClass();
    }
  };
  return {
    ...config,
    classGroups: classGroups as DefaultConfig['classGroups'],
    conflictingClassGroups,
    conflictingClassGroupModifiers,
    // tailwind-merge parses every class of a list it hasn't cached, before
    // looking it up, so this sees each class the component map is asked
    // about. It checks the names tailwind-merge's merge looks up: the class
    // without its variants, and also without a postfix such as `/50`.
    experimentalParseClassName: ({ className, parseClassName }) => {
      const parsed = parseClassName(className);
      checkRoot(parsed.baseClassName);
      if (parsed.maybePostfixModifierPosition !== undefined) {
        checkRoot(
          parsed.baseClassName.substring(
            0,
            parsed.maybePostfixModifierPosition,
          ),
        );
      }
      return parsed;
    },
  };
};

/**
 * Makes a `cn()` with a map of its own. Apps use `cn`; this is for tests,
 * which need one that hasn't seen another test's classes, and which pass
 * a spy as `fullMerge` to see whether it had to load the full map.
 */
export const createCn = (
  fullMerge: (classList: string) => string = twMerge,
): ((...inputs: ClassValue[]) => string) => {
  let sawForeignClass = false;
  let componentMerge: ((classList: string) => string) | undefined =
    createTailwindMerge(() =>
      createComponentConfig(() => {
        sawForeignClass = true;
      }),
    );
  return (...inputs) => {
    const classList = clsx(inputs);
    if (componentMerge) {
      const merged = componentMerge(classList);
      if (!sawForeignClass) {
        return merged;
      }
      // The component map may have found the wrong group for a class in
      // this list, or none, so merge it again with the full map, as every
      // list from now on. Dropping the component map lets it be collected.
      componentMerge = undefined;
    }
    return fullMerge(classList);
  };
};

/**
 * Joins class names as `clsx()` does, then merges the Tailwind classes in
 * them as tailwind-merge's `twMerge()` does: of two conflicting classes, the
 * later one wins.
 */
export const cn = createCn();

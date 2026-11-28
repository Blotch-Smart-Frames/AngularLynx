import {
  validators,
  type Config,
  type DefaultClassGroupIds,
  type DefaultThemeGroupIds,
} from 'tailwind-merge';

/**
 * Writes `cn-config.ts`, the tailwind-merge config `cn()` merges with. Only
 * the generate script (`npm run generate:cn-config -w @blotch/dolan`) and
 * the tests import this: apps import `cn()`, which imports the generated
 * file, so tailwind-merge's `getDefaultConfig()` stays out of their bundles.
 *
 * Why a generated file: tailwind-merge's whole default config is one
 * function, `getDefaultConfig()`, about 24 kB of the 29 kB the package adds
 * to an app's main-thread script, and PrimJS keeps the bytecode of every
 * function a script holds, run or not (#707, #945). Pruning that config at
 * run time, as `cn()` did for #709, saves the heap of the map it builds but
 * keeps all the code. The generated file holds only the groups below.
 */

type DefaultConfig = Config<DefaultClassGroupIds, DefaultThemeGroupIds>;
type ClassDefinition =
  DefaultConfig['classGroups'][DefaultClassGroupIds][number];

/**
 * The first part of every Tailwind class the `@blotch/ui` components use
 * (`bg` for `bg-card`, `px` for `px-4`), which is also where tailwind-merge's
 * class map branches first.
 *
 * `cn()` knows the groups with a class under these parts, about half of
 * tailwind-merge's ~380, and merges any class under one of them exactly as
 * `twMerge()` does. A class of another group, such as `cursor-pointer`, isn't
 * merged: it stays in the list whatever comes after it, as any class
 * tailwind-merge doesn't know does.
 *
 * `cn.test.ts` fails when a component uses a class under a part this lacks.
 * The parts after the components' own are for classes an app often passes
 * to a component's `class` input, such as `mr-2` or `italic`, so that two of
 * them in one input still merge.
 */
export const COMPONENT_CLASS_ROOTS: ReadonlySet<string> = new Set([
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
 * The first parts of the classes a group's definitions describe, as
 * tailwind-merge's `createClassMap` reads them: a string is a class, and an
 * object's keys are the start of its classes.
 */
const groupRoots = (
  definitions: readonly ClassDefinition[],
): Set<string | typeof ANY_ROOT> => {
  const roots = new Set<string | typeof ANY_ROOT>();
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
  return roots;
};

/**
 * The groups `cn()` keeps: each with a class under one of `roots` (or a
 * validator at its top), and then every group that shares a first part with
 * a kept group or conflicts with one, until none is left to add.
 *
 * Sharing a first part: tailwind-merge looks a class up from its first part
 * down. A kept group's branch that was missing another group's classes
 * could match one of them to the wrong group, through a validator lower in
 * the branch. With the whole branch, every class under a kept part finds the
 * group `twMerge()` finds, and a class under any other part finds none.
 *
 * Conflicting: a group that a kept group's class removes, or that removes
 * one (either side of `conflictingClassGroups` or its modifier twin), is
 * kept, so a class an app passes still replaces a component's conflicting
 * class as it did with the full map.
 */
export const keptClassGroups = (
  config: DefaultConfig,
  roots: ReadonlySet<string> = COMPONENT_CLASS_ROOTS,
): Set<DefaultClassGroupIds> => {
  const ids = Object.keys(config.classGroups) as DefaultClassGroupIds[];
  const rootsOf = new Map(
    ids.map((id) => [id, groupRoots(config.classGroups[id])]),
  );
  const conflicts = (a: DefaultClassGroupIds, b: DefaultClassGroupIds) =>
    [config.conflictingClassGroups, config.conflictingClassGroupModifiers].some(
      (map) => map[a]?.includes(b) || map[b]?.includes(a),
    );
  const kept = new Set(
    ids.filter((id) =>
      [...rootsOf.get(id)!].some(
        (root) => root === ANY_ROOT || roots.has(root),
      ),
    ),
  );
  for (let added = true; added;) {
    added = false;
    const keptRoots = new Set([...kept].flatMap((id) => [...rootsOf.get(id)!]));
    for (const id of ids) {
      if (
        !kept.has(id) &&
        ([...rootsOf.get(id)!].some((root) => keptRoots.has(root)) ||
          [...kept].some((keptId) => conflicts(keptId, id)))
      ) {
        kept.add(id);
        added = true;
      }
    }
  }
  return kept;
};

/**
 * tailwind-merge's `config` with only the kept groups, their conflicts, and
 * the theme scales they read.
 */
export const componentConfig = (
  config: DefaultConfig,
  roots: ReadonlySet<string> = COMPONENT_CLASS_ROOTS,
): Config<string, string> => {
  const kept: ReadonlySet<string> = keptClassGroups(config, roots);
  /**
   * A kept group's conflicts are all kept (see keptClassGroups), so only
   * the left-out groups' entries go.
   */
  const keptOnly = <T>(map: Partial<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(map).filter(([id]) => kept.has(id)) as [string, T][],
    );
  const classGroups = Object.fromEntries(
    Object.entries(config.classGroups).filter(([id]) => kept.has(id)),
  );
  const themeKeys = new Set<string>();
  const findThemeKeys = (value: unknown): void => {
    if (typeof value === 'function') {
      if ('themeKey' in value) {
        themeKeys.add(value.themeKey as string);
      }
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(findThemeKeys);
    }
  };
  findThemeKeys(classGroups);
  return {
    ...config,
    theme: Object.fromEntries(
      Object.entries(config.theme).filter(([key]) => themeKeys.has(key)),
    ),
    classGroups,
    conflictingClassGroups: keptOnly(config.conflictingClassGroups),
    conflictingClassGroupModifiers: keptOnly(
      config.conflictingClassGroupModifiers,
    ),
    postfixLookupClassGroups: config.postfixLookupClassGroups?.filter((id) =>
      kept.has(id),
    ),
  };
};

/** tailwind-merge's validators, by the function. */
const validatorNames = new Map<unknown, string>(
  Object.entries(validators).map(([name, validator]) => [validator, name]),
);

/**
 * The variable a theme getter is written as: `themeFontWeight`.
 */
const themeVariable = (key: string): string =>
  `theme${key.replace(/(^|-)(\w)/g, (_, _dash, letter: string) => letter.toUpperCase())}`;

/**
 * Writes a config as a value in JavaScript, and says so for anything it
 * can't write: a function that is neither one of tailwind-merge's
 * validators nor a theme getter.
 */
const valueWriter = () => {
  const validatorsUsed = new Set<string>();
  const themeKeys = new Set<string>();
  const write = (value: unknown): string => {
    if (typeof value === 'function') {
      if ('isThemeGetter' in value && 'themeKey' in value) {
        themeKeys.add(value.themeKey as string);
        return themeVariable(value.themeKey as string);
      }
      const name = validatorNames.get(value);
      if (!name) {
        throw new Error(
          `cn-config: a function tailwind-merge's config holds isn't one of its validators: ${value.name}`,
        );
      }
      validatorsUsed.add(name);
      return name;
    }
    if (Array.isArray(value)) {
      return `[${value.map(write).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .map(([key, entry]) => `${JSON.stringify(key)}: ${write(entry)}`)
        .join(', ')}}`;
    }
    return JSON.stringify(value);
  };
  return { write, validatorsUsed, themeKeys };
};

/**
 * Writes a list or object that appears more than once in the class groups
 * as a variable of its own, the way tailwind-merge's own config writes its
 * scales: inlined, its copies would make the config about 40% larger.
 */
const sharedValues = (classGroups: object) => {
  const { write } = valueWriter();
  const counts = new Map<string, number>();
  const count = (value: unknown): void => {
    if (value && typeof value === 'object') {
      const text = write(value);
      counts.set(text, (counts.get(text) ?? 0) + 1);
      Object.values(value).forEach(count);
    }
  };
  Object.values(classGroups).forEach((definitions: unknown[]) =>
    definitions.forEach(count),
  );
  return counts;
};

/**
 * The source of `cn-config.ts` for a config, before formatting.
 */
export const cnConfigSource = (
  config: Config<string, string>,
  version: string,
): string => {
  const counts = sharedValues(config.classGroups);
  const { write, validatorsUsed, themeKeys } = valueWriter();
  const shared = new Map<string, { name: string; source: string }>();
  /**
   * Each group's definitions, with the lists and objects used more than once
   * (and long enough to be worth a name) replaced by a variable. A shared
   * value's own parts are named first, so each variable is declared after
   * the ones it uses.
   */
  const writeShared = (value: unknown, top = false): string => {
    if (!value || typeof value !== 'object') {
      return write(value);
    }
    const text = write(value);
    // Every list and object in the class groups was counted.
    if (!top && counts.get(text)! > 1 && text.length > 8) {
      let entry = shared.get(text);
      if (!entry) {
        const source = writeShared(value, true);
        entry = { name: `scale${shared.size}`, source };
        shared.set(text, entry);
      }
      return entry.name;
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => writeShared(item)).join(', ')}]`;
    }
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${writeShared(entry)}`)
      .join(', ')}}`;
  };
  const classGroups = `{${Object.entries(config.classGroups)
    .map(
      ([id, definitions]) =>
        `${JSON.stringify(id)}: ${writeShared(definitions, true)}`,
    )
    .join(', ')}}`;
  // In the config's own order, so the generated config describes the same.
  const body = Object.entries(config)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${key}: ${key === 'classGroups' ? classGroups : write(value)}`,
    );
  return `// Generated from tailwind-merge ${version} by
// packages/dolan/scripts/generate-cn-config.ts: run
// \`npm run generate:cn-config -w @blotch/dolan\` rather than editing it.
// It's tailwind-merge's default config with only the class groups the
// @blotch/ui components use (see COMPONENT_CLASS_ROOTS in
// packages/dolan/src/utils/cn-config-source.ts, and #945).
import { fromTheme, validators, type Config } from 'tailwind-merge';

const { ${[...validatorsUsed].sort().join(', ')} } = validators;

/**
 * The tailwind-merge config \`cn()\` merges with. A function, as
 * tailwind-merge's \`getDefaultConfig()\` is, so its lists are made on the
 * first merge, not when the script loads.
 */
export const createComponentConfig = (): Config<string, string> => {
${[...themeKeys]
  .sort()
  .map(
    (key) => `const ${themeVariable(key)} = fromTheme(${JSON.stringify(key)});`,
  )
  .join('\n')}
${[...shared.values()].map(({ name, source }) => `const ${name} = ${source};`).join('\n')}
return {${body.join(', ')}};
};
`;
};

/**
 * Writes a config so that two equal configs read the same: functions as the
 * validator or theme key they are. The tests compare the generated config
 * with the one this module makes from tailwind-merge's.
 */
export const describeConfig = (config: Config<string, string>): string =>
  valueWriter().write(config);

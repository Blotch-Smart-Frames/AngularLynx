import {
  fromTheme,
  getDefaultConfig,
  validators,
  type Config,
} from 'tailwind-merge';
import { describe, expect, it } from 'vitest';

import { createComponentConfig } from './cn-config';
import {
  COMPONENT_CLASS_ROOTS,
  cnConfigSource,
  componentConfig,
  describeConfig,
  keptClassGroups,
} from './cn-config-source';

/**
 * A config of only the parts a test sets.
 */
const configOf = (config: Partial<Config<string, string>>) =>
  ({
    cacheSize: 0,
    theme: {},
    classGroups: {},
    conflictingClassGroups: {},
    conflictingClassGroupModifiers: {},
    orderSensitiveModifiers: [],
    ...config,
  }) as unknown as Parameters<typeof componentConfig>[0];

describe('cn-config.ts', () => {
  it("is tailwind-merge's config with the components' groups", () => {
    // If this fails, tailwind-merge's config changed (an update) or
    // COMPONENT_CLASS_ROOTS did: run
    // `npm run generate:cn-config -w @blotch/dolan`.
    expect(describeConfig(createComponentConfig())).toBe(
      describeConfig(componentConfig(getDefaultConfig())),
    );
  });

  it('leaves out about half of the groups', () => {
    const groups = Object.keys(createComponentConfig().classGroups).length;
    const all = Object.keys(getDefaultConfig().classGroups).length;
    expect(groups).toBeGreaterThan(all / 3);
    expect(groups).toBeLessThan((all * 2) / 3);
  });
});

describe('keptClassGroups', () => {
  const config = getDefaultConfig();
  const kept = keptClassGroups(config);
  const left = (
    Object.keys(config.classGroups) as (keyof typeof config.classGroups)[]
  ).filter((id) => !kept.has(id));

  it('keeps no first part that a left-out group has classes under', () => {
    /**
     * A class under such a part could find the wrong group in a branch the
     * config had only some of.
     */
    const firstParts = (id: keyof typeof config.classGroups) =>
      config.classGroups[id].flatMap((definition) =>
        typeof definition === 'string'
          ? [definition.split('-', 1)[0]]
          : typeof definition === 'object'
            ? Object.keys(definition).map((key) => key.split('-', 1)[0])
            : [],
      );
    const keptParts = new Set([...kept].flatMap(firstParts));
    for (const id of left) {
      expect(firstParts(id).filter((part) => keptParts.has(part))).toEqual([]);
    }
  });

  it('keeps every group that conflicts with a kept one, either way', () => {
    for (const map of [
      config.conflictingClassGroups,
      config.conflictingClassGroupModifiers,
    ]) {
      for (const [id, others] of Object.entries(map) as [
        keyof typeof config.classGroups,
        (keyof typeof config.classGroups)[],
      ][]) {
        for (const other of others) {
          expect(kept.has(id)).toBe(kept.has(other));
        }
      }
    }
  });

  it('keeps the groups with a class under a component part, and those they need', () => {
    expect(kept.has('bg-color')).toBe(true);
    // `block` is `display`'s (kept for `hidden`) and `block-size`'s.
    expect(kept.has('block-size')).toBe(true);
    // `container-named` has a validator at its top.
    expect(kept.has('container-named')).toBe(true);
    expect(kept.has('cursor')).toBe(false);
    expect(kept.has('rotate')).toBe(false);
    expect(COMPONENT_CLASS_ROOTS.has('cursor')).toBe(false);
  });

  it('adds a group that conflicts with a kept one, and what that group shares', () => {
    const small = configOf({
      classGroups: { a: ['a-1'], b: ['b-1'], c: ['b-2', 'c-1'], d: ['d-1'] },
      conflictingClassGroups: { b: ['a'] },
    });
    expect([...keptClassGroups(small, new Set(['a']))].sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('adds a group on the modifier side of a conflict', () => {
    const small = configOf({
      classGroups: { a: ['a-1'], b: ['b-1'] },
      conflictingClassGroupModifiers: { a: ['b'] },
    });
    expect([...keptClassGroups(small, new Set(['a']))].sort()).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('componentConfig', () => {
  it('keeps only the conflicts and theme scales of the kept groups', () => {
    const small = configOf({
      theme: { spacing: ['px'], color: ['red'] },
      classGroups: {
        p: [{ p: [fromTheme('spacing'), validators.isNumber] }],
        cursor: [{ cursor: [fromTheme('color')] }],
      },
      conflictingClassGroups: { p: ['p'], cursor: ['cursor'] },
      conflictingClassGroupModifiers: { cursor: ['cursor'] },
      postfixLookupClassGroups: ['p', 'cursor'],
    });
    const config = componentConfig(small, new Set(['p']));
    expect(Object.keys(config.classGroups)).toEqual(['p']);
    expect(config.theme).toEqual({ spacing: ['px'] });
    expect(config.conflictingClassGroups).toEqual({ p: ['p'] });
    expect(config.conflictingClassGroupModifiers).toEqual({});
    expect(config.postfixLookupClassGroups).toEqual(['p']);
  });

  it('copes with a config without postfix lookups', () => {
    const config = componentConfig(configOf({}), new Set());
    expect(config.postfixLookupClassGroups).toBeUndefined();
  });
});

describe('cnConfigSource', () => {
  it('writes theme getters, validators and shared lists as variables', () => {
    const shared = ['auto', validators.isNumber];
    const source = cnConfigSource(
      configOf({
        cacheSize: 500,
        theme: { 'font-weight': ['bold'] },
        classGroups: {
          a: [{ a: shared }],
          b: [{ b: shared }, 'b-x'],
          c: [{ c: [fromTheme('font-weight'), ''] }],
        },
        experimentalParseClassName: undefined,
      }),
      '1.2.3',
    );
    expect(source).toContain('Generated from tailwind-merge 1.2.3');
    expect(source).toContain('const { isNumber } = validators;');
    expect(source).toContain(
      `const themeFontWeight = fromTheme("font-weight");`,
    );
    expect(source).toContain(`const scale0 = ["auto", isNumber];`);
    expect(source).toContain(`"a": [{"a": scale0}]`);
    expect(source).toContain(`"c": [{"c": [themeFontWeight, ""]}]`);
    expect(source).toContain('cacheSize: 500');
    expect(source).not.toContain('experimentalParseClassName');
  });

  it("refuses a function that isn't one of tailwind-merge's validators", () => {
    const custom = (value: string) => value === 'x';
    expect(() =>
      cnConfigSource(configOf({ classGroups: { a: [{ a: [custom] }] } }), '1'),
    ).toThrow(/isn't one of its validators: custom/);
  });
});

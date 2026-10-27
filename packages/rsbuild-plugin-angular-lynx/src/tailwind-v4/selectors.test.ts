import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

import { lowerSelectors } from './selectors';

/**
 * Lowers the selectors of a rule, returning it or `false` if it's gone.
 */
const lower = (css: string): Rule | false => {
  const rule = postcss.parse(css).first as Rule;
  return lowerSelectors(rule) && rule;
};

const declarations = (rule: Rule | false) =>
  rule ? rule.nodes.map((node) => node.toString()) : [];

describe('lowerSelectors', () => {
  it('drops :host from the selector list of the theme', () => {
    expect((lower(':root, :host { --x: 1; }') as Rule).selector).toBe(':root');
    expect(lower(':host { --x: 1; }')).toBe(false);
    expect((lower('.a\\:host { --x: 1; }') as Rule).selector).toBe('.a\\:host');
  });

  it('unwraps a selector that is a single :where() or :is()', () => {
    expect(
      (lower(':is(.\\*\\:p-2 > *) { padding: 1px; }') as Rule).selector,
    ).toBe('.\\*\\:p-2 > *');
    expect(
      (lower(':where(.a, :is(.b)) { padding: 1px; }') as Rule).selectors,
    ).toEqual(['.a', '.b']);
    expect((lower(':where(.a\\)b) { padding: 1px; }') as Rule).selector).toBe(
      '.a\\)b',
    );
  });

  it('leaves a :where() or :is() inside a longer selector', () => {
    for (const selector of [
      '.group-hover\\:x:is(:where(.group):hover *)',
      ':where(.a) .b',
      // Unbalanced, which PostCSS wouldn't parse, but a rule can hold.
      ':is(.a',
    ]) {
      const rule = postcss.rule({ selector });
      rule.append({ prop: 'color', value: 'red' });
      expect(lowerSelectors(rule)).toBe(true);
      expect(rule.selector).toBe(selector);
    }
  });

  it("turns space-y's every-child-but-the-last into every-child-but-the-first", () => {
    const rule = lower(
      ':where(.space-y-2 > :not(:last-child)) { --tw-space-y-reverse: 0; margin-block-start: calc(2px * var(--tw-space-y-reverse)); margin-block-end: calc(2px * calc(1 - var(--tw-space-y-reverse))); }',
    );
    expect((rule as Rule).selector).toBe('.space-y-2 > * + *');
    expect(declarations(rule)).toEqual([
      '--tw-space-y-reverse: 0',
      'margin-block-end: calc(2px * var(--tw-space-y-reverse))',
      'margin-block-start: calc(2px * calc(1 - var(--tw-space-y-reverse)))',
    ]);
  });

  it('moves divide borders to the opposite side, physical or logical', () => {
    const rule = lower(
      ':where(.divide-y > :not(:last-child)) { border-top-width: 0px; border-bottom-width: 1px; border-inline-start-width: 2px; border-right-style: solid; border-left-color: red; }',
    );
    expect(declarations(rule)).toEqual([
      'border-bottom-width: 0px',
      'border-top-width: 1px',
      'border-inline-end-width: 2px',
      'border-left-style: solid',
      'border-right-color: red',
    ]);
  });

  it("leaves :not(:last-child) when the rule sets anything but the box's sides", () => {
    const rule = lower(
      '.a > :not(:last-child) { color: red; margin-top: 1px; }',
    );
    expect((rule as Rule).selector).toBe('.a > :not(:last-child)');
    expect(declarations(rule)).toEqual(['color: red', 'margin-top: 1px']);
  });

  it('leaves :not(:last-child) unless every selector in the list ends with it', () => {
    expect(
      (lower('.a > :not(:last-child), .b { margin-top: 1px; }') as Rule)
        .selector,
    ).toBe('.a > :not(:last-child), .b');
  });

  it('skips comments when deciding', () => {
    expect(
      (lower('.a > :not(:last-child) { /* gap */ margin-top: 1px; }') as Rule)
        .selector,
    ).toBe('.a > * + *');
  });
});

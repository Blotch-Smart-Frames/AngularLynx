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

  it('inlines a :where() or :is() that holds one compound selector', () => {
    // What Tailwind writes for `group-*`, `peer-*` and `in-*` over a custom
    // variant such as the `ui-open` of @blotch/angular-lynx/tailwind.css.
    const cases: [string, string][] = [
      [
        ':is(:where(.group).ui-open .group-ui-open\\:flex)',
        '.group.ui-open .group-ui-open\\:flex',
      ],
      [
        ':is(:where(.group\\/menu).ui-open .group-ui-open\\/menu\\:flex)',
        '.group\\/menu.ui-open .group-ui-open\\/menu\\:flex',
      ],
      [
        ':is(:where(.peer).ui-checked ~ .peer-ui-checked\\:hidden)',
        '.peer.ui-checked ~ .peer-ui-checked\\:hidden',
      ],
      // An arbitrary group variant, with an :is() of its own.
      [
        ':is(:where(.group):is(.is-open) .group-\\[\\.is-open\\]\\:flex)',
        '.group.is-open .group-\\[\\.is-open\\]\\:flex',
      ],
      [':where(.ui-open) .in-ui-open\\:flex', '.ui-open .in-ui-open\\:flex'],
      // A type selector can go first in its compound.
      [':where(view).a > :is(*)', 'view.a > *'],
      ['.a\\+ + :is(view)', '.a\\+ + view'],
      // A no-break space is part of a name, so this is one compound.
      ['.a:is(.b\u00a0.c)', '.a.b\u00a0.c'],
      // Nor is one at the end of a name trimmed away.
      ['.a:is(.b\u00a0.c\u00a0) .x', '.a.b\u00a0.c\u00a0 .x'],
      ['.a:not(:where(.b))', '.a:not(.b)'],
    ];
    for (const [selector, lowered] of cases) {
      expect((lower(`${selector} { color: red; }`) as Rule).selector).toBe(
        lowered,
      );
    }
  });

  it('leaves a :where() or :is() it cannot inline', () => {
    for (const selector of [
      // A complex selector, a list, and a type selector after a class.
      '.group-hover\\:x:is(.group:hover *)',
      '.ltr\\:x:where(:dir(ltr), [dir="ltr"])',
      '.a:is(view)',
      // The `+` is part of the class name, not a combinator.
      '.a\\+:is(view) .x',
      // The space ends the `\\31` escape, so it can't be trimmed away.
      '.a:is(.b\\31 ) .x',
      // Nor can one be written after it.
      '.a:is(.b\\31) .x',
      // A no-break space is part of a name too: CSS whitespace is only
      // space, tab, newline, form feed and carriage return.
      '.a\u00a0:is(view) .x',
      // An escaped colon is part of a class name.
      '.a\\:where\\(b\\)',
      // Unbalanced, which PostCSS wouldn't parse, but a rule can hold.
      ':is(.a',
      '.b:is(.a',
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

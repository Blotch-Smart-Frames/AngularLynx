import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { resolveNestedVariables } from './variables';

/**
 * Resolves the nested variables of `css` and returns its declarations.
 */
const resolve = (css: string, registrations = new Map<string, string>()) => {
  const root = postcss.parse(css);
  resolveNestedVariables(root, registrations);
  const declarations: string[] = [];
  root.walkDecls((declaration) => {
    declarations.push(declaration.toString());
  });
  return declarations;
};

describe('resolveNestedVariables', () => {
  it('resolves a theme variable inside a function, and folds the result', () => {
    expect(
      resolve(
        ':root { --spacing: 0.25rem; --blur-sm: 8px; } .a { --tw-translate-x: calc(var(--spacing) * 2); --tw-blur: blur(var(--blur-sm)); }',
      ),
    ).toEqual([
      '--spacing: 0.25rem',
      '--blur-sm: 8px',
      '--tw-translate-x: 0.5rem',
      '--tw-blur: blur(8px)',
    ]);
  });

  it("prefers the rule's own value, then the theme, then the fallback, then the registered value", () => {
    expect(
      resolve(
        ':root, .x { --theme: 2px; } .a { --own: 1px; --b: calc(var(--own) + var(--theme) + var(--none, 3px) + var(--registered)); }',
        new Map([['--registered', '4px']]),
      ),
    ).toEqual(['--theme: 2px', '--own: 1px', '--b: 10px']);
  });

  it('resolves variables inside the value it puts in', () => {
    expect(
      resolve(
        ':root { --a: calc(var(--b) * 2); --b: 3px; } .x { --c: blur(var(--a)); }',
      ),
    ).toContain('--c: blur(6px)');
  });

  it('resolves a variable inside a function inside a fallback', () => {
    expect(
      resolve(':root { --s: 4px; } .x { --c: var(--none, blur(var(--s))); }'),
    ).toContain('--c: var(--none, blur(4px))');
  });

  it("leaves a variable Lynx resolves, or one it can't", () => {
    expect(
      resolve(
        ':root { --color: red; } .x { --a: var(--color); --b: var(--color, blue) 0 0; --c: blur(var(--unknown)); --d: 1px; color: calc(var(--color)); --e: blur(var()); }',
      ),
    ).toEqual([
      '--color: red',
      '--a: var(--color)',
      '--b: var(--color, blue) 0 0',
      '--c: blur(var(--unknown))',
      '--d: 1px',
      'color: calc(var(--color))',
      '--e: blur(var())',
    ]);
  });

  it('stops a variable that refers to itself', () => {
    expect(
      resolve(
        ':root { --a: calc(var(--a) + 1px); } .x { --b: blur(var(--a)); }',
      ),
    ).toContain('--b: blur(calc(var(--a) + 1px))');
  });

  it('reads a custom property set inside an at-rule', () => {
    expect(
      resolve('@font-face { --a: 1px; --b: calc(var(--a) * 2); }'),
    ).toContain('--b: 2px');
  });
});

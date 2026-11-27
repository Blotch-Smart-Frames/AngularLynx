import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tailwindForLynx } from './tailwind-v4/index';
import {
  applyTextInheritance,
  INHERITANCE_CLASS,
  INHERITED_TEXT_PROPERTIES,
  isRelativeFontSize,
  LYNX_TEXT_INHERITANCE_CLASS,
  scopedSelector,
  textInheritanceForLynx,
} from './text-inheritance';

const process = (css: string) =>
  postcss([textInheritanceForLynx()]).process(css, { from: undefined }).css;

const runtimeTextFlow = (): string =>
  fs.readFileSync(
    path.join(
      import.meta.dirname,
      '../../runtime/src/lib/lynx-element/text-flow.ts',
    ),
    'utf-8',
  );

describe('INHERITED_TEXT_PROPERTIES', () => {
  // The runtime reads each property's variable, and the style index gives
  // each one the bit of its position: the two lists must agree.
  it("is the runtime's list", () => {
    const list = /INHERITED_TEXT_PROPERTIES[^=]*= \[([^\]]*)\]/.exec(
      runtimeTextFlow(),
    )![1]!;
    const properties = [...list.matchAll(/'([^']+)'/g)].map(([, p]) => p);
    expect(INHERITED_TEXT_PROPERTIES).toEqual(properties);
  });
});

describe('INHERITANCE_CLASS', () => {
  // The runtime gives elements the class the copies are narrowed to.
  it("is the runtime's class", () => {
    const value = /\bINHERITANCE_CLASS = '([^']+)'/.exec(runtimeTextFlow())![1];
    expect(INHERITANCE_CLASS).toBe(value);
  });
});

describe('LYNX_TEXT_INHERITANCE_CLASS', () => {
  // The runtime gives a Lynx <text> the class a `text` rule's copies are
  // narrowed to.
  it("is the runtime's class", () => {
    const value = /LYNX_TEXT_INHERITANCE_CLASS = '([^']+)'/.exec(
      runtimeTextFlow(),
    )![1];
    expect(LYNX_TEXT_INHERITANCE_CLASS).toBe(value);
  });
});

describe('isRelativeFontSize', () => {
  it.each([
    ['2em', true],
    ['.8EM', true],
    ['150%', true],
    ['calc(1.2em + 2px)', true],
    ['calc(100% - 2px)', true],
    ['1.25rem', false],
    ['18px', false],
    ['var(--size-2em)', false],
    ['var(--angular-lynx-font-size)', false],
  ])('reads %s as %s', (value, expected) => {
    expect(isRelativeFontSize(value)).toBe(expected);
  });

  // The runtime reads an inline size as the build reads a rule's.
  it('reads a size as the runtime does', () => {
    const own = fs.readFileSync(
      path.join(import.meta.dirname, 'text-inheritance.ts'),
      'utf-8',
    );
    const body = (source: string): string =>
      /export const isRelativeFontSize = [\s\S]*?;\n/.exec(source)![0];
    expect(body(runtimeTextFlow())).toBe(body(own));
  });
});

describe('scopedSelector', () => {
  it.each([
    ['.a', '.a._nginherit'],
    ['.a .b', '.a .b._nginherit'],
    ['.a > .b.c', '.a > .b.c._nginherit'],
    // A Lynx <text>, which an HTML text tag such as a <p> isn't on the web.
    ['view > text', 'view > text._nginherit-text'],
    ['text.a:active', 'text.a._nginherit-text:active'],
    ['view > text, .a', 'view > text._nginherit-text, .a._nginherit'],
    ['text .a', 'text .a._nginherit'],
    ['#id', '#id._nginherit'],
    // Ahead of the pseudo-classes, so it's a class of the same element.
    ['.a:active', '.a._nginherit:active'],
    ['.a:not(.b)', '.a._nginherit:not(.b)'],
    ['.a .b:first-child', '.a .b._nginherit:first-child'],
    [':hover', '._nginherit:hover'],
    ['*', '._nginherit'],
    ['.a > *', '.a > ._nginherit'],
    ['svg|*', 'svg|*._nginherit'],
    ['.a, .b', '.a._nginherit, .b._nginherit'],
    // The page, which keeps its copies one class below the others'.
    [':root', '._nginherit:root'],
    [':root, .a', '._nginherit:root, .a._nginherit'],
    // Nothing is inside a pseudo-element to read them.
    ['.a::placeholder', ''],
    ['.a, .b::placeholder', '.a._nginherit'],
    // One PostCSS can't parse is kept as it is.
    ['.a[', '.a['],
  ])('narrows %s to %s', (selector, expected) => {
    expect(scopedSelector(selector)).toBe(expected);
  });
});

describe('textInheritanceForLynx', () => {
  it.each([
    [
      '.a { color: red }',
      '.a { color: red }.a._nginherit { --angular-lynx-color: red }',
    ],
    [
      '.a { font-size: 12px; line-height: 16px; margin: 0 }',
      '.a { font-size: 12px; line-height: 16px; margin: 0 }.a._nginherit { --angular-lynx-font-size: 12px; --angular-lynx-line-height: 16px }',
    ],
    // The variable is a default for the element's descendants, so it isn't
    // important: one an element sets for itself still wins.
    [
      '.a { color: red !important }',
      '.a { color: red !important }.a._nginherit { --angular-lynx-color: red }',
    ],
    // Another variable whose name starts the same is no reason to skip it.
    [
      '.a { color: var(--angular-lynx-color-strong) }',
      '.a { color: var(--angular-lynx-color-strong) }.a._nginherit { --angular-lynx-color: var(--angular-lynx-color-strong) }',
    ],
    [
      '.a { COLOR: var(--primary) }',
      '.a { COLOR: var(--primary) }.a._nginherit { --angular-lynx-color: var(--primary) }',
    ],
    [
      '.a { /* why */ color: red }',
      '.a { /* why */ color: red }.a._nginherit { --angular-lynx-color: red }',
    ],
    // Right after the rule, in its at-rule, so the copies win over each
    // other as the declarations do.
    [
      '@media (min-width: 600px) { .a { text-align: center } }',
      '@media (min-width: 600px) { .a { text-align: center } .a._nginherit { --angular-lynx-text-align: center } }',
    ],
    [
      '.a { color: red } .b { color: blue }',
      '.a { color: red }.a._nginherit { --angular-lynx-color: red } .b { color: blue } .b._nginherit { --angular-lynx-color: blue }',
    ],
    // A rule that sets one variable itself keeps it, and gets the others.
    // Its copies' rule sets it too, so it competes with the other rules'
    // copies as it did. (The space before the `}`s was the custom
    // property's, as PostCSS reads it.)
    [
      '.a { color: red; font-size: 1px; --angular-lynx-color: blue }',
      '.a { color: red; font-size: 1px; --angular-lynx-color: blue }.a._nginherit { --angular-lynx-font-size: 1px; --angular-lynx-color: blue }',
    ],
    [
      '.a { color: red; --angular-lynx-color: blue }',
      '.a { color: red; --angular-lynx-color: blue }.a._nginherit { --angular-lynx-color: blue }',
    ],
    // One that comes later wins over another rule's copy on an element with
    // both classes, as before.
    [
      '.a { color: red } .b { --angular-lynx-color: blue }',
      '.a { color: red }.a._nginherit { --angular-lynx-color: red } .b { --angular-lynx-color: blue } .b._nginherit { --angular-lynx-color: blue }',
    ],
    // It stays for a declaration that reads it on an element without the
    // class, such as a Lynx <text> with only its text inside.
    [
      '.a { --angular-lynx-color: red; color: var(--angular-lynx-color, blue) }',
      '.a { --angular-lynx-color: red; color: var(--angular-lynx-color, blue) }.a._nginherit { --angular-lynx-color: red }',
    ],
    // A relative size as `1em`, the size of the parent of the tag that
    // reads it: `2em` would make each tag twice its parent's size, which is
    // already the `<p>`'s (issue #701). Other properties keep theirs.
    [
      '.a { font-size: 2em; line-height: 1.5em }',
      '.a { font-size: 2em; line-height: 1.5em }.a._nginherit { --angular-lynx-font-size: 1em; --angular-lynx-line-height: 1.5em }',
    ],
    [
      '.a { font-size: 150% !important }',
      '.a { font-size: 150% !important }.a._nginherit { --angular-lynx-font-size: 1em }',
    ],
    [
      '.a { FONT-SIZE: calc(1.2em + 2px) }',
      '.a { FONT-SIZE: calc(1.2em + 2px) }.a._nginherit { --angular-lynx-font-size: 1em }',
    ],
    // The root's size isn't the parent's.
    [
      '.a { font-size: 1.25rem }',
      '.a { font-size: 1.25rem }.a._nginherit { --angular-lynx-font-size: 1.25rem }',
    ],
  ])('copies %s', (css, expected) => {
    expect(process(css)).toBe(expected);
  });

  it.each([
    '.a { margin: 0 }',
    // Nothing is inside a pseudo-element to read them.
    '.a::placeholder { color: gray }',
    '.a::placeholder { --angular-lynx-color: gray }',
    '@font-face { font-family: Inter; src: url(a.ttf) }',
    '@keyframes fade { from { color: red } to { color: blue } }',
    // A copy of a value that reads its own variable would refer to itself
    // (issue #649's `<small>`), so the text inside keeps the value above.
    '.a { font-size: calc(var(--angular-lynx-font-size, 14px) / 1.2) }',
    '.a { color: VAR( --angular-lynx-color) }',
  ])('leaves %s alone', (css) => {
    expect(process(css)).toBe(css);
  });

  describe('with Tailwind 4', () => {
    let sourceDir: string;

    beforeAll(() => {
      sourceDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'angular-lynx-inheritance-'),
      );
      fs.writeFileSync(
        path.join(sourceDir, 'app.html'),
        '<div class="text-red-500 text-sm font-bold"></div>',
      );
    });

    afterAll(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    // Tailwind 4 writes oklch() colors, which its lowering turns into ones
    // Lynx reads at OnceExit. The plugin comes after it, as in
    // plugin-angular-lynx.ts, so the variable gets the color Lynx reads.
    it("copies Tailwind's utilities after the lowering", async () => {
      const { root } = await postcss([
        tailwindcss({ base: sourceDir }),
        tailwindForLynx(),
        textInheritanceForLynx(),
      ]).process(
        `@import 'tailwindcss/theme.css';\n@import 'tailwindcss/utilities.css';\n@source "${sourceDir}";`,
        { from: path.join(globalThis.process.cwd(), 'styles.css') },
      );
      const variables = new Map<string, string>();
      root.walkDecls(/^--angular-lynx-/, (declaration) => {
        variables.set(
          `${(declaration.parent as postcss.Rule).selector} ${declaration.prop}`,
          declaration.value,
        );
      });
      const color = variables.get(
        '.text-red-500._nginherit --angular-lynx-color',
      );
      expect(color).toBeDefined();
      expect(color).not.toContain('oklch');
      expect(
        variables.has('.text-sm._nginherit --angular-lynx-font-size'),
      ).toBe(true);
      expect(
        variables.has('.font-bold._nginherit --angular-lynx-font-weight'),
      ).toBe(true);
    });
  });
});

describe('applyTextInheritance', () => {
  it("adds the plugin to every environment's PostCSS plugins", () => {
    type PostcssHook = (
      options: object,
      utils: { addPlugins: (plugin: unknown) => void },
    ) => void;
    let hook: PostcssHook | undefined;
    const api = {
      modifyRsbuildConfig: (
        handler: (
          config: object,
          utils: { mergeRsbuildConfig: (...configs: object[]) => object },
        ) => { tools: { postcss: PostcssHook } },
      ) => {
        hook = handler(
          {},
          { mergeRsbuildConfig: (_config, override) => override },
        ).tools.postcss;
      },
    };
    applyTextInheritance(api as any);
    const addPlugins = vi.fn();
    hook!({}, { addPlugins });
    expect(addPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        postcssPlugin: 'angular-lynx-text-inheritance',
      }),
    );
  });
});

import fs from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { styleIndexOf } from './style-index';
import {
  INHERITED_TEXT_PROPERTIES,
  textInheritanceForLynx,
} from './text-inheritance';
import {
  applyTextScale,
  TEXT_SCALE_STYLESHEET,
  textScaleForLynx,
} from './text-scale';

const process = (css: string) =>
  postcss([textScaleForLynx()]).process(css, { from: undefined }).css;

describe('textScaleForLynx', () => {
  // The root font size is what every rem resolves against, so writing it in
  // sp, which Lynx scales by the LynxView's font scale, makes them all grow
  // with the phone's text size.
  it.each([
    ['page { font-size: 16px }', 'page { font-size: 16sp }'],
    [
      'page { font-size: 17.5px; color: red }',
      'page { font-size: 17.5sp; color: red }',
    ],
    ['page.dark { font-size: 16px }', 'page.dark { font-size: 16sp }'],
    ['PAGE { font-size: 16PX }', 'PAGE { font-size: 16sp }'],
    [
      'page, page.dark { font-size: 16px }',
      'page, page.dark { font-size: 16sp }',
    ],
    [
      '@layer base { page { font-size: 16px } }',
      '@layer base { page { font-size: 16sp } }',
    ],
  ])('writes the page font size %s in sp', (css, expected) => {
    expect(process(css)).toBe(expected);
  });

  // A px size anywhere else is the app's way to keep text from growing, and
  // a list that styles other elements too would grow their text as well.
  it.each([
    '.title { font-size: 16px }',
    'page view { font-size: 16px }',
    'page > text { font-size: 16px }',
    ':root { font-size: 16px }',
    'page { line-height: 24px }',
    'page { --size: 16px }',
  ])('leaves %s as it is', (css) => {
    expect(process(css)).toBe(css);
  });

  // The view keeps its px; the page's root follows the phone.
  it('gives the page of a list that styles other elements too a rule of its own, in sp', () => {
    expect(process('page, view { font-size: 16px }')).toBe(
      'page, view { font-size: 16px }\npage { font-size: 16sp }',
    );
    expect(process('page.dark, .title, page { font-size: 16px }')).toBe(
      'page.dark, .title, page { font-size: 16px }\npage.dark, page { font-size: 16sp }',
    );
  });

  // A later font-size wins over an earlier one in the page's rule too.
  it("keeps the order of a list's font sizes in the page's rule", () => {
    expect(process('page, view { font-size: 16px; font-size: 20px }')).toBe(
      'page, view { font-size: 16px; font-size: 20px }\npage { font-size: 16sp; font-size: 20sp }',
    );
    expect(
      process('page, view { font-size: 16px; font-size: var(--size) }'),
    ).toBe(
      'page, view { font-size: 16px; font-size: var(--size) }\npage { font-size: 16sp; font-size: var(--size) }',
    );
    // A font size in a rule nested inside the list is that rule's own.
    expect(
      process('page, view { font-size: 16px; &.dark { font-size: 20px } }'),
    ).toBe(
      'page, view { font-size: 16px; &.dark { font-size: 20px } } page { font-size: 16sp }',
    );
  });

  // PostCSS visits a declaration again when another plugin changes it.
  it("gives a list's page one rule however often the declaration is visited", () => {
    let touched = false;
    const touch = {
      postcssPlugin: 'touch',
      Declaration(declaration: { value: string }) {
        if (touched) return;
        touched = true;
        declaration.value = '16px ';
      },
    };
    expect(
      postcss([textScaleForLynx(), touch]).process(
        'page, view { font-size: 16px }',
        { from: undefined },
      ).css,
    ).toBe('page, view { font-size: 16px  }\npage { font-size: 16sp }');
  });

  // Tailwind 4 flattens nesting at OnceExit, after this plugin's
  // declarations have been visited for the last time.
  it('writes a page rule nested with & in sp', () => {
    expect(process('page { &.dark { font-size: 20px } }')).toBe(
      'page { &.dark { font-size: 20sp } }',
    );
    expect(process('page { &:hover { font-size: 20px } }')).toBe(
      'page { &:hover { font-size: 20sp } }',
    );
    expect(process('.a { &.dark { font-size: 20px } }')).toBe(
      '.a { &.dark { font-size: 20px } }',
    );
    expect(process('page { & view { font-size: 20px } }')).toBe(
      'page { & view { font-size: 20px } }',
    );
    expect(process('page, .a { &.dark { font-size: 20px } }')).toBe(
      'page, .a { &.dark { font-size: 20px } }',
    );
  });

  // Of the root itself, or the app's own arithmetic.
  it.each([
    'page { font-size: 1.2rem }',
    'page { font-size: 1.2em }',
    'page { font-size: 120% }',
    'page { font-size: calc(14px + 2px) }',
    'page { font-size: var(--size) }',
  ])('leaves a page font size that is not a plain px length, %s', (css) => {
    expect(process(css)).toBe(css);
  });

  it('leaves a rule whose selector it cannot parse as it is', () => {
    const root = postcss.root();
    root.append(
      postcss.rule({ selector: 'page[' }).append({
        prop: 'font-size',
        value: '16px',
      }),
    );
    expect(postcss([textScaleForLynx()]).process(root).css).toBe(
      'page[ {\n    font-size: 16px\n}',
    );
  });

  // The HTML text tags read a copy of the page's font size, made at
  // OnceExit, after the rewrite: their text grows with the page's.
  it('runs before the copy the HTML text tags read', () => {
    expect(
      postcss([textScaleForLynx(), textInheritanceForLynx()]).process(
        'page { font-size: 16px }',
        { from: undefined },
      ).css,
    ).toBe(
      'page { font-size: 16sp }page._nginherit { --angular-lynx-font-size: 16sp }',
    );
  });

  // An app that sets no root font size gets Lynx's default written out, so
  // the rewrite makes it follow the phone too.
  it("gives the native bundle's page Lynx's default root font size, in sp", () => {
    const css = fs.readFileSync(TEXT_SCALE_STYLESHEET, 'utf8');
    expect(process(css)).toContain('font-size: 14sp;');
  });

  // A Lynx <text> with no size of its own draws at Lynx's built-in 14px,
  // whatever the page's size, so it neither took the theme's 16px nor grew
  // with the phone (issue #673). 1rem is the page's size, sp and all.
  it("gives a <text> with no font size of its own the page's, in rem", () => {
    const css = fs.readFileSync(TEXT_SCALE_STYLESHEET, 'utf8');
    const rules: [string, string][] = [];
    postcss.parse(process(css)).walkDecls('font-size', (declaration) => {
      rules.push([
        (declaration.parent as postcss.Rule).selector,
        declaration.value,
      ]);
    });
    expect(rules).toEqual([
      ['page', '14sp'],
      ['text', '1rem'],
    ]);
  });

  // The HTML inline tags in a Lynx <text> read its copy, so
  // `<text>Total: <b>12</b></text>` draws the <b> at the <text>'s 1rem, and
  // the style index tells the runtime the <text> sets its size, so the tag
  // reads the copy rather than staying at Lynx's default (#drawnAtDefault).
  it("passes a <text>'s rem font size to the HTML text tags inside it", () => {
    const css = fs.readFileSync(TEXT_SCALE_STYLESHEET, 'utf8');
    const built = postcss([
      textScaleForLynx(),
      textInheritanceForLynx(),
    ]).process(css, { from: undefined }).css;
    expect(built).toContain('text._nginherit-text {');
    expect(built).toMatch(
      /text\._nginherit-text \{\s*--angular-lynx-font-size: 1rem;?\s*\}/,
    );
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    expect(styleIndexOf([css]).rules).toContainEqual([['<text>'], fontSize]);
  });
});

describe('applyTextScale', () => {
  type PostcssHook = (
    options: object,
    utils: { addPlugins: (plugin: unknown) => void },
  ) => void;
  const configFor = (name: string) => {
    let result: { tools?: { postcss?: PostcssHook } } | undefined;
    const api = {
      modifyEnvironmentConfig: (
        handler: (
          config: object,
          utils: {
            name: string;
            mergeEnvironmentConfig: (...configs: object[]) => object;
          },
        ) => object,
      ) => {
        result = handler(
          { original: true },
          { name, mergeEnvironmentConfig: (_config, override) => override },
        ) as typeof result;
      },
    };
    applyTextScale(api as never);
    return result;
  };

  it("adds the plugin to the native environment's PostCSS plugins", () => {
    const plugins: unknown[] = [];
    configFor('lynx')!.tools!.postcss!(
      {},
      {
        addPlugins: (plugin) => plugins.push(plugin),
      },
    );
    expect(plugins).toEqual([
      expect.objectContaining({ postcssPlugin: 'angular-lynx-text-scale' }),
    ]);
  });

  // A browser has no sp.
  it('leaves the web environment as it is', () => {
    expect(configFor('web')).toEqual({ original: true });
  });
});

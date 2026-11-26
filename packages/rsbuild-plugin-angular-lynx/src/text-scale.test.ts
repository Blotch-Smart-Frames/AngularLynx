import fs from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { textInheritanceForLynx } from './text-inheritance';
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
    'page, view { font-size: 16px }',
    ':root { font-size: 16px }',
    'page { line-height: 24px }',
    'page { --size: 16px }',
  ])('leaves %s as it is', (css) => {
    expect(process(css)).toBe(css);
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

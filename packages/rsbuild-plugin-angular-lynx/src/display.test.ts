import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyDisplay, displayForLynx, LYNX_DISPLAY } from './display';
import { tailwindForLynx } from './tailwind-v4/index';

const process = (css: string) =>
  postcss([displayForLynx()]).process(css, { from: undefined }).css;

describe('LYNX_DISPLAY', () => {
  // The runtime rewrites inline styles with its own copy. A value only one of
  // them maps would lay out one way in a stylesheet and another in a
  // `[style.display]` binding.
  it("is the runtime's map", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/display.ts',
      ),
      'utf-8',
    );
    const map = /LYNX_DISPLAY[^=]*= new Map\(\[([\s\S]*?)\]\);/.exec(
      source,
    )![1]!;
    const entries = [...map.matchAll(/\['([^']+)', '([^']+)'\]/g)].map(
      ([, web, lynx]) => [web, lynx],
    );
    expect([...LYNX_DISPLAY]).toEqual(entries);
  });
});

describe('displayForLynx', () => {
  it.each([
    // The issue's case, as Angular scopes `:host { display: block }`.
    ['._nghost-abc { display: block }', '._nghost-abc { display: linear }'],
    ['.a { display: flow-root }', '.a { display: linear }'],
    ['.a { display: inline }', '.a { display: linear }'],
    ['.a { display: inline-block }', '.a { display: linear }'],
    ['.a { display: inline-flex }', '.a { display: flex }'],
    ['.a { display: inline-grid }', '.a { display: grid }'],
    ['.a { display: BLOCK }', '.a { display: linear }'],
    ['.a { DISPLAY: block }', '.a { DISPLAY: linear }'],
    ['.a { display: block !important }', '.a { display: linear !important }'],
    [
      '@media (min-width: 600px) { .a { width: 100%; display: block } }',
      '@media (min-width: 600px) { .a { width: 100%; display: linear } }',
    ],
  ])('rewrites %s', (css, expected) => {
    expect(process(css)).toBe(expected);
  });

  it.each([
    '.a { display: flex }',
    '.a { display: grid }',
    '.a { display: linear }',
    '.a { display: none }',
    '.a { display: relative }',
    '.a { display: var(--display) }',
    // A custom property, which the app may read as anything.
    '.a { --display: block }',
    '@supports (display: block) { .a { color: red } }',
  ])('leaves %s alone', (css) => {
    expect(process(css)).toBe(css);
  });

  describe('with Tailwind 4', () => {
    let sourceDir: string;

    beforeAll(() => {
      sourceDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'angular-lynx-display-'),
      );
      fs.writeFileSync(
        path.join(sourceDir, 'app.html'),
        '<view class="block inline-flex inline-block hidden"></view>',
      );
    });

    afterAll(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    // Tailwind 4's lowering drops the values Lynx doesn't have, such as
    // `inline-flex`, at OnceExit. The plugin comes after it, as in
    // plugin-angular-lynx.ts, and still sees them first.
    it("rewrites Tailwind's utilities before the lowering drops them", async () => {
      const { root } = await postcss([
        tailwindcss({ base: sourceDir }),
        tailwindForLynx(),
        displayForLynx(),
      ]).process(
        `@import 'tailwindcss/utilities.css';\n@source "${sourceDir}";`,
        { from: path.join(globalThis.process.cwd(), 'styles.css') },
      );
      const display = new Map<string, string>();
      root.walkDecls('display', (declaration) => {
        display.set(
          (declaration.parent as postcss.Rule).selector,
          declaration.value,
        );
      });
      expect(Object.fromEntries(display)).toEqual({
        '.block': 'linear',
        '.hidden': 'none',
        '.inline-block': 'linear',
        '.inline-flex': 'flex',
      });
    });
  });
});

describe('applyDisplay', () => {
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
    applyDisplay(api as any);
    const addPlugins = vi.fn();
    hook!({}, { addPlugins });
    expect(addPlugins).toHaveBeenCalledWith(
      expect.objectContaining({ postcssPlugin: 'angular-lynx-display' }),
    );
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tailwindForLynx } from './tailwind-v4/index';
import {
  applyTextInheritance,
  INHERITED_TEXT_PROPERTIES,
  textInheritanceForLynx,
} from './text-inheritance';

const process = (css: string) =>
  postcss([textInheritanceForLynx()]).process(css, { from: undefined }).css;

describe('INHERITED_TEXT_PROPERTIES', () => {
  // The runtime reads each property's variable, and the style index gives
  // each one the bit of its position: the two lists must agree.
  it("is the runtime's list", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/text-flow.ts',
      ),
      'utf-8',
    );
    const list = /INHERITED_TEXT_PROPERTIES[^=]*= \[([^\]]*)\]/.exec(
      source,
    )![1]!;
    const properties = [...list.matchAll(/'([^']+)'/g)].map(([, p]) => p);
    expect(INHERITED_TEXT_PROPERTIES).toEqual(properties);
  });
});

describe('textInheritanceForLynx', () => {
  it.each([
    ['.a { color: red }', '.a { color: red; --angular-lynx-color: red }'],
    [
      '.a { font-size: 12px; line-height: 16px; margin: 0 }',
      '.a { font-size: 12px; --angular-lynx-font-size: 12px; line-height: 16px; --angular-lynx-line-height: 16px; margin: 0 }',
    ],
    // The variable is a default for the element's descendants, so it isn't
    // important: one an element sets for itself still wins.
    [
      '.a { color: red !important }',
      '.a { color: red !important; --angular-lynx-color: red }',
    ],
    [
      '.a { COLOR: var(--primary) }',
      '.a { COLOR: var(--primary); --angular-lynx-color: var(--primary) }',
    ],
    [
      '.a { /* why */ color: red }',
      '.a { /* why */ color: red; --angular-lynx-color: red }',
    ],
    [
      '@media (min-width: 600px) { .a { text-align: center } }',
      '@media (min-width: 600px) { .a { text-align: center; --angular-lynx-text-align: center } }',
    ],
  ])('copies %s', (css, expected) => {
    expect(process(css)).toBe(expected);
  });

  it.each([
    '.a { margin: 0 }',
    // A rule that sets the variable itself keeps its own value.
    '.a { color: red; --angular-lynx-color: blue }',
    '@font-face { font-family: Inter; src: url(a.ttf) }',
    '@keyframes fade { from { color: red } to { color: blue } }',
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
      const color = variables.get('.text-red-500 --angular-lynx-color');
      expect(color).toBeDefined();
      expect(color).not.toContain('oklch');
      expect(variables.has('.text-sm --angular-lynx-font-size')).toBe(true);
      expect(variables.has('.font-bold --angular-lynx-font-weight')).toBe(true);
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

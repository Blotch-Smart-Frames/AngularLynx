import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyNestedCalc,
  flattenNestedCalc,
  nestedCalcForLynx,
} from './nested-calc';
import { safeAreaForLynx } from './safe-area';
import { tailwindForLynx } from './tailwind-v4/index';

const process = (css: string) =>
  postcss([nestedCalcForLynx()]).process(css, { from: undefined }).css;

describe('flattenNestedCalc', () => {
  it.each([
    [
      'calc(calc(var(--spacing) * 3) + 1px)',
      'calc((var(--spacing) * 3) + 1px)',
    ],
    ['calc(1px + calc(2px * 3))', 'calc(1px + (2px * 3))'],
    ['calc(calc(calc(1px + 2px) * 3) / 2)', 'calc(((1px + 2px) * 3) / 2)'],
    ['CALC(Calc(1px + 2px) * 3)', 'CALC((1px + 2px) * 3)'],
    // Lynx substitutes the fallback as text, inside the calc().
    ['calc(var(--x, calc(1px + 2px)) * 3)', 'calc(var(--x, (1px + 2px)) * 3)'],
    // Each top-level calc() stays; only the one inside goes.
    [
      'calc(1px + 2px) calc(calc(3px * 2) + 4px)',
      'calc(1px + 2px) calc((3px * 2) + 4px)',
    ],
    [
      'translate(calc(calc(1px * 2) + 3px), 0)',
      'translate(calc((1px * 2) + 3px), 0)',
    ],
  ])('flattens %s', (value, expected) => {
    expect(flattenNestedCalc(value)).toBe(expected);
  });

  it.each([
    '1px',
    'calc(1px + 2px)',
    'calc((1px + 2px) * 3)',
    // Two calc()s side by side, neither inside the other.
    'calc(1px + 2px) calc(3px + 4px)',
    // A var() fallback that isn't inside a calc() is read as a value of its
    // own, where a calc() is what it needs.
    'var(--x, calc(1px + 2px)) calc(3px)',
    'translate(calc(1px), calc(2px))',
  ])('leaves %s alone', (value) => {
    expect(flattenNestedCalc(value)).toBeUndefined();
  });
});

describe('nestedCalcForLynx', () => {
  it('rewrites the declarations of every rule', () => {
    expect(
      process(
        '.a { padding-top: calc(calc(4px * 3) + 1px) } @media (min-width: 600px) { .b { margin: calc(1px + calc(2px * 2)) } }',
      ),
    ).toBe(
      '.a { padding-top: calc((4px * 3) + 1px) } @media (min-width: 600px) { .b { margin: calc(1px + (2px * 2)) } }',
    );
  });

  // Lynx substitutes a var() as text, so the calc() inside a variable's
  // calc() is nested wherever it's read.
  it('rewrites a custom property', () => {
    expect(process('.a { --pad: calc(calc(4px * 3) + 1px) }')).toBe(
      '.a { --pad: calc((4px * 3) + 1px) }',
    );
  });

  it('keeps !important', () => {
    expect(
      process('.a { padding-top: calc(calc(4px * 3) + 1px) !important }'),
    ).toBe('.a { padding-top: calc((4px * 3) + 1px) !important }');
  });

  it.each(['.a { padding-top: calc(4px * 3 + 1px) }', '.a { color: red }'])(
    'leaves %s alone',
    (css) => {
      expect(process(css)).toBe(css);
    },
  );

  describe('with Tailwind 4', () => {
    let sourceDir: string;

    beforeAll(() => {
      sourceDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'angular-lynx-nested-calc-'),
      );
      fs.writeFileSync(
        path.join(sourceDir, 'app.html'),
        '<view class="pt-safe-3 pb-safe-24"></view>',
      );
    });

    afterAll(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    // The @blotch/ui theme's utilities, as packages/ui/src/lib/theme/
    // tailwind.css writes them, through the plugins an app's stylesheet goes
    // through, in their order. Tailwind writes `--spacing(3)` as a calc() of
    // its own, so each utility's calc() has one inside it, and Lynx dropped
    // the padding in a development build, which nothing minifies.
    it("flattens the theme's safe-area utilities", async () => {
      const { root } = await postcss([
        tailwindcss({ base: sourceDir }),
        tailwindForLynx(),
        safeAreaForLynx(),
        nestedCalcForLynx(),
      ]).process(
        [
          "@import 'tailwindcss/theme.css';",
          "@import 'tailwindcss/utilities.css';",
          `@source "${sourceDir}";`,
          '@utility pt-safe-* { padding-top: calc(--spacing(--value(number)) + env(safe-area-inset-top)); }',
          '@utility pb-safe-* { padding-bottom: calc(--spacing(--value(number)) + env(safe-area-inset-bottom)); }',
        ].join('\n'),
        { from: path.join(globalThis.process.cwd(), 'styles.css') },
      );
      const padding = new Map<string, string>();
      root.walkDecls(/^padding/, (declaration) => {
        padding.set(
          (declaration.parent as postcss.Rule).selector,
          declaration.value,
        );
      });
      expect(Object.fromEntries(padding)).toEqual({
        '.pb-safe-24':
          'calc((var(--spacing) * 24) + var(--angular-lynx-safe-area-inset-bottom, env(safe-area-inset-bottom)))',
        '.pt-safe-3':
          'calc((var(--spacing) * 3) + var(--angular-lynx-safe-area-inset-top, env(safe-area-inset-top)))',
      });
    });
  });
});

describe('applyNestedCalc', () => {
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
    applyNestedCalc(api as any);
    const addPlugins = vi.fn();
    hook!({}, { addPlugins });
    expect(addPlugins).toHaveBeenCalledWith(
      expect.objectContaining({ postcssPlugin: 'angular-lynx-nested-calc' }),
    );
  });
});

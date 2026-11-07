import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applySafeArea,
  SAFE_AREA_INSET_VARIABLES,
  safeAreaForLynx,
} from './safe-area';
import { tailwindForLynx } from './tailwind-v4/index';

const process = (css: string) =>
  postcss([safeAreaForLynx()]).process(css, { from: undefined }).css;

const TOP = 'var(--angular-lynx-safe-area-inset-top, env(safe-area-inset-top))';
const BOTTOM =
  'var(--angular-lynx-safe-area-inset-bottom, env(safe-area-inset-bottom))';

describe('SAFE_AREA_INSET_VARIABLES', () => {
  // The runtime sets these variables on the page and rewrites inline styles
  // with its own copy. A name only one of them used would leave a stylesheet's
  // padding on Lynx's env(), which is 0 in a generated app.
  it("is the runtime's", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-element/safe-area-insets.ts',
      ),
      'utf-8',
    );
    const body = /SAFE_AREA_INSET_VARIABLES[^=]*= \{([\s\S]*?)\};/.exec(
      source,
    )![1]!;
    const entries = [...body.matchAll(/(\w+): '([^']+)'/g)].map(
      ([, side, name]) => [side, name],
    );
    expect(Object.entries(SAFE_AREA_INSET_VARIABLES)).toEqual(entries);
  });
});

describe('safeAreaForLynx', () => {
  it.each([
    [
      '.a { padding-top: env(safe-area-inset-top) }',
      `.a { padding-top: ${TOP} }`,
    ],
    [
      '.a { padding-bottom: calc(1rem + env(safe-area-inset-bottom)) }',
      `.a { padding-bottom: calc(1rem + ${BOTTOM}) }`,
    ],
    [
      '.a { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left) }',
      `.a { padding: ${TOP} var(--angular-lynx-safe-area-inset-right, env(safe-area-inset-right)) ${BOTTOM} var(--angular-lynx-safe-area-inset-left, env(safe-area-inset-left)) }`,
    ],
    // Lynx reads no env() fallback, so the one it falls back to has none.
    [
      '.a { bottom: env(safe-area-inset-bottom, 0px) }',
      `.a { bottom: ${BOTTOM} }`,
    ],
    ['.a { top: ENV(Safe-Area-Inset-Top) }', `.a { top: ${TOP} }`],
    // Malformed, but not this plugin's to judge.
    [
      '.a { margin: var() env(safe-area-inset-top) }',
      `.a { margin: var() ${TOP} }`,
    ],
    [
      '.a { top: env( safe-area-inset-top ) !important }',
      `.a { top: ${TOP} !important }`,
    ],
    [
      '@media (min-width: 600px) { .a { padding-top: env(safe-area-inset-top) } }',
      `@media (min-width: 600px) { .a { padding-top: ${TOP} } }`,
    ],
  ])('rewrites %s', (css, expected) => {
    expect(process(css)).toBe(expected);
  });

  it.each([
    '.a { padding-top: 1rem }',
    '.a { padding-top: env(keyboard-inset-height) }',
    '.a { padding-top: var(--pad) }',
    '.a { padding-top: env() }',
    // A custom property: Lynx can't resolve the var() the rewrite would put
    // inside its calc().
    '.a { --pad: calc(env(safe-area-inset-top) + 8px) }',
    '.a { --pad: env(safe-area-inset-top) }',
  ])('leaves %s alone', (css) => {
    expect(process(css)).toBe(css);
  });

  // PostCSS visits a declaration again after a plugin changes it, and so
  // would a second build step. Wrapping again would put a var() in a var()'s
  // fallback, which Lynx's CSS serializer rejects.
  it('leaves a value it already rewrote alone', () => {
    const once = process(
      '.a { padding-bottom: calc(1rem + env(safe-area-inset-bottom)) }',
    );
    expect(process(once)).toBe(once);
  });

  describe('with Tailwind 4', () => {
    let sourceDir: string;

    beforeAll(() => {
      sourceDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'angular-lynx-safe-area-'),
      );
      fs.writeFileSync(
        path.join(sourceDir, 'app.html'),
        '<view class="pt-safe pb-safe-24"></view>',
      );
    });

    afterAll(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    // The @blotch/ui theme's utilities, as packages/ui/src/lib/theme/
    // tailwind.css writes them, through the Lynx lowering that follows
    // Tailwind 4 in an app.
    it("rewrites the theme's safe-area utilities", async () => {
      const { root } = await postcss([
        tailwindcss({ base: sourceDir }),
        tailwindForLynx(),
        safeAreaForLynx(),
      ]).process(
        [
          "@import 'tailwindcss/theme.css';",
          "@import 'tailwindcss/utilities.css';",
          `@source "${sourceDir}";`,
          '@utility pt-safe { padding-top: env(safe-area-inset-top); }',
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
        // The lowering keeps the spacing's var(), which Lynx resolves in an
        // ordinary property's calc(). The calc() Tailwind wrote for the
        // spacing, which Lynx can't read inside another, is
        // nestedCalcForLynx's to flatten (see nested-calc.test.ts).
        '.pb-safe-24': `calc(calc(var(--spacing) * 24) + ${BOTTOM})`,
        '.pt-safe': TOP,
      });
    });
  });
});

describe('applySafeArea', () => {
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
    applySafeArea(api as any);
    const addPlugins = vi.fn();
    hook!({}, { addPlugins });
    expect(addPlugins).toHaveBeenCalledWith(
      expect.objectContaining({ postcssPlugin: 'angular-lynx-safe-area' }),
    );
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyColorScheme,
  colorSchemeForLynx,
  DARK_CLASS,
} from './color-scheme';
import { tailwindForLynx } from './tailwind-v4/index';

const lower = (css: string) =>
  postcss([colorSchemeForLynx()]).process(css, { from: undefined }).css;

/**
 * `css` with its whitespace collapsed, to compare rules, not formatting.
 */
const squash = (css: string) => css.replaceAll(/\s+/g, ' ').trim();

describe('DARK_CLASS', () => {
  // The runtime puts this class on the page. A different name in this copy
  // would scope every dark rule to a class the page never has.
  it("is the runtime's class", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/lynx-document/page-color-scheme.ts',
      ),
      'utf-8',
    );
    expect(/DARK_CLASS = '([^']+)'/.exec(source)?.[1]).toBe(DARK_CLASS);
  });
});

describe('colorSchemeForLynx', () => {
  it("turns a dark query's rules into rules under page.dark", () => {
    expect(
      squash(
        lower(`.bg-white { background-color: #fff; }
@media (prefers-color-scheme: dark) {
  .dark\\:bg-zinc-900 { background-color: #18181b; }
  .dark\\:text-white { color: #fff; }
}`),
      ),
    ).toBe(
      squash(`.bg-white { background-color: #fff; }
page.dark .dark\\:bg-zinc-900 { background-color: #18181b; }
page.dark .dark\\:text-white { color: #fff; }`),
    );
  });

  it("turns a light query's rules into rules under page:not(.dark)", () => {
    expect(
      squash(
        lower('@media (prefers-color-scheme: light) { .a { color: #000; } }'),
      ),
    ).toBe('page:not(.dark) .a { color: #000; }');
  });

  it.each([
    // Minified, as a production build's Tailwind writes it.
    '(prefers-color-scheme:dark)',
    '( prefers-color-scheme : DARK )',
    'screen and (prefers-color-scheme: dark)',
    'only screen and (prefers-color-scheme: dark)',
    'all and (prefers-color-scheme: dark)',
  ])('reads the query %s', (query) => {
    expect(squash(lower(`@media ${query} { .a { color: #fff; } }`))).toBe(
      'page.dark .a { color: #fff; }',
    );
  });

  it.each([
    // Lynx can't apply the width, so the whole query stays, as before.
    '(prefers-color-scheme: dark) and (min-width: 640px)',
    '(prefers-color-scheme: dark), print',
    'not all and (prefers-color-scheme: dark)',
    'print and (prefers-color-scheme: dark)',
    '(prefers-reduced-motion: reduce)',
  ])('leaves the query %s alone', (query) => {
    const css = `@media ${query} { .a { color: #fff; } }`;
    expect(lower(css)).toBe(css);
  });

  it.each([
    // The page itself gains the condition, so its variables switch.
    [':root', 'page.dark'],
    ['page', 'page.dark'],
    ['PAGE', 'page.dark'],
    [':root .card', 'page.dark .card'],
    ['page > view', 'page.dark > view'],
    ['page.app', 'page.dark.app'],
    [':root.app', 'page.dark.app'],
    // Anything else is a descendant of the page.
    ['.card', 'page.dark .card'],
    ['view.card > text', 'page.dark view.card > text'],
    ['*', 'page.dark *'],
    ['.dark\\:\\*\\:p-1 > *', 'page.dark .dark\\:\\*\\:p-1 > *'],
    ['.a::placeholder', 'page.dark .a::placeholder'],
    ['.card._ngcontent-abc', 'page.dark .card._ngcontent-abc'],
    // A tag other than the page's can't become it.
    ['html:root', 'page.dark html:root'],
    // `:root()` with an argument isn't the page.
    ['.a, :root', 'page.dark .a, page.dark'],
    ['.a,.b', 'page.dark .a,page.dark .b'],
    // An empty selector stays empty.
    [',.a', ',page.dark .a'],
  ])('scopes %s to %s', (selector, expected) => {
    expect(
      squash(
        lower(
          `@media (prefers-color-scheme: dark) { ${selector} { --x: 1; } }`,
        ),
      ),
    ).toBe(`${expected} { --x: 1; }`);
  });

  it('scopes the rules in a query inside it, which stays', () => {
    // `dark:md:p-4`, as Tailwind writes it.
    expect(
      squash(
        lower(
          '@media (prefers-color-scheme: dark) { @media (min-width: 768px) { .a { padding: 1rem; } } @supports (display: grid) { .b { display: grid; } } }',
        ),
      ),
    ).toBe(
      '@media (min-width: 768px) { page.dark .a { padding: 1rem; } } @supports (display: grid) { page.dark .b { display: grid; } }',
    );
  });

  it('scopes a query inside another query', () => {
    // `md:dark:p-2`, as Tailwind writes it.
    expect(
      squash(
        lower(
          '@media (min-width: 768px) { @media (prefers-color-scheme: dark) { .a { padding: .5rem; } } }',
        ),
      ),
    ).toBe('@media (min-width: 768px) { page.dark .a { padding: .5rem; } }');
  });

  it('leaves anything but rules in the query', () => {
    // A dark animation would replace the light one everywhere if it moved.
    expect(
      squash(
        lower(
          '@media (prefers-color-scheme: dark) { /* dark */ .a { color: #fff; } @keyframes k { from { opacity: 0; } to { opacity: 1; } } }',
        ),
      ),
    ).toBe(
      'page.dark .a { color: #fff; } @media (prefers-color-scheme: dark) { /* dark */ @keyframes k { from { opacity: 0; } to { opacity: 1; } } }',
    );
  });

  it('leaves a query inside it that holds keyframes in the query', () => {
    // Moving the @supports out would take the keyframes out of the dark
    // query with it, and they can't be scoped to the page.
    const css =
      '@media (prefers-color-scheme: dark) { @supports (a: b) { @keyframes k { from { opacity: 0; } } } }';
    expect(lower(css)).toBe(css);
  });

  it('leaves a query inside it that holds keyframes beside rules, rules and all', () => {
    // Its rules stay in the dark query, unscoped, so they keep their
    // meaning: Lynx drops the @supports anyway.
    const css =
      '@media (prefers-color-scheme: dark) { @media (min-width: 1px) { .a { color: #fff; } @supports (a: b) { @font-face { font-family: x; } } } }';
    expect(lower(css)).toBe(css);
  });

  it('removes a query left with only comments', () => {
    expect(
      squash(
        lower(
          '@media (prefers-color-scheme: dark) { /* a */ .a { color: #fff; } }',
        ),
      ),
    ).toBe('page.dark .a { color: #fff; }');
  });

  it('leaves a query nested in a rule alone', () => {
    // Nesting Lynx can't read, which Tailwind 4's lowering flattens first.
    const css = '.a { @media (prefers-color-scheme: dark) { color: #fff; } }';
    expect(lower(css)).toBe(css);
  });

  it('leaves a query without a block alone', () => {
    const css = '@media (prefers-color-scheme: dark);';
    expect(lower(css)).toBe(css);
  });

  it("leaves a rule whose selector can't be parsed in the query", () => {
    const css = '@media (prefers-color-scheme: dark) { .a] { color: #fff; } }';
    expect(lower(css)).toBe(css);
  });

  describe('after Tailwind CSS 4', () => {
    let sourceDir: string;

    beforeAll(() => {
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-dark-'));
      fs.writeFileSync(
        path.join(sourceDir, 'app.html'),
        '<view class="bg-white dark:bg-zinc-900 dark:bg-black/50 dark:md:p-4"></view>',
      );
    });

    afterAll(() => {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    });

    // Tailwind nests a development build's queries in the rules, and
    // Tailwind 4's lowering flattens them before this plugin runs.
    it.each([false, true])(
      'scopes its dark: classes to page.dark (optimize: %s)',
      async (optimize) => {
        const { css } = await postcss([
          tailwindcss({ base: sourceDir, optimize }),
          tailwindForLynx(),
          colorSchemeForLynx(),
        ]).process(
          `@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@source "${sourceDir}";
.card { @variant dark { color: #fff; } }`,
          { from: path.join(process.cwd(), 'styles.css') },
        );

        expect(css).not.toMatch(/prefers-color-scheme/);
        expect(css).toMatch(/page\.dark \.dark\\:bg-zinc-900\s*\{/);
        // The opacity modifier, which sits in an @supports Tailwind 4's
        // lowering unwraps.
        expect(css).toMatch(/page\.dark \.dark\\:bg-black\\\/50\s*\{/);
        expect(css).toMatch(/page\.dark \.dark\\:md\\:p-4\s*\{/);
        expect(css).toMatch(/page\.dark \.card\s*\{/);
        expect(css).toMatch(/\.bg-white\s*\{/);
      },
    );
  });
});

describe('applyColorScheme', () => {
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
    applyColorScheme(api as any);
    const addPlugins = vi.fn();
    hook!({}, { addPlugins });

    expect(addPlugins).toHaveBeenCalledWith(
      expect.objectContaining({ postcssPlugin: 'angular-lynx-color-scheme' }),
    );
  });
});

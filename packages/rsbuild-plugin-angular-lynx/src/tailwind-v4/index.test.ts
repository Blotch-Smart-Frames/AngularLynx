import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import postcss, { type AcceptedPlugin, type Rule } from 'postcss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lowerForLynx, tailwindForLynx } from './index';

describe('tailwindForLynx', () => {
  let sourceDir: string;

  beforeAll(() => {
    // An app's templates, which Tailwind reads through `@source`.
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-tw4-'));
    fs.writeFileSync(
      path.join(sourceDir, 'app.html'),
      `<view class="bg-red-500 bg-black/50 px-4 border translate-x-2 rotate-45
        space-y-2 inset-0 opacity-50 hover:bg-blue-500 md:flex animate-spin
        rounded-full uppercase blur-sm"></view>`,
    );
  });

  afterAll(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  /**
   * Compiles a stylesheet with Tailwind 4 and the plugin, from this package,
   * which has Tailwind 4 installed (the workspace's other packages use 3).
   */
  const compile = async (css: string, plugins?: AcceptedPlugin[]) =>
    (
      await postcss(
        plugins ?? [tailwindcss({ base: sourceDir }), tailwindForLynx()],
      ).process(`${css}\n@source "${sourceDir}";`, {
        from: path.join(process.cwd(), 'styles.css'),
      })
    ).root;

  const STYLESHEET = `@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);`;

  /**
   * The declarations of the top-level rules with this selector.
   */
  const declarationsOf = (root: postcss.Root, selector: string) =>
    root.nodes
      .filter((node): node is Rule => node.type === 'rule')
      .filter((rule) => rule.selector === selector)
      .flatMap((rule) => rule.nodes.map((node) => node.toString()));

  const rules = (root: postcss.Root) =>
    root.nodes.filter((node): node is Rule => node.type === 'rule');

  it('leaves no CSS that Lynx drops', async () => {
    // A rule only a shadow host matches goes, as Lynx would drop it.
    const css = (await compile(`${STYLESHEET}\n:host { --x: 1; }`)).toString();

    expect(css).not.toMatch(/@layer|@property|oklch\(|:host|:where\(|&/);
    // The only color-mix() left is in an @supports that Lynx never passes.
    expect(css.replace(/@supports[^{]*\{[^}]*\{[^}]*\}\s*\}/g, '')).not.toMatch(
      /color-mix\(/,
    );
  });

  it('rewrites the utilities into CSS with the same meaning', async () => {
    const root = await compile(STYLESHEET);

    expect(declarationsOf(root, '.bg-black\\/50')).toEqual([
      'background-color: rgba(0, 0, 0, 0.5)',
    ]);
    expect(declarationsOf(root, '.px-4')).toEqual([
      'padding-left: calc(var(--spacing) * 4)',
      'padding-right: calc(var(--spacing) * 4)',
    ]);
    expect(declarationsOf(root, '.opacity-50')).toEqual(['opacity: 0.5']);
    expect(declarationsOf(root, '.translate-x-2')).toEqual([
      '--tw-translate-x: 0.5rem',
      expect.stringMatching(/^transform: translate3d\(/),
    ]);
    expect(declarationsOf(root, '.space-y-2 > * + *')).toContainEqual(
      expect.stringMatching(/^margin-top: /),
    );
    expect(declarationsOf(root, '.rounded-full')).toEqual([
      'border-radius: 9999px',
    ]);
    expect(declarationsOf(root, '.uppercase')).toEqual([]);
    expect(declarationsOf(root, '.blur-sm')[0]).toBe('--tw-blur: blur(8px)');
    expect(declarationsOf(root, ':root')).toContainEqual(
      '--color-red-500: rgb(251, 44, 54)',
    );
  });

  it("starts every element with Tailwind's and the transform's variables", async () => {
    const root = await compile(`@charset "utf-8";\n${STYLESHEET}`);
    const charset = root.nodes.find((node) => node.type === 'atrule')!;

    expect(charset.toString()).toBe('@charset "utf-8"');
    expect((charset.next() as Rule).selector).toBe('*');
    expect(declarationsOf(root, '*')).toEqual(
      expect.arrayContaining([
        '--tw-border-style: solid',
        '--tw-translate-x: 0',
        '--tw-rotate: 0deg',
        '--tw-scale-x: 1',
      ]),
    );
  });

  it('writes the starting values first when there is nothing before them', async () => {
    const root = await compile(STYLESHEET);
    expect(rules(root)[0]?.selector).toBe('*');
    expect(root.first?.type).toBe('rule');
  });

  it('adds no starting values when nothing needs them', async () => {
    const root = await compile(
      `@import 'tailwindcss/theme.css' layer(theme);\n.a { @apply text-red-500; }`,
    );
    expect(rules(root).map(({ selector }) => selector)).not.toContain('*');
  });

  it("writes the @blotch/ui theme's opacity modifiers with its channel variables", async () => {
    fs.writeFileSync(
      path.join(sourceDir, 'theme.html'),
      '<view class="bg-primary/50 shadow-primary/20 bg-black/50"></view>',
    );
    const theme = path.resolve('../ui/src/lib/theme/tailwind.css');
    const root = await compile(
      `${STYLESHEET}\n@import '${theme}';\npage { --primary: rgba(24, 24, 27, 1); --primary-rgb: 24, 24, 27; }`,
    );

    // The rgba() rule follows the fallback, now that it's out of @supports.
    expect(declarationsOf(root, '.bg-primary\\/50')).toEqual([
      'background-color: var(--primary)',
      'background-color: rgba(var(--primary-rgb), 0.5)',
    ]);
    // A shadow color's mix with its alpha variable stays in @supports, which
    // Lynx never passes: the shadow takes the color without the opacity.
    expect(declarationsOf(root, '.shadow-primary\\/20')).toEqual([
      '--tw-shadow-color: var(--primary)',
    ]);
    const supports = root.nodes.filter(
      (node) => node.type === 'atrule' && node.toString().includes('shadow'),
    );
    expect(supports.map(String).join()).toContain('color-mix(');
  });

  it('leaves a stylesheet that Tailwind 4 did not compile alone', async () => {
    const css = '@layer x { .a { padding-inline: 1px; } }';
    expect((await compile(css, [tailwindForLynx()])).toString()).toContain(css);
  });
});

describe('lowerForLynx', () => {
  it('leaves an @supports statement without a block alone', () => {
    const root = postcss.parse(
      '@supports (color: color-mix(in lab, red, red));',
    );
    lowerForLynx(root, (selector) => postcss.rule({ selector }));
    expect(root.toString()).toBe(
      '@supports (color: color-mix(in lab, red, red));',
    );
  });
});

/// <reference types="node" />
// Not copied into apps, unlike tailwind-plugin.test.ts, which covers the
// plugin there: this runs Tailwind's own build, through Node and postcss, which
// an app's `ng test` can't count on. It checks the classes the plugin's colors
// make, with the Lynx preset, as an app's build does.
import { createRequire } from 'node:module';
import preset from '@lynx-js/tailwind-preset';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import { blotchPlugin } from './tailwind-plugin';

/**
 * The part of postcss these tests use.
 */
type PostCss = (plugins: unknown[]) => {
  process: (
    css: string,
    options: { from: undefined },
  ) => Promise<{ css: string }>;
};

// postcss runs Tailwind. It's Tailwind's own dependency, so it's loaded from
// there rather than added to this package.
const postcss = createRequire(
  createRequire(import.meta.url).resolve('tailwindcss'),
)('postcss') as PostCss;

/**
 * Compiles `classes` with Tailwind, the Lynx preset and the plugin, as an
 * app's build does, and returns the CSS.
 */
const compile = async (classes: string): Promise<string> => {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: classes, extension: 'html' }],
      presets: [preset],
      plugins: [blotchPlugin],
    }),
  ]).process('@tailwind utilities;', { from: undefined });
  return result.css;
};

describe('blotchPlugin colors in a Tailwind build', () => {
  it('keeps plain color classes on the complete color', async () => {
    const css = await compile('bg-primary text-foreground border-border');

    expect(css).toContain('background-color: var(--primary)');
    expect(css).toContain('color: var(--foreground)');
    expect(css).toContain('border-color: var(--border)');
    // No class reads the channels, so a theme without them still draws.
    expect(css).not.toContain('-rgb');
  });

  it('turns opacity modifiers into rgba() over the channels', async () => {
    const css = await compile(
      'bg-primary/50 text-foreground/70 border-border/60 bg-destructive/10 bg-chart-1/[.35]',
    );

    expect(css).toContain('background-color: rgba(var(--primary-rgb), 0.5)');
    expect(css).toContain('color: rgba(var(--foreground-rgb), 0.7)');
    expect(css).toContain('border-color: rgba(var(--border-rgb), 0.6)');
    expect(css).toContain(
      'background-color: rgba(var(--destructive-rgb), 0.1)',
    );
    expect(css).toContain('background-color: rgba(var(--chart-1-rgb), .35)');
  });

  it('gives every mapped color a modifier, except the translucent destructive-subtle', async () => {
    const names = [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'muted',
      'muted-foreground',
      'accent',
      'accent-foreground',
      'destructive',
      'destructive-foreground',
      'border',
      'input',
      'ring',
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
    ];
    const css = await compile(
      [
        ...names.map((name) => `bg-${name}/50`),
        'bg-destructive-subtle/50',
      ].join(' '),
    );

    for (const name of names) {
      expect(css).toContain(`rgba(var(--${name}-rgb), 0.5)`);
    }
    // Tailwind can't add alpha to a complete color, so it makes no class.
    expect(css).not.toContain('destructive-subtle');
  });
});

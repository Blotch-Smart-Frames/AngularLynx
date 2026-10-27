import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { blotchPlugin } from './tailwind-plugin';

/**
 * tailwind.css is tailwind-plugin.ts for Tailwind 4. Nothing ties the two
 * together, so these tests keep them mapping the same colors and radii, and
 * keep every color it maps backed by the theme files.
 */
const read = (file: string): string =>
  readFileSync(new URL(file, import.meta.url), 'utf8');

const tailwindCss = (): string =>
  read('./tailwind.css').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * `--color-x` → the theme variable it reads, from the `@theme` block.
 */
const mappedColors = (): Map<string, string> =>
  new Map(
    [...tailwindCss().matchAll(/--color-([\w-]+):\s*var\((--[\w-]+)\);/g)].map(
      (match) => [match[1]!, match[2]!],
    ),
  );

/**
 * The plugin's color classes, flattened as Tailwind names them.
 */
const pluginColors = (): Map<string, string> => {
  const factory = blotchPlugin as unknown as {
    config: { theme: { extend: { colors: Record<string, unknown> } } };
  };
  const colors = new Map<string, string>();
  const walk = (value: unknown, path: string[]) => {
    if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, key === 'DEFAULT' ? path : [...path, key]);
      }
      return;
    }
    const css =
      typeof value === 'function'
        ? (value as (options: object) => string)({})
        : String(value);
    colors.set(path.join('-'), /var\((--[\w-]+)\)/.exec(css)![1]!);
  };
  walk(factory.config.theme.extend.colors, []);
  return colors;
};

describe('tailwind.css', () => {
  it('maps the same colors to the same variables as the plugin', () => {
    expect(mappedColors()).toEqual(pluginColors());
  });

  it('maps the radii as the plugin does', () => {
    const css = tailwindCss();
    expect(css).toContain('--radius-lg: var(--radius);');
    expect(css).toContain('--radius-md: calc(var(--radius) - 2px);');
    expect(css).toContain('--radius-sm: calc(var(--radius) - 4px);');
  });

  it.each(['./default.css', './dark.css'])(
    'reads only variables %s sets, each opaque one with its channels',
    (file) => {
      const css = read(file);
      for (const variable of mappedColors().values()) {
        const value = new RegExp(`${variable}:\\s*([^;]+);`).exec(css)?.[1];
        expect(value, variable).toBeDefined();
        if (value!.endsWith(', 1)')) {
          // The build writes bg-primary/50 as rgba(var(--primary-rgb), 0.5).
          expect(css, `${variable}-rgb`).toContain(`${variable}-rgb:`);
        }
      }
    },
  );
});

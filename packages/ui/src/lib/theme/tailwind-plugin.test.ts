import { createRequire } from 'node:module';
import preset from '@lynx-js/tailwind-preset';
import tailwindcss from 'tailwindcss';
import { describe, expect, it, vi } from 'vitest';

import {
  addSafeAreaUtilities,
  blotchPlugin,
  themeColor,
} from './tailwind-plugin';

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
 * These tests exercise the utility generator in isolation with mock Tailwind
 * plugin callbacks — no real Tailwind runtime is needed. We assert the exact
 * CSS strings emitted so a regression in the `env()` / `calc()` wiring (which is
 * what makes safe area work on Lynx) is caught immediately.
 */
const setup = () => {
  const addUtilities = vi.fn();
  const matchUtilities = vi.fn();
  // Minimal spacing scale — enough to prove offset utilities read the theme.
  const spacing = { '0': '0px', '2': '0.5rem', '4': '1rem' };
  const theme = vi.fn((key: string) =>
    key === 'spacing' ? spacing : undefined,
  );

  addSafeAreaUtilities({
    addUtilities: addUtilities as never,
    matchUtilities: matchUtilities as never,
    theme: theme as never,
  });

  return { addUtilities, matchUtilities, spacing };
};

describe('addSafeAreaUtilities', () => {
  it('registers bare padding utilities equal to the inset', () => {
    const { addUtilities } = setup();
    const utilities = addUtilities.mock.calls[0][0];

    expect(utilities['.pt-safe']).toEqual({
      'padding-top': 'env(safe-area-inset-top)',
    });
    expect(utilities['.pb-safe']).toEqual({
      'padding-bottom': 'env(safe-area-inset-bottom)',
    });
    expect(utilities['.px-safe']).toEqual({
      'padding-left': 'env(safe-area-inset-left)',
      'padding-right': 'env(safe-area-inset-right)',
    });
    expect(utilities['.p-safe']).toEqual({
      'padding-top': 'env(safe-area-inset-top)',
      'padding-right': 'env(safe-area-inset-right)',
      'padding-bottom': 'env(safe-area-inset-bottom)',
      'padding-left': 'env(safe-area-inset-left)',
    });
  });

  it('registers one offset family per side, seeded from the spacing scale', () => {
    const { matchUtilities, spacing } = setup();

    // One matchUtilities call per physical side.
    expect(matchUtilities).toHaveBeenCalledTimes(4);

    // Every call must feed off the theme spacing scale so the safe offsets stay
    // in sync with the normal padding scale.
    for (const [, options] of matchUtilities.mock.calls) {
      expect(options).toEqual({ values: spacing });
    }
  });

  it('offset utilities compose base spacing with the inset via calc()', () => {
    const { matchUtilities } = setup();

    // Find the bottom family (`pb-safe`) and invoke its generator.
    const bottomCall = matchUtilities.mock.calls.find(
      ([utils]) => 'pb-safe' in utils,
    );
    expect(bottomCall).toBeDefined();

    const generate = bottomCall![0]['pb-safe'];
    expect(generate('1rem')).toEqual({
      'padding-bottom': 'calc(1rem + env(safe-area-inset-bottom))',
    });
  });
});

describe('blotchPlugin', () => {
  it('runs the plugin setup callback, registering base styles and safe area utilities', () => {
    // Reach the plugin's `handler` (the first arg to the tailwind `plugin()`
    // factory) so its `addBase` + `addSafeAreaUtilities` calls are covered.
    const addBase = vi.fn();
    const addUtilities = vi.fn();
    const matchUtilities = vi.fn();
    const theme = vi.fn(() => ({ '4': '1rem' }));

    // The tailwindcss `plugin()` factory returns a `{ handler, config }`
    // object at runtime. Cast through unknown so TypeScript accepts the
    // internal shape.
    const factory = blotchPlugin as unknown as {
      handler: (api: unknown) => void;
      config?: unknown;
    };

    factory.handler({
      addBase,
      addUtilities,
      matchUtilities,
      theme,
    });

    expect(addBase).toHaveBeenCalledWith({
      '*': { 'border-color': 'var(--border)' },
    });
    // The safe area utilities came through — bare + matched variants added.
    expect(addUtilities).toHaveBeenCalled();
    expect(matchUtilities).toHaveBeenCalled();
  });

  it('exposes a config object containing the theme extension colors', () => {
    // The second argument to `plugin()` is a config object that Tailwind
    // deep-merges into the user's config. Verify our theme extensions round-
    // trip so the colors are exposed to the utility classes.
    const factory = blotchPlugin as unknown as {
      config?: { theme?: { extend?: { colors?: Record<string, unknown> } } };
    };
    const colors = factory.config?.theme?.extend?.colors;
    expect(colors).toBeDefined();
    const background = colors!['background'] as (options?: object) => string;
    expect(background()).toBe('var(--background)');
  });
});

describe('themeColor', () => {
  const primary = themeColor('primary');

  it('reads the complete color when no alpha is asked for', () => {
    // caret-primary, shadow-primary: Tailwind passes no options.
    expect(primary()).toBe('var(--primary)');
    expect(primary({})).toBe('var(--primary)');
  });

  it("reads the complete color for a plain class with Tailwind's opacity variable", () => {
    // bg-primary: the opacity variable is always 1 unless a deprecated
    // bg-opacity-* utility changes it, and that never worked on these colors.
    expect(
      primary({
        opacityVariable: '--tw-bg-opacity',
        opacityValue: 'var(--tw-bg-opacity, 1)',
      }),
    ).toBe('var(--primary)');
  });

  it('reads the complete color for an alpha of 1', () => {
    // bg-primary/100 passes '1'; theme('colors.primary') passes the number 1.
    expect(primary({ opacityValue: '1' })).toBe('var(--primary)');
    expect(primary({ opacityValue: 1 })).toBe('var(--primary)');
  });

  it('reads the channels for an opacity modifier', () => {
    expect(primary({ opacityValue: '0.5' })).toBe(
      'rgba(var(--primary-rgb), 0.5)',
    );
    // A gradient's transparent end stop asks for 0.
    expect(primary({ opacityValue: 0 })).toBe('rgba(var(--primary-rgb), 0)');
  });
});

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

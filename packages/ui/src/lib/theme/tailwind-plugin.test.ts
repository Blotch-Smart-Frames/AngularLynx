import { describe, expect, it, vi } from 'vitest';

import { addSafeAreaUtilities, blotchPlugin } from './tailwind-plugin';

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
    expect(colors!['background']).toBe('var(--background)');
  });
});

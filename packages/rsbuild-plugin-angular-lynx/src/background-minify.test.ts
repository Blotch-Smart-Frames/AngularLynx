import { describe, expect, it, vi } from 'vitest';
import {
  applyBackgroundMinify,
  BACKGROUND_COMPRESS_PASSES,
  BACKGROUND_SCRIPT,
} from './background-minify';

class SwcJsMinimizerRspackPlugin {}

/**
 * A chain with the minimizers rspack-chain would hold, as plugin
 * descriptors of a name, a plugin class and its arguments.
 */
const createChain = (
  minimizers: Record<string, unknown[] | undefined>,
  plugin: unknown = SwcJsMinimizerRspackPlugin,
) => {
  const registered = new Map<string, { plugin?: unknown; args?: unknown[] }>(
    Object.entries(minimizers).map(([id, args]) => [id, { plugin, args }]),
  );
  const minimizer = (id: string) => {
    const entry = registered.get(id) ?? {};
    registered.set(id, entry);
    return {
      get: (key: 'args' | 'plugin') => entry[key],
      tap: (fn: (args: unknown[]) => unknown[]) => {
        entry.args = fn(entry.args ?? []);
      },
      use: (plugin: unknown, args: unknown[]) => {
        entry.plugin = plugin;
        entry.args = args;
      },
    };
  };
  const chain = {
    optimization: {
      minimizers: {
        entries: () =>
          registered.size ? Object.fromEntries(registered) : undefined,
      },
      minimizer,
    },
  };
  return { chain, registered };
};

/**
 * Runs the plugin's handler on `minimizers`, and returns what it registered
 * and the order it asked for.
 */
const run = (
  minimizers: Record<string, unknown[] | undefined>,
  plugin?: unknown,
) => {
  let hook: { order: string; handler: (...args: unknown[]) => void };
  const api = {
    modifyBundlerChain: vi.fn((descriptor) => {
      hook = descriptor;
    }),
  };
  applyBackgroundMinify(api as never);
  const { chain, registered } = createChain(minimizers, plugin);
  hook!.handler(chain, {
    CHAIN_ID: { MINIMIZER: { JS: 'js', CSS: 'css' } },
    rspack: { SwcJsMinimizerRspackPlugin },
  });
  return { order: hook!.order, registered };
};

/**
 * The options a registered minimizer was given.
 */
const optionsOf = (
  registered: ReturnType<typeof run>['registered'],
  id: string,
): any => registered.get(id)!.args![0];

describe('applyBackgroundMinify', () => {
  it('runs after rsbuild registers its minimizers', () => {
    expect(run({}).order).toBe('post');
  });

  it("takes the background scripts from rsbuild's minimizer", () => {
    const options = {
      minimizerOptions: { mangle: true, compress: { pure_getters: true } },
    };
    const { registered } = run({ js: [options] });

    expect(registered.get('js')?.args).toEqual([
      { ...options, exclude: [BACKGROUND_SCRIPT] },
    ]);
  });

  it('gives them a copy of it with more passes', () => {
    const { registered } = run({
      js: [
        {
          extractComments: false,
          minimizerOptions: { mangle: true, compress: { pure_getters: true } },
        },
      ],
    });

    expect(registered.get('js-background')).toEqual({
      plugin: SwcJsMinimizerRspackPlugin,
      args: [
        {
          extractComments: false,
          test: BACKGROUND_SCRIPT,
          minimizerOptions: {
            mangle: true,
            compress: {
              pure_getters: true,
              passes: BACKGROUND_COMPRESS_PASSES,
            },
          },
        },
      ],
    });
  });

  it.each([
    ['no options', undefined, { passes: BACKGROUND_COMPRESS_PASSES }],
    [
      'compression on',
      [{ minimizerOptions: { compress: true } }],
      { passes: BACKGROUND_COMPRESS_PASSES },
    ],
    [
      'more passes of its own',
      [{ minimizerOptions: { compress: { passes: 20 } } }],
      { passes: 20 },
    ],
    ['compression off', [{ minimizerOptions: { compress: false } }], false],
  ])(
    "follows the minimizer's compression with %s",
    (_label, args, compress) => {
      const { registered } = run({ js: args });

      expect(
        optionsOf(registered, 'js-background').minimizerOptions.compress,
      ).toEqual(compress);
    },
  );

  it("keeps the files the minimizer's config leaves out", () => {
    const { registered } = run({
      js: [{ exclude: /vendor/ }],
      'js-1': [{ exclude: [/a/, 'b'] }],
    });

    expect(optionsOf(registered, 'js').exclude).toEqual([
      /vendor/,
      BACKGROUND_SCRIPT,
    ]);
    expect(optionsOf(registered, 'js-1').exclude).toEqual([
      /a/,
      'b',
      BACKGROUND_SCRIPT,
    ]);
    expect(optionsOf(registered, 'js-1-background').exclude).toEqual([
      /a/,
      'b',
    ]);
  });

  it('leaves alone a minimizer with files of its own', () => {
    const options = { test: /\.mjs$/ };
    const { registered } = run({ js: [options] });

    expect(registered.get('js')?.args).toEqual([options]);
    expect(registered.has('js-background')).toBe(false);
  });

  it('leaves alone a minimizer the app replaced with another tool', () => {
    class TerserPlugin {}
    const { registered } = run({ js: [{}] }, TerserPlugin);

    expect(registered.get('js')).toEqual({ plugin: TerserPlugin, args: [{}] });
    expect(registered.has('js-background')).toBe(false);
  });

  it("leaves the CSS minimizers and other plugins' alone", () => {
    const { registered } = run({ css: [{}], jsx: [{}] });

    expect([...registered.keys()]).toEqual(['css', 'jsx']);
  });

  it("matches each entry's background script", () => {
    expect(BACKGROUND_SCRIPT.test('main/background-thread.js')).toBe(true);
    expect(BACKGROUND_SCRIPT.test('background-thread.js')).toBe(true);
    expect(BACKGROUND_SCRIPT.test('main/main-thread.js')).toBe(false);
    expect(BACKGROUND_SCRIPT.test('main/my-background-thread.js')).toBe(false);
  });
});

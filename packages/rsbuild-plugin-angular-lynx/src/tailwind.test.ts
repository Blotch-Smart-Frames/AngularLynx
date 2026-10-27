import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/angular/find-up.js', () => ({
  findUp: vi.fn(),
}));

import { findUp } from './utils/angular/find-up.js';
import { applyTailwind } from './tailwind';

const mockedFindUp = vi.mocked(findUp);

type PostcssHook = (
  options: { postcssOptions?: unknown },
  utils: { addPlugins: (plugin: unknown) => void },
) => void;

/**
 * Runs `applyTailwind` against a stand-in plugin API and returns the
 * `tools.postcss` hook it adds to the Rsbuild config, and the logger's `warn`.
 */
const setUp = () => {
  let hook: PostcssHook | undefined;
  const warn = vi.fn();
  const api = {
    logger: { warn },
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
  applyTailwind(api as any);
  return { hook: hook!, warn };
};

/**
 * Runs the hook with the given PostCSS options and returns the names of the
 * plugins it adds.
 */
const addedPlugins = (hook: PostcssHook, postcssOptions?: unknown) => {
  const addPlugins = vi.fn();
  hook({ postcssOptions }, { addPlugins });
  return addPlugins.mock.calls.map(
    ([plugin]) => (plugin as { postcssPlugin: string }).postcssPlugin,
  );
};

/** What `@tailwindcss/postcss` looks like in a loaded PostCSS config. */
const TAILWIND_4 = { postcssPlugin: '@tailwindcss/postcss' };

describe('applyTailwind', () => {
  let projectRoot: string;
  let configFile: string;

  /**
   * Installs a stand-in tailwindcss package of this version in the app.
   */
  const installTailwind = (version: string) => {
    const tailwindDir = path.join(projectRoot, 'node_modules', 'tailwindcss');
    fs.mkdirSync(tailwindDir, { recursive: true });
    fs.writeFileSync(
      path.join(tailwindDir, 'package.json'),
      JSON.stringify({ name: 'tailwindcss', version, main: 'index.js' }),
    );
    fs.writeFileSync(
      path.join(tailwindDir, 'index.js'),
      "module.exports = function tailwindcss(options) { return { postcssPlugin: 'tailwindcss', options }; };",
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // An app with a Tailwind config, which the plugin resolves Tailwind from
    // rather than from itself.
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-tw-'));
    configFile = path.join(projectRoot, 'tailwind.config.ts');
    fs.writeFileSync(configFile, 'export default {};');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('looks for a Tailwind config from the working directory', () => {
    mockedFindUp.mockReturnValue(null);

    setUp();

    expect(mockedFindUp).toHaveBeenCalledWith(
      [
        'tailwind.config.ts',
        'tailwind.config.js',
        'tailwind.config.mjs',
        'tailwind.config.cjs',
      ],
      process.cwd(),
    );
  });

  it('only adds the Tailwind 4 lowering without a Tailwind config', () => {
    mockedFindUp.mockReturnValue(null);

    // Tailwind 4 needs no config file: the PostCSS config runs it.
    expect(addedPlugins(setUp().hook, { plugins: [TAILWIND_4] })).toEqual([
      'angular-lynx-tailwind',
    ]);
  });

  describe('Tailwind 3', () => {
    beforeEach(() => {
      installTailwind('3.4.19');
      mockedFindUp.mockReturnValue(configFile);
    });

    it("adds the app's Tailwind as a PostCSS plugin with the found config, then the lowering", () => {
      const addPlugins = vi.fn();
      setUp().hook({ postcssOptions: { plugins: [] } }, { addPlugins });

      expect(addPlugins.mock.calls.map(([plugin]) => plugin)).toEqual([
        { postcssPlugin: 'tailwindcss', options: { config: configFile } },
        expect.objectContaining({ postcssPlugin: 'angular-lynx-tailwind' }),
      ]);
    });

    it('adds Tailwind when the PostCSS options have no plugin list or are a function', () => {
      const { hook } = setUp();

      for (const postcssOptions of [undefined, {}, () => ({})]) {
        expect(addedPlugins(hook, postcssOptions)).toEqual([
          'tailwindcss',
          'angular-lynx-tailwind',
        ]);
      }
    });

    it('keeps a Tailwind the PostCSS config already runs', () => {
      const { hook } = setUp();

      const tailwindcss = () => {};
      // `plugins: { tailwindcss: {} }` lists it called, and
      // `plugins: [require('tailwindcss')]` lists the function itself.
      for (const tailwind of [{ postcssPlugin: 'tailwindcss' }, tailwindcss]) {
        expect(addedPlugins(hook, { plugins: [tailwind] })).toEqual([
          'angular-lynx-tailwind',
        ]);
      }
    });

    it('adds Tailwind next to other PostCSS plugins', () => {
      const nesting = () => {};

      expect(
        addedPlugins(setUp().hook, {
          plugins: [{ postcssPlugin: 'autoprefixer' }, nesting, null],
        }),
      ).toEqual(['tailwindcss', 'angular-lynx-tailwind']);
    });
  });

  describe('Tailwind 4 with a Tailwind config', () => {
    beforeEach(() => {
      installTailwind('4.3.3');
      mockedFindUp.mockReturnValue(configFile);
    });

    it("doesn't run Tailwind 4 as Tailwind 3", () => {
      expect(addedPlugins(setUp().hook, { plugins: [TAILWIND_4] })).toEqual([
        'angular-lynx-tailwind',
      ]);
    });

    it("warns, once, when the PostCSS config doesn't run Tailwind 4 either", () => {
      const { hook, warn } = setUp();

      expect(addedPlugins(hook, { plugins: [] })).toEqual([
        'angular-lynx-tailwind',
      ]);
      addedPlugins(hook, { plugins: [] });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain(
        "Tailwind CSS 4.3.3 is installed, which doesn't run from a Tailwind config file",
      );
    });

    it('stays quiet when the PostCSS config runs Tailwind 4', () => {
      const { hook, warn } = setUp();

      addedPlugins(hook, { plugins: [TAILWIND_4] });

      expect(warn).not.toHaveBeenCalled();
    });
  });
});

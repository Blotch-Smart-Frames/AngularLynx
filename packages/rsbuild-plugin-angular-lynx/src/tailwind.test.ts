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
 * `tools.postcss` hook it adds to the Rsbuild config, or `undefined` when it
 * adds none.
 */
const postcssHook = (): PostcssHook | undefined => {
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
  applyTailwind(api as any);
  return hook;
};

/**
 * Runs the hook with the given PostCSS options and returns the plugins it adds.
 */
const addedPlugins = (hook: PostcssHook, postcssOptions?: unknown) => {
  const addPlugins = vi.fn();
  hook({ postcssOptions }, { addPlugins });
  return addPlugins.mock.calls.map(([plugin]) => plugin);
};

describe('applyTailwind', () => {
  let projectRoot: string;
  let configFile: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // An app with a Tailwind config and a stand-in tailwindcss package, which
    // the plugin resolves from the app rather than from itself.
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-tw-'));
    configFile = path.join(projectRoot, 'tailwind.config.ts');
    fs.writeFileSync(configFile, 'export default {};');
    const tailwindDir = path.join(projectRoot, 'node_modules', 'tailwindcss');
    fs.mkdirSync(tailwindDir, { recursive: true });
    fs.writeFileSync(
      path.join(tailwindDir, 'index.js'),
      "module.exports = function tailwindcss(options) { return { postcssPlugin: 'tailwindcss', options }; };",
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('looks for a Tailwind config from the working directory', () => {
    mockedFindUp.mockReturnValue(null);

    applyTailwind({} as any);

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

  it('leaves the build alone without a Tailwind config', () => {
    mockedFindUp.mockReturnValue(null);

    expect(postcssHook()).toBeUndefined();
  });

  it("adds the app's Tailwind as a PostCSS plugin with the found config", () => {
    mockedFindUp.mockReturnValue(configFile);

    expect(addedPlugins(postcssHook()!, { plugins: [] })).toEqual([
      { postcssPlugin: 'tailwindcss', options: { config: configFile } },
    ]);
  });

  it('adds Tailwind when the PostCSS options have no plugin list or are a function', () => {
    mockedFindUp.mockReturnValue(configFile);
    const hook = postcssHook()!;

    for (const postcssOptions of [undefined, {}, () => ({})]) {
      expect(addedPlugins(hook, postcssOptions)).toHaveLength(1);
    }
  });

  it('keeps a Tailwind the PostCSS config already runs', () => {
    mockedFindUp.mockReturnValue(configFile);
    const hook = postcssHook()!;

    const tailwindcss = () => {};
    // `plugins: { tailwindcss: {} }` lists it called, and
    // `plugins: [require('tailwindcss')]` lists the function itself.
    for (const tailwind of [{ postcssPlugin: 'tailwindcss' }, tailwindcss]) {
      expect(addedPlugins(hook, { plugins: [tailwind] })).toEqual([]);
    }
  });

  it('adds Tailwind next to other PostCSS plugins', () => {
    mockedFindUp.mockReturnValue(configFile);
    const nesting = () => {};

    expect(
      addedPlugins(postcssHook()!, {
        plugins: [{ postcssPlugin: 'autoprefixer' }, nesting, null],
      }),
    ).toHaveLength(1);
  });
});

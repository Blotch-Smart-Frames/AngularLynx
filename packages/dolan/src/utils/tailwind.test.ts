import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, installPackage, type Fixture } from '../test-utils';
import { getUiSourceDir } from './resolve-paths';
import {
  installedTailwindVersion,
  majorVersion,
  tailwindConfigFile,
  themeFilesFor,
  usesTailwind4,
} from './tailwind';

let fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures) fixture.cleanup();
  fixtures = [];
});

/**
 * A project with these packages installed, and these other files. Its
 * package.json lists none of them: what's installed is what counts.
 */
const project = (
  installed: Record<string, string> = {},
  files: Record<string, string> = {},
) => {
  const fixture = createFixture({});
  fixtures.push(fixture);
  writeFileSync(join(fixture.dir, 'package.json'), '{}');
  for (const [name, version] of Object.entries(installed)) {
    installPackage(fixture.dir, name, version);
  }
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(fixture.dir, file), content);
  }
  return fixture.dir;
};

/**
 * A project that lists only `@tailwindcss/postcss`, with Tailwind in the
 * plugin's own node_modules, out of the project's reach, as pnpm installs it.
 */
const postcssOnly = () => {
  const dir = project();
  installPackage(
    installPackage(dir, '@tailwindcss/postcss', '4.3.3'),
    'tailwindcss',
    '4.3.3',
  );
  return dir;
};

describe('installedTailwindVersion', () => {
  it("reads the version of the project's own Tailwind, 3 or 4", () => {
    expect(installedTailwindVersion(project({ tailwindcss: '4.3.3' }))).toBe(
      '4.3.3',
    );
    expect(installedTailwindVersion(project({ tailwindcss: '3.4.19' }))).toBe(
      '3.4.19',
    );
  });

  it('finds the Tailwind a workspace root installs', () => {
    // The app's package.json lists no Tailwind: the root's is every package's.
    const root = project({ tailwindcss: '4.3.3' });
    const app = join(root, 'apps', 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), '{}');

    expect(installedTailwindVersion(app)).toBe('4.3.3');
  });

  it('finds the Tailwind @tailwindcss/postcss depends on, hoisted next to it', () => {
    // npm's layout: the plugin's dependency sits in the app's node_modules.
    expect(
      installedTailwindVersion(
        project({ '@tailwindcss/postcss': '4.3.3', tailwindcss: '4.3.3' }),
      ),
    ).toBe('4.3.3');
  });

  it("finds it from the plugin's own folder when the project can't", () => {
    expect(installedTailwindVersion(postcssOnly())).toBe('4.3.3');
  });

  it("prefers the project's own Tailwind to the plugin's", () => {
    // What the stylesheet's `@import 'tailwindcss'` finds first.
    const dir = project({ tailwindcss: '4.2.0' });
    installPackage(
      installPackage(dir, '@tailwindcss/postcss', '4.3.3'),
      'tailwindcss',
      '4.3.3',
    );

    expect(installedTailwindVersion(dir)).toBe('4.2.0');
  });

  it('is undefined without Tailwind, even when the plugin is there', () => {
    expect(installedTailwindVersion(project())).toBeUndefined();
    expect(
      installedTailwindVersion(project({ '@tailwindcss/postcss': '4.3.3' })),
    ).toBeUndefined();
  });
});

describe('majorVersion', () => {
  it("reads a version's major", () => {
    expect(majorVersion('4.3.3')).toBe(4);
    expect(majorVersion('3.4.19')).toBe(3);
    expect(majorVersion('4.0.0-beta.1')).toBe(4);
  });
});

describe('tailwindConfigFile', () => {
  it('names the Tailwind config in the project, if any', () => {
    expect(tailwindConfigFile(project({}, { 'tailwind.config.js': '' }))).toBe(
      'tailwind.config.js',
    );
    expect(tailwindConfigFile(project())).toBeUndefined();
  });
});

describe('usesTailwind4', () => {
  it('is true for a project with Tailwind 4 installed and no Tailwind config', () => {
    expect(usesTailwind4(project({ tailwindcss: '4.3.3' }))).toBe(true);
    expect(usesTailwind4(postcssOnly())).toBe(true);
  });

  it('is false for Tailwind 3, a Tailwind config, or no Tailwind', () => {
    expect(usesTailwind4(project({ tailwindcss: '3.4.19' }))).toBe(false);
    // A config is a Tailwind 3 setup, whatever's installed.
    expect(
      usesTailwind4(
        project({ tailwindcss: '4.3.3' }, { 'tailwind.config.js': '' }),
      ),
    ).toBe(false);
    expect(usesTailwind4(project())).toBe(false);
  });

  it('reads the installed version, not the one package.json asks for', () => {
    const dir = project({ tailwindcss: '3.4.19' });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { tailwindcss: '^4.3.3' } }),
    );
    expect(usesTailwind4(dir)).toBe(false);
  });
});

describe('themeFilesFor', () => {
  it('takes tailwind.css on Tailwind 4, and the config plugin on Tailwind 3', () => {
    expect(themeFilesFor(project({ tailwindcss: '4.3.3' }))).toEqual([
      'default.css',
      'dark.css',
      'tailwind.css',
    ]);
    expect(themeFilesFor(project({ tailwindcss: '3.4.19' }))).toEqual([
      'default.css',
      'dark.css',
      'tailwind-plugin.ts',
    ]);
  });

  it("adds the Tailwind plugin's test with the components' tests", () => {
    // It covers the plugin in the app's coverage report. Tailwind 4's
    // tailwind.css has no code to cover.
    expect(
      themeFilesFor(project({ tailwindcss: '3.4.19' }), { tests: true }),
    ).toEqual([
      'default.css',
      'dark.css',
      'tailwind-plugin.ts',
      'tailwind-plugin.test.ts',
    ]);
    expect(
      themeFilesFor(project({ tailwindcss: '4.3.3' }), { tests: true }),
    ).toEqual(['default.css', 'dark.css', 'tailwind.css']);
  });

  it('lists only files the theme folder has', () => {
    for (const version of ['3.4.19', '4.3.3']) {
      const files = themeFilesFor(project({ tailwindcss: version }), {
        tests: true,
      });
      for (const file of files) {
        expect(existsSync(join(getUiSourceDir(), 'theme', file)), file).toBe(
          true,
        );
      }
    }
  });
});

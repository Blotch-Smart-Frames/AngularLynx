import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, type Fixture } from '../test-utils';
import { getUiSourceDir } from './resolve-paths';
import { themeFilesFor, usesTailwind4 } from './tailwind';

let fixture: Fixture;

afterEach(() => {
  fixture?.cleanup();
});

/**
 * A project with these dev dependencies, and these other files.
 */
const project = (
  devDependencies: Record<string, string> | undefined,
  files: Record<string, string> = {},
) => {
  fixture = createFixture({});
  if (devDependencies) {
    writeFileSync(
      join(fixture.dir, 'package.json'),
      JSON.stringify({ devDependencies }),
    );
  }
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(fixture.dir, file), content);
  }
  return fixture.dir;
};

describe('usesTailwind4', () => {
  it('is true for a project on Tailwind 4 without a Tailwind config', () => {
    expect(usesTailwind4(project({ tailwindcss: '^4.3.3' }))).toBe(true);
    expect(usesTailwind4(project({ '@tailwindcss/postcss': '^4.3.3' }))).toBe(
      true,
    );
  });

  it('is false for Tailwind 3, a Tailwind config, or no Tailwind', () => {
    expect(usesTailwind4(project({ tailwindcss: '^3.4.19' }))).toBe(false);
    expect(
      usesTailwind4(
        project({ tailwindcss: '^4.0.0' }, { 'tailwind.config.js': '' }),
      ),
    ).toBe(false);
    expect(usesTailwind4(project({}))).toBe(false);
    expect(usesTailwind4(project(undefined))).toBe(false);
  });
});

describe('themeFilesFor', () => {
  it('takes tailwind.css on Tailwind 4, and the config plugin on Tailwind 3', () => {
    expect(themeFilesFor(project({ tailwindcss: '^4.3.3' }))).toEqual([
      'default.css',
      'dark.css',
      'tailwind.css',
    ]);
    expect(themeFilesFor(project({ tailwindcss: '^3.4.19' }))).toEqual([
      'default.css',
      'dark.css',
      'tailwind-plugin.ts',
    ]);
  });

  it("adds the Tailwind plugin's test with the components' tests", () => {
    // It covers the plugin in the app's coverage report. Tailwind 4's
    // tailwind.css has no code to cover.
    expect(
      themeFilesFor(project({ tailwindcss: '^3.4.19' }), { tests: true }),
    ).toEqual([
      'default.css',
      'dark.css',
      'tailwind-plugin.ts',
      'tailwind-plugin.test.ts',
    ]);
    expect(
      themeFilesFor(project({ tailwindcss: '^4.3.3' }), { tests: true }),
    ).toEqual(['default.css', 'dark.css', 'tailwind.css']);
  });

  it('lists only files the theme folder has', () => {
    for (const version of ['^3.4.19', '^4.3.3']) {
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

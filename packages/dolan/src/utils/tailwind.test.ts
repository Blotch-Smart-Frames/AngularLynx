import { describe, expect, it, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, type Fixture } from '../test-utils';
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
});

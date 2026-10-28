import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyLockfile,
  hashContent,
  themeBase,
  trackedThemeFiles,
} from './lockfile';
import { shippedTheme as shipped } from './test-utils';

describe('themeBase', () => {
  it('is the hash the lockfile records', () => {
    const lockfile = createEmptyLockfile();
    lockfile.theme['default.css'] = { hash: 'recorded' };

    expect(themeBase(lockfile, 'default.css', shipped('default.css'))).toBe(
      'recorded',
    );
  });

  it.each(['default.css', 'dark.css', 'tailwind-plugin.ts'] as const)(
    "is a release's own hash for the %s an older init copied, which the lockfile has none for",
    (file) => {
      const content = shipped(file);
      expect(themeBase(createEmptyLockfile(), file, content)).toBe(
        hashContent(content),
      );
    },
  );

  it('is null for an edited copy the lockfile has no hash for', () => {
    const edited = `${shipped('default.css')}\npage { --mine: red; }\n`;
    expect(themeBase(createEmptyLockfile(), 'default.css', edited)).toBeNull();
  });

  it('is null for a missing file the lockfile has no hash for', () => {
    expect(themeBase(createEmptyLockfile(), 'default.css', null)).toBeNull();
  });

  it("is null for a file dolan didn't ship", () => {
    expect(
      themeBase(createEmptyLockfile(), 'ocean.css', shipped('default.css')),
    ).toBeNull();
  });
});

describe('trackedThemeFiles', () => {
  let themeDir: string;
  /**
   * A theme folder with these files.
   */
  const theme = (files: Record<string, string>) => {
    themeDir = mkdtempSync(join(tmpdir(), 'dolan-theme-'));
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(themeDir, file), content);
    }
    return themeDir;
  };

  afterEach(() => {
    if (themeDir) rmSync(themeDir, { recursive: true, force: true });
  });

  it('lists the files the lockfile records, on disk or not', () => {
    const lockfile = createEmptyLockfile();
    lockfile.theme['tailwind.css'] = { hash: 'a' };
    lockfile.theme['tailwind-plugin.test.ts'] = { hash: 'b' };

    expect(trackedThemeFiles(lockfile, theme({}))).toEqual([
      'tailwind.css',
      'tailwind-plugin.test.ts',
    ]);
  });

  it("adds the copies an older init didn't record, unless they were edited", () => {
    const dir = theme({
      'default.css': shipped('default.css'),
      'tailwind-plugin.ts': shipped('tailwind-plugin.ts'),
      'dark.css': `${shipped('dark.css')}\npage { --mine: red; }\n`,
    });

    expect(trackedThemeFiles(createEmptyLockfile(), dir)).toEqual([
      'default.css',
      'tailwind-plugin.ts',
    ]);
  });
});

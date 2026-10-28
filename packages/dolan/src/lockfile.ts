import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type FileEntry = {
  hash: string;
};

export type Lockfile = {
  version: number;
  components: Record<string, Record<string, FileEntry>>;
  utils?: Record<string, FileEntry>;
  theme: Record<string, FileEntry>;
};

const LOCKFILE_NAME = 'dolan.lock.json';

/**
 * 16 hex chars = 64-bit prefix of SHA-256. Enough collision resistance for
 * file integrity checks (the probability of a false "no change" detection is
 * 1 in 2^64), while keeping the lockfile compact and human-readable.
 */
export const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
};

export const getLockfilePath = (cwd: string): string => {
  return resolve(cwd, LOCKFILE_NAME);
};

export const lockfileExists = (cwd: string): boolean => {
  return existsSync(getLockfilePath(cwd));
};

export const readLockfile = (cwd: string): Lockfile => {
  const path = getLockfilePath(cwd);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Lockfile;
};

export const createEmptyLockfile = (): Lockfile => ({
  version: 1,
  components: {},
  theme: {},
});

export const writeLockfile = (cwd: string, lockfile: Lockfile): void => {
  const path = getLockfilePath(cwd);
  writeFileSync(path, JSON.stringify(lockfile, null, 2) + '\n');
};

export const getOrCreateLockfile = (cwd: string): Lockfile => {
  if (lockfileExists(cwd)) {
    return readLockfile(cwd);
  }
  return createEmptyLockfile();
};

/**
 * The hash of each theme file as the releases up to 22.2.3 shipped it (22.2.0
 * to 22.2.2 shipped the same theme), taken from each published tarball's
 * `dist/ui/theme`. Their `init` copied the theme but left `"theme": {}` in the
 * lockfile, so `update` had no base for those files and called every one that
 * differed from upstream a conflict, though nobody had touched it.
 *
 * A file whose hash is in this list is a copy a release wrote and nobody has
 * edited since, so that hash is its base. Matching on content, rather than
 * recording the dolan version in the lockfile and looking up what it shipped,
 * is what works for the `dolan.lock.json` those releases wrote: it holds no
 * version, and an app may have skipped releases since. `init` records the
 * theme's hashes now, so the list never grows. It misses a
 * `tailwind-plugin.ts` that `init` reformatted with the app's own oxfmt
 * settings, which stays a conflict.
 */
const SHIPPED_THEME_HASHES: Record<string, readonly string[]> = {
  'default.css': ['6010e930f4314a61', '1fd6a85ec25194af'],
  'dark.css': ['73345d8f2179fd64', '9501105e2a3f44cb'],
  'tailwind-plugin.ts': ['0c4c52d9d2c90630', '4ac232eeeb7056ea'],
};

/**
 * The base `update` merges a theme file against: the hash the lockfile
 * records, else, for a lockfile an older `init` wrote, the hash of the release
 * copy the file still is (see SHIPPED_THEME_HASHES). Null when there's
 * neither, so a file that differs from upstream is a conflict.
 */
export const themeBase = (
  lockfile: Lockfile,
  file: string,
  currentContent: string | null,
): string | null => {
  const stored = lockfile.theme[file]?.hash;
  if (stored) return stored;
  if (currentContent === null) return null;
  const hash = hashContent(currentContent);
  return SHIPPED_THEME_HASHES[file]?.includes(hash) ? hash : null;
};

/**
 * The theme files in `themeDir` that dolan tracks, so each has a base for
 * `update` (see themeBase): the ones the lockfile records, and the ones an
 * older `init` copied without recording them while they're still a release's
 * copy. Most Tailwind 3 apps were set up by those releases, so without the
 * second kind, `update` couldn't tell their plugin was dolan's to delete once
 * they moved to Tailwind 4. A copy that was edited since isn't dolan's to
 * judge, so it's left to the app.
 */
export const trackedThemeFiles = (
  lockfile: Lockfile,
  themeDir: string,
): string[] =>
  [
    ...new Set([
      ...Object.keys(lockfile.theme),
      ...Object.keys(SHIPPED_THEME_HASHES),
    ]),
  ].filter((file) => {
    const path = join(themeDir, file);
    const content = existsSync(path) ? readFileSync(path, 'utf-8') : null;
    return themeBase(lockfile, file, content) !== null;
  });

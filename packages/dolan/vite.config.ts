import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Makes `target` hold exactly the files in `source`, touching only what
 * differs. Several processes run this at once: turbo builds dolan (for the
 * examples' and E2E's `^build`) while dolan's own tests resolve this same
 * config and read `dist/ui`. Emptying `dist/ui` and copying it again, as this
 * used to, left a moment with no files, and a test reading then failed with
 * ENOENT. When nothing changed, as in CI, this writes and deletes nothing; a
 * changed file is written in `scratch` and renamed over its copy, so a reader
 * sees the old file or the new one, never half of it. `scratch` is outside
 * `target` so another process's sync doesn't delete a file mid-copy as one
 * packages/ui doesn't have.
 */
const syncDir = (source: string, target: string, scratch: string): void => {
  mkdirSync(target, { recursive: true });
  const sourceNames = new Set(readdirSync(source));
  for (const name of readdirSync(target)) {
    // A file deleted from packages/ui must leave dist/ui too, or `dolan add`
    // would still copy it. `force`: another process may delete it first.
    if (!sourceNames.has(name)) {
      rmSync(join(target, name), { recursive: true, force: true });
    }
  }
  for (const name of sourceNames) {
    const from = join(source, name);
    const to = join(target, name);
    const isDirectory = statSync(from).isDirectory();
    // A file that became a folder, or the other way round, can't be synced
    // or renamed over in place.
    if (
      statSync(to, { throwIfNoEntry: false })?.isDirectory() === !isDirectory
    ) {
      rmSync(to, { recursive: true, force: true });
    }
    if (isDirectory) {
      syncDir(from, to, scratch);
    } else if (!sameContents(from, to)) {
      mkdirSync(scratch, { recursive: true });
      const temporary = join(scratch, `${process.pid}-${name}`);
      copyFileSync(from, temporary);
      renameSync(temporary, to);
    }
  }
};

const sameContents = (a: string, b: string): boolean => {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
};

const copyUiPlugin = (): Plugin => {
  return {
    name: 'copy-ui',
    configResolved() {
      syncDir(
        resolve(__dirname, '../ui/src/lib'),
        resolve(__dirname, 'dist/ui'),
        resolve(__dirname, 'dist/.ui-sync'),
      );
    },
  };
};

export default defineConfig({
  plugins: [copyUiPlugin()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: [],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts', // commander bin wiring (the CLI entrypoint)
        'src/test-utils.ts', // test-only fixture helper
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

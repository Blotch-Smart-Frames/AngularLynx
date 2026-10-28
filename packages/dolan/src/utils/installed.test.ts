import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyLockfile } from '../lockfile';
import { onTailwind } from '../test-utils';
import {
  componentsOnDisk,
  droppedFiles,
  droppedThemeFiles,
  trackedComponents,
  untrackedComponents,
} from './installed';

let root: string;
const componentsDir = (...folders: string[]) => {
  root = mkdtempSync(join(tmpdir(), 'dolan-installed-'));
  for (const folder of folders) mkdirSync(join(root, folder));
  // A file isn't a component, whatever its name.
  writeFileSync(join(root, 'badge'), '');
  return root;
};

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('componentsOnDisk', () => {
  it('lists the registry components with a folder, sorted', () => {
    const dir = componentsDir('spinner', 'card', 'my-own-thing');
    expect(componentsOnDisk(dir)).toEqual(['card', 'spinner']);
  });

  it('is empty when the directory is missing', () => {
    expect(componentsOnDisk(join(tmpdir(), 'dolan-missing-dir'))).toEqual([]);
  });
});

describe('trackedComponents / untrackedComponents', () => {
  it('splits the components on disk by their lockfile entry', () => {
    const dir = componentsDir('card', 'spinner', 'button');
    const lockfile = createEmptyLockfile();
    lockfile.components['card'] = {};
    lockfile.components['button'] = {};
    // In the lockfile but not on disk: removed by hand, so neither.
    lockfile.components['dialog'] = {};

    expect(trackedComponents(dir, lockfile)).toEqual(['button', 'card']);
    expect(untrackedComponents(dir, lockfile)).toEqual(['spinner']);
  });
});

// Reads the real registry source that the test config copies into dist/ui.
describe('droppedFiles', () => {
  it("lists the tracked files that upstream doesn't ship", () => {
    const lockfile = createEmptyLockfile();
    lockfile.components['button'] = {
      'button.ts': { hash: 'a' },
      'button-old.ts': { hash: 'b' },
      // Shipped, though only a project with the testing library gets it.
      'button.test.ts': { hash: 'c' },
    };

    expect(droppedFiles('button', lockfile)).toEqual(['button-old.ts']);
  });

  it('is empty for a component the lockfile has no entry for', () => {
    expect(droppedFiles('button', createEmptyLockfile())).toEqual([]);
  });
});

describe('droppedThemeFiles', () => {
  /**
   * A project on this Tailwind version, without the testing library.
   */
  const project = (tailwind: 3 | 4) => {
    root = mkdtempSync(join(tmpdir(), 'dolan-installed-'));
    onTailwind(root, tailwind);
    return root;
  };
  /**
   * A lockfile that records every theme file either version takes.
   */
  const lockfile = () => {
    const locked = createEmptyLockfile();
    for (const file of [
      'default.css',
      'dark.css',
      'tailwind.css',
      'tailwind-plugin.ts',
      'tailwind-plugin.test.ts',
    ]) {
      locked.theme[file] = { hash: file };
    }
    return locked;
  };

  it('lists the Tailwind 3 plugin and its test on Tailwind 4', () => {
    const cwd = project(4);
    expect(droppedThemeFiles(cwd, cwd, lockfile())).toEqual([
      'tailwind-plugin.ts',
      'tailwind-plugin.test.ts',
    ]);
  });

  it("lists tailwind.css on Tailwind 3, but not the plugin's test a project without the testing library doesn't get", () => {
    const cwd = project(3);
    expect(droppedThemeFiles(cwd, cwd, lockfile())).toEqual(['tailwind.css']);
  });
});

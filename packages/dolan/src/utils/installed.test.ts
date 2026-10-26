import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyLockfile } from '../lockfile';
import {
  componentsOnDisk,
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

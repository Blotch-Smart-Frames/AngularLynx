import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeIosProject } from './generate-ios-project.ts';

describe('writeIosProject', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ios-project-'));
    dir = path.join(root, 'App.xcodeproj');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const files = {
    'project.pbxproj': 'pbxproj',
    'xcshareddata/xcschemes/App.xcscheme': 'scheme',
  };

  it('writes every rendered file into a project that does not exist yet', () => {
    writeIosProject(dir, files);

    expect(readFileSync(path.join(dir, 'project.pbxproj'), 'utf8')).toBe(
      'pbxproj',
    );
    expect(
      readFileSync(
        path.join(dir, 'xcshareddata/xcschemes/App.xcscheme'),
        'utf8',
      ),
    ).toBe('scheme');
  });

  // Rendering again while the generator copies the template must never take
  // a file away, even for a moment (#963).
  it('leaves an up-to-date file alone rather than writing it again', () => {
    writeIosProject(dir, files);
    const pbxproj = path.join(dir, 'project.pbxproj');
    const before = statSync(pbxproj);

    writeIosProject(dir, files);

    const after = statSync(pbxproj);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('replaces a file whose rendered contents changed, leaving no temporary file', () => {
    writeIosProject(dir, files);

    writeIosProject(dir, { ...files, 'project.pbxproj': 'changed' });

    expect(readFileSync(path.join(dir, 'project.pbxproj'), 'utf8')).toBe(
      'changed',
    );
    expect(readdirSync(dir).sort()).toEqual([
      'project.pbxproj',
      'xcshareddata',
    ]);
  });

  it('removes files the render no longer has, and the folders that leaves empty', () => {
    writeIosProject(dir, files);
    mkdirSync(path.join(dir, 'xcuserdata/me'), { recursive: true });
    writeFileSync(path.join(dir, 'xcuserdata/me/state'), 'x');

    writeIosProject(dir, { 'project.pbxproj': 'pbxproj' });

    expect(readdirSync(dir)).toEqual(['project.pbxproj']);
  });

  it('writes a changed file in the staging folder, never inside the project', () => {
    const staging = path.join(root, 'staging');
    writeIosProject(dir, files, staging);

    writeIosProject(dir, { ...files, 'project.pbxproj': 'changed' }, staging);

    expect(readFileSync(path.join(dir, 'project.pbxproj'), 'utf8')).toBe(
      'changed',
    );
    expect(readdirSync(staging)).toEqual([]);
  });

  // Two renders can run at once on a fresh checkout (Vitest and `vite build`
  // in one turbo run), so pruning must never take away a folder the other is
  // about to write a rendered file into.
  it('keeps a folder of rendered files that only held stale ones', () => {
    mkdirSync(path.join(dir, 'xcshareddata/xcschemes'), { recursive: true });
    writeFileSync(path.join(dir, 'xcshareddata/xcschemes/Old.xcscheme'), 'x');

    writeIosProject(dir, files);

    expect(readdirSync(path.join(dir, 'xcshareddata/xcschemes'))).toEqual([
      'App.xcscheme',
    ]);
  });

  it('accepts a project folder given with a trailing slash', () => {
    writeIosProject(`${dir}/`, files);

    expect(readFileSync(path.join(dir, 'project.pbxproj'), 'utf8')).toBe(
      'pbxproj',
    );
  });
});

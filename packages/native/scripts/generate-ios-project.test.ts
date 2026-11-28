import {
  existsSync,
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

  // Two renders can run at once on a fresh checkout (Vitest and `vite build`
  // in one turbo run), so neither may delete what the other is writing.
  it("keeps another render's temporary file and a folder it has just made", () => {
    writeIosProject(dir, files);
    writeFileSync(path.join(dir, 'project.pbxproj.12345.tmp'), 'partial');
    mkdirSync(path.join(dir, 'project.xcworkspace'));

    writeIosProject(dir, files);

    expect(existsSync(path.join(dir, 'project.pbxproj.12345.tmp'))).toBe(true);
    expect(existsSync(path.join(dir, 'project.xcworkspace'))).toBe(true);
  });
});

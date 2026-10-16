import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { androidGenerator } from './android/project.ts';
import {
  EJECT_MARKER,
  copyBundle,
  prepareProject,
  removeLegacyWorkDir,
} from './generate.ts';
import { iosGenerator } from './ios/project.ts';
import { resolveAppOptions } from './options.ts';

let root: string;
let dist: string;
let workDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-native-'));
  dist = path.join(root, 'dist');
  workDir = path.join(root, '.angular/cache/22.2.2/my-app/lynx-native');
  mkdirSync(path.join(dist, 'static/image'), { recursive: true });
  writeFileSync(path.join(dist, 'main.lynx.bundle'), 'bundle');
  writeFileSync(path.join(dist, 'main.web.bundle'), 'web');
  writeFileSync(path.join(dist, 'static/image/logo.png'), 'png');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const app = (options = {}) =>
  resolveAppOptions(options, { projectName: 'my-app' });

const prepare = (platform: 'ios' | 'android', options = {}) =>
  prepareProject({
    platform,
    generator: platform === 'ios' ? iosGenerator : androidGenerator,
    projectRoot: root,
    workDir,
    app: app(options),
    bundleDir: dist,
    packageVersion: '1.0.0',
  });

describe('prepareProject', () => {
  it('generates the iOS project with the config and the bundle', () => {
    const project = prepare('ios', { appName: 'My App', appId: 'com.a.b' });
    expect(project).toEqual({
      dir: path.join(workDir, 'ios'),
      ejected: false,
      regenerated: true,
    });
    expect(
      readFileSync(path.join(project.dir, 'Config/App.xcconfig'), 'utf8'),
    ).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.a.b');
    expect(
      readFileSync(
        path.join(project.dir, 'LynxBundle/main.lynx.bundle'),
        'utf8',
      ),
    ).toBe('bundle');
    expect(
      existsSync(path.join(project.dir, 'LynxBundle/static/image/logo.png')),
    ).toBe(true);
    // Generated projects are build output, kept out of the user's git.
    expect(readFileSync(path.join(workDir, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('generates the Android project with the config and the bundle', () => {
    const project = prepare('android', { appId: 'com.a.b' });
    expect(
      readFileSync(path.join(project.dir, 'angular-lynx.properties'), 'utf8'),
    ).toContain('applicationId=com.a.b');
    expect(
      readFileSync(
        path.join(project.dir, 'app/src/main/assets/main.lynx.bundle'),
        'utf8',
      ),
    ).toBe('bundle');
  });

  it('reuses the generated project until an input changes', () => {
    prepare('ios');
    const xcconfig = path.join(workDir, 'ios/Config/App.xcconfig');
    writeFileSync(xcconfig, 'edited');
    // Same inputs: the project (and Xcode's incremental state) is kept.
    expect(prepare('ios').regenerated).toBe(false);
    expect(readFileSync(xcconfig, 'utf8')).toBe('edited');
    // A changed option regenerates it.
    expect(prepare('ios', { buildNumber: 2 }).regenerated).toBe(true);
    expect(readFileSync(xcconfig, 'utf8')).toContain(
      'CURRENT_PROJECT_VERSION = 2',
    );
  });

  it('copies a fresh bundle into a reused project', () => {
    prepare('ios');
    writeFileSync(path.join(dist, 'main.lynx.bundle'), 'bundle 2');
    prepare('ios');
    expect(
      readFileSync(
        path.join(workDir, 'ios/LynxBundle/main.lynx.bundle'),
        'utf8',
      ),
    ).toBe('bundle 2');
  });

  it('builds an ejected project as it is', () => {
    const ejected = path.join(root, 'ios');
    mkdirSync(ejected);
    writeFileSync(path.join(ejected, EJECT_MARKER), '');
    expect(prepare('ios')).toEqual({
      dir: ejected,
      ejected: true,
      regenerated: false,
    });
    expect(existsSync(path.join(ejected, 'LynxBundle/main.lynx.bundle'))).toBe(
      true,
    );
    expect(existsSync(workDir)).toBe(false);
  });

  it("doesn't mistake an unrelated ios/ folder for an ejected project", () => {
    mkdirSync(path.join(root, 'ios'));
    expect(prepare('ios').ejected).toBe(false);
  });
});

describe('removeLegacyWorkDir', () => {
  const legacy = () => path.join(root, '.angular-lynx');

  it('removes the folder older versions generated projects into', () => {
    mkdirSync(path.join(legacy(), 'native/ios'), { recursive: true });
    writeFileSync(path.join(legacy(), '.gitignore'), '*\n');
    const log = vi.fn();
    removeLegacyWorkDir(root, log);
    expect(existsSync(legacy())).toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });

  it("leaves an .angular-lynx/ folder it didn't write", () => {
    mkdirSync(legacy());
    writeFileSync(path.join(legacy(), '.gitignore'), 'notes.md\n');
    removeLegacyWorkDir(root, vi.fn());
    expect(existsSync(legacy())).toBe(true);
  });

  it('does nothing without the folder', () => {
    const log = vi.fn();
    removeLegacyWorkDir(root, log);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('copyBundle', () => {
  it('copies the native bundle but not the web bundle or platform output', () => {
    mkdirSync(path.join(dist, 'ios'));
    mkdirSync(path.join(dist, 'android'));
    mkdirSync(path.join(dist, '.rsbuild'));
    const to = path.join(root, 'out');
    mkdirSync(to);
    writeFileSync(path.join(to, 'stale.lynx.bundle'), 'old');
    copyBundle(dist, to);
    expect(
      [
        'main.lynx.bundle',
        'static/image/logo.png',
        'main.web.bundle',
        'ios',
        'android',
        '.rsbuild',
        'stale.lynx.bundle',
      ].map((file) => existsSync(path.join(to, file))),
    ).toEqual([true, true, false, false, false, false, false]);
  });

  it('fails clearly when dist/ has no Lynx bundle', () => {
    rmSync(path.join(dist, 'main.lynx.bundle'));
    expect(() => copyBundle(dist, path.join(root, 'out'))).toThrow(
      /has no main.lynx.bundle/,
    );
  });
});

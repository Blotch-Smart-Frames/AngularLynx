import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectPackageManager,
  installCommand,
  installPackages,
  missingPackages,
  packageName,
} from './packages';

let root: string;
const makeRoot = () => {
  root = mkdtempSync(join(tmpdir(), 'dolan-packages-'));
  return root;
};

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ])('reads %s as %s', (lockfile, manager) => {
    writeFileSync(join(makeRoot(), lockfile), '');
    expect(detectPackageManager(root)).toBe(manager);
  });

  it("finds a workspace root's lockfile above the app", () => {
    writeFileSync(join(makeRoot(), 'pnpm-lock.yaml'), '');
    const app = join(root, 'apps', 'mobile');
    mkdirSync(app, { recursive: true });
    expect(detectPackageManager(app)).toBe('pnpm');
  });

  it('defaults to npm without a lockfile', () => {
    expect(detectPackageManager(makeRoot())).toBe('npm');
  });
});

describe('packageName', () => {
  it('strips the version range, keeping a scope', () => {
    expect(packageName('@tanstack/charts@^1.1.0')).toBe('@tanstack/charts');
    expect(packageName('d3-shape@^3.2.0')).toBe('d3-shape');
    expect(packageName('d3-shape')).toBe('d3-shape');
    expect(packageName('@scope/name')).toBe('@scope/name');
  });
});

describe('missingPackages', () => {
  it("lists specs the project's package.json doesn't name in any section", () => {
    writeFileSync(
      join(makeRoot(), 'package.json'),
      JSON.stringify({
        dependencies: { a: '1' },
        devDependencies: { b: '1' },
        peerDependencies: { c: '1' },
      }),
    );
    expect(missingPackages(root, ['a@^1', 'b', 'c@2', 'd@^4'])).toEqual([
      'd@^4',
    ]);
  });

  it('treats a missing package.json as listing nothing', () => {
    expect(missingPackages(makeRoot(), ['a'])).toEqual(['a']);
  });
});

describe('installCommand', () => {
  it("uses each manager's add verb", () => {
    expect(installCommand('npm', ['a', 'b'])).toEqual([
      'npm',
      'install',
      'a',
      'b',
    ]);
    expect(installCommand('pnpm', ['a'])).toEqual(['pnpm', 'add', 'a']);
    expect(installCommand('yarn', ['a'])).toEqual(['yarn', 'add', 'a']);
    expect(installCommand('bun', ['a'])).toEqual(['bun', 'add', 'a']);
  });
});

describe('installPackages', () => {
  it("runs the project's package manager in the project", () => {
    writeFileSync(join(makeRoot(), 'yarn.lock'), '');
    const run = vi.fn(() => ({ status: 0 }));
    expect(installPackages(root, ['a@1'], run as never)).toBe(true);
    expect(run).toHaveBeenCalledWith('yarn', ['add', 'a@1'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  });

  it("reports an install that failed or couldn't start", () => {
    makeRoot();
    expect(installPackages(root, ['a'], (() => ({ status: 1 })) as never)).toBe(
      false,
    );
    expect(
      installPackages(root, ['a'], (() => ({ status: null })) as never),
    ).toBe(false);
  });
});

import { logging } from '@angular-devkit/core';
import { HostTree, type SchematicContext } from '@angular-devkit/schematics';
import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  denyAngularBuildScripts,
  withAngularBuildsDenied,
} from './pnpm-builds';

/** What a new pnpm app's pnpm-workspace.yaml holds. */
const BLOCK = `# Angular's build tools come with their binaries prebuilt, so their install
# scripts have nothing to do. pnpm fails installs until each script is
# allowed (true) or denied (false).
allowBuilds:
  '@parcel/watcher': false
  esbuild: false
  lmdb: false
  msgpackr-extract: false
`;

describe('denyAngularBuildScripts', () => {
  let tree: UnitTestTree;
  let cwd: string;
  let warnings: string[];

  /**
   * An app whose package.json has this `packageManager` field.
   */
  const app = (packageManager?: string, cli: Record<string, unknown> = {}) => {
    tree.create(
      'package.json',
      JSON.stringify({ name: 'app', packageManager }),
    );
    tree.create(
      'angular.json',
      JSON.stringify({ version: 1, cli, projects: {} }),
    );
  };

  /**
   * Runs the rule, collecting what it warns about.
   */
  const deny = async () => {
    const logger = new logging.Logger('pnpm-builds');
    logger.subscribe((entry) => {
      if (entry.level === 'warn') warnings.push(entry.message);
    });
    // The rule only logs through its context.
    const context: Pick<SchematicContext, 'logger'> = { logger };
    await denyAngularBuildScripts()(tree, context as SchematicContext);
  };

  const workspaceFile = () =>
    tree.exists('pnpm-workspace.yaml')
      ? tree.readText('pnpm-workspace.yaml')
      : undefined;

  /**
   * Puts a `pnpm` on the PATH that prints this version, for the rule to ask
   * when package.json doesn't pin one.
   */
  const installPnpm = (version: string) => {
    const bin = path.join(cwd, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\necho ${version}\n`, {
      mode: 0o755,
    });
    vi.stubEnv('PATH', bin);
  };

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
    // A folder with no pnpm workspace above it, for `ng add` to run in.
    cwd = mkdtempSync(path.join(tmpdir(), 'pnpm-builds-'));
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    // No pnpm unless a test installs one.
    vi.stubEnv('PATH', path.join(cwd, 'no-bin'));
    warnings = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(cwd, { recursive: true, force: true });
  });

  it.each(['pnpm@12.15.0', 'pnpm@11.0.0', 'pnpm@10.26.0'])(
    'writes pnpm-workspace.yaml for an app on %s',
    async (packageManager) => {
      app(packageManager);

      await deny();

      expect(workspaceFile()).toBe(BLOCK);
    },
  );

  it('reads a packageManager field with a hash', async () => {
    app('pnpm@12.17.0+sha512.0123456789abcdef');

    await deny();

    expect(workspaceFile()).toBe(BLOCK);
  });

  it.each(['pnpm@10.25.0', 'pnpm@9.15.9'])(
    'leaves an app on %s alone, which reads no allowBuilds',
    async (packageManager) => {
      app(packageManager);

      await deny();

      expect(workspaceFile()).toBeUndefined();
    },
  );

  it.each(['npm@11.6.0', 'yarn@4.9.0', 'bun@1.3.0'])(
    'leaves an app on %s alone',
    async (packageManager) => {
      app(packageManager);
      tree.create('pnpm-lock.yaml', '');

      await deny();

      expect(workspaceFile()).toBeUndefined();
    },
  );

  it('leaves an app with no sign of pnpm alone', async () => {
    app();
    installPnpm('12.17.0');

    await deny();

    expect(workspaceFile()).toBeUndefined();
  });

  it("asks pnpm for its version when angular.json's cli names it", async () => {
    app(undefined, { packageManager: 'pnpm' });
    installPnpm('12.17.0');

    await deny();

    expect(workspaceFile()).toBe(BLOCK);
  });

  it('asks pnpm for its version when the app has its lockfile', async () => {
    app();
    tree.create('pnpm-lock.yaml', '');
    installPnpm('12.17.0');

    await deny();

    expect(workspaceFile()).toBe(BLOCK);
  });

  it('leaves an app alone whose pnpm reads no allowBuilds', async () => {
    app();
    tree.create('pnpm-lock.yaml', '');
    installPnpm('10.25.0');

    await deny();

    expect(workspaceFile()).toBeUndefined();
  });

  it("leaves a pnpm app alone when pnpm doesn't run", async () => {
    app(undefined, { packageManager: 'pnpm' });

    await deny();

    expect(workspaceFile()).toBeUndefined();
  });

  it("goes by angular.json's cli over a lockfile", async () => {
    app(undefined, { packageManager: 'npm' });
    tree.create('pnpm-lock.yaml', '');

    await deny();

    expect(workspaceFile()).toBeUndefined();
  });

  it('adds allowBuilds to the settings pnpm-workspace.yaml has', async () => {
    app('pnpm@12.15.0');
    tree.create(
      'pnpm-workspace.yaml',
      "minimumReleaseAgeExclude:\n  - '@blotch/dolan@22.2.6'\n",
    );

    await deny();

    expect(workspaceFile()).toBe(
      `minimumReleaseAgeExclude:\n  - '@blotch/dolan@22.2.6'\n\n${BLOCK}`,
    );
  });

  it('edits the pnpm-workspace.yaml of an app that is a pnpm workspace itself', async () => {
    app('pnpm@12.15.0');
    tree.create('pnpm-workspace.yaml', 'packages:\n  - projects/*\n');
    writeFileSync(path.join(cwd, 'pnpm-workspace.yaml'), '');

    await deny();

    expect(workspaceFile()).toBe(`packages:\n  - projects/*\n\n${BLOCK}`);
    expect(warnings).toEqual([]);
  });

  it("only warns about an app in another pnpm workspace's folder", async () => {
    app('pnpm@12.15.0');
    const monorepo = path.join(cwd, 'pnpm-workspace.yaml');
    writeFileSync(monorepo, 'packages:\n  - apps/*\n');
    const appDir = path.join(cwd, 'apps/my-app');
    mkdirSync(appDir, { recursive: true });
    vi.mocked(process.cwd).mockReturnValue(appDir);

    await deny();

    expect(workspaceFile()).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(monorepo);
    expect(warnings[0]).toContain("'@parcel/watcher': false");
  });

  it('warns about an allowBuilds it does not edit, and leaves it', async () => {
    app('pnpm@12.15.0');
    const text = 'allowBuilds: { esbuild: true }\n';
    tree.create('pnpm-workspace.yaml', text);

    await deny();

    expect(workspaceFile()).toBe(text);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('esbuild: false');
  });

  it('changes nothing the second time', async () => {
    app('pnpm@12.15.0');

    await deny();
    await deny();

    expect(workspaceFile()).toBe(BLOCK);
  });
});

describe('withAngularBuildsDenied', () => {
  it('writes the block into an empty file', () => {
    expect(withAngularBuildsDenied('')).toBe(BLOCK);
  });

  it('starts a line after a last line without one', () => {
    expect(withAngularBuildsDenied('linkWorkspacePackages: true')).toBe(
      `linkWorkspacePackages: true\n\n${BLOCK}`,
    );
  });

  it("keeps the app's decisions, settles undecided ones and adds the rest", () => {
    const text = [
      'packages:',
      '  - .',
      'allowBuilds:  # build approvals',
      '    esbuild: true',
      '',
      '    # Undecided, as pnpm leaves them',
      "    lmdb: 'set this to true or false'",
      '    core-js: set this to true or false',
      'overrides:',
      '  foo: 1.0.0',
      '',
    ].join('\n');

    expect(withAngularBuildsDenied(text)).toBe(
      [
        'packages:',
        '  - .',
        'allowBuilds:  # build approvals',
        '    esbuild: true',
        '',
        '    # Undecided, as pnpm leaves them',
        '    lmdb: false',
        '    core-js: false',
        "    '@parcel/watcher': false",
        '    msgpackr-extract: false',
        'overrides:',
        '  foo: 1.0.0',
        '',
      ].join('\n'),
    );
  });

  it('reads quoted keys', () => {
    const text = [
      'allowBuilds:',
      "  '@parcel/watcher': true",
      '  "esbuild": false',
      '  lmdb: false',
      '  msgpackr-extract: false',
      '',
    ].join('\n');

    expect(withAngularBuildsDenied(text)).toBe(text);
  });

  it('adds to an allowBuilds at the end of a file without a last newline', () => {
    expect(withAngularBuildsDenied('allowBuilds:\n  esbuild: true')).toBe(
      [
        'allowBuilds:',
        '  esbuild: true',
        "  '@parcel/watcher': false",
        '  lmdb: false',
        '  msgpackr-extract: false',
      ].join('\n'),
    );
  });

  it('adds to an empty allowBuilds', () => {
    expect(withAngularBuildsDenied('allowBuilds:\nfoo: 1\n')).toBe(
      [
        'allowBuilds:',
        "  '@parcel/watcher': false",
        '  esbuild: false',
        '  lmdb: false',
        '  msgpackr-extract: false',
        'foo: 1',
        '',
      ].join('\n'),
    );
  });

  it('keeps Windows line endings', () => {
    expect(withAngularBuildsDenied('allowBuilds:\r\n  esbuild: true\r\n')).toBe(
      "allowBuilds:\r\n  esbuild: true\r\n  '@parcel/watcher': false\r\n  lmdb: false\r\n  msgpackr-extract: false\r\n",
    );
  });

  it.each(['allowBuilds: { esbuild: true }', 'allowBuilds: {}'])(
    'leaves %s, which it does not edit',
    (text) => {
      expect(withAngularBuildsDenied(text)).toBeUndefined();
    },
  );
});

import {
  SchematicTestRunner,
  type UnitTestTree,
} from '@angular-devkit/schematics/testing';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runner = new SchematicTestRunner(
  '@blotch/angular-lynx',
  path.join(import.meta.dirname, '../collection.json'),
);

// Angular's own schematics, to make the app `ng new` would. The package's
// exports don't list collection.json, so it's found next to package.json.
const angular = new SchematicTestRunner(
  '@schematics/angular',
  path.join(
    path.dirname(
      createRequire(import.meta.url).resolve(
        '@schematics/angular/package.json',
      ),
    ),
    'collection.json',
  ),
);

describe('the ng-add schematic', () => {
  let tree: UnitTestTree;
  let cwd: string;

  /**
   * An app as `ng new` makes it, with this `packageManager` field and any
   * other `ng new` options.
   */
  const ngNew = async (
    packageManager: string,
    options: Record<string, unknown> = {},
  ) => {
    tree = await angular.runSchematic('workspace', {
      name: 'workspace',
      newProjectRoot: 'projects',
      version: '22.2.0',
    });
    tree = await angular.runSchematic(
      'application',
      { name: 'my-app', projectRoot: '', skipInstall: true, ...options },
      tree,
    );
    const pkg = tree.readJson('package.json') as Record<string, unknown>;
    tree.overwrite('package.json', JSON.stringify({ ...pkg, packageManager }));
  };

  const ngAdd = async () => {
    tree = await runner.runSchematic('ng-add', { tailwind: false }, tree);
  };

  beforeEach(() => {
    // A folder with no pnpm workspace above it, for `ng add` to run in.
    cwd = mkdtempSync(path.join(tmpdir(), 'ng-add-'));
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("denies Angular's build scripts in a pnpm app", async () => {
    await ngNew('pnpm@12.15.0');

    await ngAdd();

    expect(tree.readText('pnpm-workspace.yaml')).toContain(
      "allowBuilds:\n  '@parcel/watcher': false\n  esbuild: false\n",
    );
  });

  it('writes no pnpm files into an npm app', async () => {
    await ngNew('npm@11.6.0');

    await ngAdd();

    expect(tree.exists('pnpm-workspace.yaml')).toBe(false);
  });

  it("replaces ng new's spec with one for the Lynx template", async () => {
    await ngNew('npm@11.6.0');
    expect(tree.readText('src/app/app.spec.ts')).toContain(
      "querySelector('h1')",
    );

    await ngAdd();

    // A fresh app keeps a test, or `ng test` fails with "No tests found".
    const spec = tree.readText('src/app/app.spec.ts');
    expect(spec).toContain("import { App } from './app';");
    expect(spec).toContain(
      "expect(compiled.querySelector('text')?.textContent).toContain('my-app');",
    );
    expect(spec).not.toContain('h1');
  });

  it('writes no spec for an app made without tests', async () => {
    await ngNew('npm@11.6.0', { skipTests: true });

    await ngAdd();

    expect(tree.exists('src/app/app.spec.ts')).toBe(false);
  });
});

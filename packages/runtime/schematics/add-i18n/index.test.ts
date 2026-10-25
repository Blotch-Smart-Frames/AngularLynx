import { HostTree } from '@angular-devkit/schematics';
import {
  SchematicTestRunner,
  UnitTestTree,
} from '@angular-devkit/schematics/testing';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const runner = new SchematicTestRunner(
  '@blotch/angular-lynx',
  path.join(import.meta.dirname, '../collection.json'),
);

const LYNX_EXTRACT = '@blotch/angular-lynx-build:extract-i18n';

describe('the add-i18n schematic', () => {
  let tree: UnitTestTree;

  /**
   * An app as `ng add` leaves it, with these extra targets. Its project has
   * no `sourceRoot`, so the schematic falls back to `src`.
   */
  const app = (targets: Record<string, object> = {}) => {
    tree.create(
      'angular.json',
      JSON.stringify({
        version: 1,
        projects: {
          app: {
            root: '',
            projectType: 'application',
            architect: {
              build: {
                builder: '@blotch/angular-lynx-build:application',
                options: { browser: 'src/main.ts' },
              },
              ...targets,
            },
          },
        },
      }),
    );
  };

  /**
   * Runs add-i18n, and returns the project's `extract-i18n` target.
   */
  const addI18n = async () => {
    tree = await runner.runSchematic('add-i18n', {}, tree);
    return (
      tree.readJson('angular.json') as {
        projects: { app: { architect: Record<string, unknown> } };
      }
    ).projects.app.architect['extract-i18n'];
  };

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
    tree.create(
      'package.json',
      JSON.stringify({ dependencies: { '@angular/core': '^22.2.0' } }),
    );
  });

  it('adds an extract-i18n target that writes JSON for loadTranslations() to src/locale', async () => {
    app();

    expect(await addI18n()).toEqual({
      builder: LYNX_EXTRACT,
      options: { format: 'json', outputPath: 'src/locale' },
    });
  });

  it('sets JSON in src/locale on the target `ng add` wrote', async () => {
    app({ 'extract-i18n': { builder: LYNX_EXTRACT } });

    expect(await addI18n()).toEqual({
      builder: LYNX_EXTRACT,
      options: { format: 'json', outputPath: 'src/locale' },
    });
  });

  it("keeps the options the app's target sets, switching Angular's builder to the Lynx one", async () => {
    app({
      'extract-i18n': {
        builder: '@angular/build:extract-i18n',
        options: { format: 'xlf2' },
      },
    });

    expect(await addI18n()).toEqual({
      builder: LYNX_EXTRACT,
      options: { format: 'xlf2', outputPath: 'src/locale' },
    });
  });

  it('changes nothing when it runs again', async () => {
    app();
    await addI18n();
    const angularJson = tree.readText('angular.json');

    await addI18n();

    expect(tree.readText('angular.json')).toBe(angularJson);
  });
});

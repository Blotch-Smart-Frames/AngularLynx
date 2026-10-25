import { HostTree } from '@angular-devkit/schematics';
import {
  SchematicTestRunner,
  UnitTestTree,
} from '@angular-devkit/schematics/testing';
import path from 'node:path';
import { lastValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import migration from './index';

const runner = new SchematicTestRunner(
  'migrations',
  path.join(import.meta.dirname, '../../migrations.json'),
);

const LYNX_BUILD = { builder: '@blotch/angular-lynx-build:application' };
const LYNX_EXTRACT = '@blotch/angular-lynx-build:extract-i18n';

describe('the extract-i18n-target migration', () => {
  let tree: UnitTestTree;

  /**
   * An angular.json with these projects.
   */
  const workspace = (projects: Record<string, object>) =>
    tree.create('angular.json', JSON.stringify({ version: 1, projects }));

  /**
   * Runs the migration on the tree, and returns the projects' targets.
   */
  const migrate = async () => {
    await lastValueFrom(runner.callRule(migration(), tree));
    const { projects } = tree.readJson('angular.json') as {
      projects: Record<string, { architect: Record<string, unknown> }>;
    };
    return Object.fromEntries(
      Object.entries(projects).map(([name, project]) => [
        name,
        project.architect,
      ]),
    );
  };

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
  });

  it("gives an app without i18n the target `ng add` writes, with Angular's defaults", async () => {
    workspace({
      app: {
        root: '',
        projectType: 'application',
        architect: { build: LYNX_BUILD },
      },
    });

    expect((await migrate())['app']!['extract-i18n']).toEqual({
      builder: LYNX_EXTRACT,
    });
  });

  it('gives an app with i18n the target add-i18n writes, in its source root', async () => {
    workspace({
      app: {
        root: '',
        projectType: 'application',
        i18n: { sourceLocale: 'en-US' },
        architect: { build: LYNX_BUILD },
      },
      other: {
        root: 'projects/other',
        sourceRoot: 'projects/other/source',
        projectType: 'application',
        i18n: { sourceLocale: 'fr' },
        architect: { build: LYNX_BUILD },
      },
    });

    const targets = await migrate();

    expect(targets['app']!['extract-i18n']).toEqual({
      builder: LYNX_EXTRACT,
      options: { format: 'json', outputPath: 'src/locale' },
    });
    expect(targets['other']!['extract-i18n']).toEqual({
      builder: LYNX_EXTRACT,
      options: { format: 'json', outputPath: 'projects/other/source/locale' },
    });
  });

  it("switches a target of Angular's to the Lynx builder and leaves its options as they are", async () => {
    const options = { outFile: 'source.xlf' };
    workspace({
      app: {
        root: '',
        projectType: 'application',
        i18n: { sourceLocale: 'en-US' },
        architect: {
          build: LYNX_BUILD,
          'extract-i18n': { builder: '@angular/build:extract-i18n', options },
        },
      },
      other: {
        root: 'projects/other',
        projectType: 'application',
        i18n: { sourceLocale: 'en-US' },
        architect: {
          build: LYNX_BUILD,
          'extract-i18n': {
            builder: '@angular-devkit/build-angular:extract-i18n',
          },
        },
      },
    });

    const targets = await migrate();

    expect(targets['app']!['extract-i18n']).toEqual({
      builder: LYNX_EXTRACT,
      options,
    });
    expect(targets['other']!['extract-i18n']).toEqual({
      builder: LYNX_EXTRACT,
    });
  });

  it("leaves another extractor, and a project that isn't built for Lynx, alone", async () => {
    const custom = { builder: 'my-extractor:extract' };
    const web = { build: { builder: '@angular/build:application' } };
    workspace({
      app: {
        root: '',
        projectType: 'application',
        architect: { build: LYNX_BUILD, 'extract-i18n': custom },
      },
      web: { root: 'projects/web', projectType: 'application', architect: web },
    });

    const targets = await migrate();

    expect(targets['app']!['extract-i18n']).toEqual(custom);
    expect(targets['web']).toEqual(web);
  });
});

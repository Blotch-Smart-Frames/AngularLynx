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

describe('the accessibility-traits migration', () => {
  let tree: UnitTestTree;

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
    tree.create(
      'angular.json',
      JSON.stringify({
        version: 1,
        projects: {
          app: { root: '', projectType: 'application' },
          other: { root: 'projects/other', projectType: 'application' },
        },
      }),
    );
  });

  /**
   * Runs the migration on the tree.
   */
  const migrate = () => lastValueFrom(runner.callRule(migration(), tree));

  it('renames static attributes and bindings in .html templates', async () => {
    tree.create(
      'src/app/card.html',
      `<view accessibility-element accessibility-trait="button"></view>
<image [accessibility-trait]="trait()" />
<text [attr.accessibility-trait]="'header'"></text>`,
    );

    await migrate();

    expect(tree.readText('src/app/card.html')).toBe(
      `<view accessibility-element accessibility-traits="button"></view>
<image [accessibility-traits]="trait()" />
<text [attr.accessibility-traits]="'header'"></text>`,
    );
  });

  it("renames inline templates in a project's .ts files", async () => {
    tree.create(
      'projects/other/src/app.ts',
      '@Component({ template: \'<view accessibility-trait="image"></view>\' })\nexport class App {}\n',
    );

    await migrate();

    expect(tree.readText('projects/other/src/app.ts')).toBe(
      '@Component({ template: \'<view accessibility-traits="image"></view>\' })\nexport class App {}\n',
    );
  });

  it('leaves the plural and longer names alone', async () => {
    const text =
      '<view accessibility-traits="button" data-accessibility-trait-x="1"></view>';
    tree.create('src/app/ok.html', text);

    await migrate();

    expect(tree.readText('src/app/ok.html')).toBe(text);
  });

  it('skips dependencies, build output, dot folders and declarations', async () => {
    const text = '<view accessibility-trait="button"></view>';
    const skipped = [
      'node_modules/lib/card.html',
      'dist/app/card.html',
      '.angular/cache/card.html',
      'src/types.d.ts',
      'src/notes.md',
    ];
    for (const file of skipped) tree.create(file, text);

    await migrate();

    for (const file of skipped) expect(tree.readText(file)).toBe(text);
  });
});

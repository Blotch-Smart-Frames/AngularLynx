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

const ENTRY = "\n# LynxLogger's output while `ng serve` runs\n.dev-logs\n";

describe('the dev-logs-gitignore migration', () => {
  let tree: UnitTestTree;

  /**
   * Runs the migration on the tree.
   */
  const migrate = () => lastValueFrom(runner.callRule(migration(), tree));

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
  });

  it('adds .dev-logs to the end of .gitignore', async () => {
    tree.create('.gitignore', '/node_modules\n.DS_Store\n');

    await migrate();

    expect(tree.readText('.gitignore')).toBe(
      `/node_modules\n.DS_Store\n${ENTRY}`,
    );
  });

  it('starts a new line after a last line without one', async () => {
    tree.create('.gitignore', '/node_modules');

    await migrate();

    expect(tree.readText('.gitignore')).toBe(`/node_modules\n${ENTRY}`);
  });

  it.each(['.dev-logs', '/.dev-logs', '/.dev-logs/'])(
    'leaves a .gitignore that lists %s alone',
    async (line) => {
      const text = `/node_modules\n${line}\n.DS_Store\n`;
      tree.create('.gitignore', text);

      await migrate();

      expect(tree.readText('.gitignore')).toBe(text);
    },
  );

  it('adds no .gitignore to a workspace without one', async () => {
    await migrate();

    expect(tree.exists('.gitignore')).toBe(false);
  });
});

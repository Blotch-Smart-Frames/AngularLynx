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

/**
 * A Tailwind config with the given `content` line.
 */
const config = (content: string): string =>
  `import preset from '@lynx-js/tailwind-preset';\n\nexport default {\n  ${content}\n  presets: [preset],\n};\n`;

describe('the tailwind-html-templates migration', () => {
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

  it('adds .html to the glob the schematics wrote', async () => {
    tree.create('tailwind.config.ts', config("content: ['./src/**/*.ts'],"));

    await lastValueFrom(runner.callRule(migration(), tree));

    expect(tree.readText('tailwind.config.ts')).toBe(
      config("content: ['./src/**/*.{html,ts}'],"),
    );
  });

  it("updates a project's config and keeps double quotes", async () => {
    tree.create(
      'projects/other/tailwind.config.js',
      config('content: ["./src/**/*.ts"],'),
    );

    await lastValueFrom(runner.callRule(migration(), tree));

    expect(tree.readText('projects/other/tailwind.config.js')).toBe(
      config('content: ["./src/**/*.{html,ts}"],'),
    );
  });

  it('leaves a glob the app changed alone', async () => {
    const changed = config(
      "content: ['./src/**/*.{ts,html}', './lib/**/*.ts'],",
    );
    tree.create('tailwind.config.ts', changed);

    await lastValueFrom(runner.callRule(migration(), tree));

    expect(tree.readText('tailwind.config.ts')).toBe(changed);
  });

  it('does nothing without a Tailwind config', async () => {
    await lastValueFrom(runner.callRule(migration(), tree));

    expect(tree.files).toEqual(['/angular.json']);
  });
});

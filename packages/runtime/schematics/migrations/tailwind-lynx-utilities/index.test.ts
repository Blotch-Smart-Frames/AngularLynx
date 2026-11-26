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

/** The stylesheet `ng add` wrote before this migration. */
const OLD_STYLESHEET = `@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);

/* The theme. */
@import './styles/default.css';
`;

describe('the tailwind-lynx-utilities migration', () => {
  let tree: UnitTestTree;

  /**
   * A workspace with one app at the root, and the build's styles.
   */
  const workspace = (styles?: unknown[]) =>
    tree.create(
      'angular.json',
      JSON.stringify({
        version: 1,
        projects: {
          app: {
            root: '',
            sourceRoot: 'src',
            projectType: 'application',
            architect: styles
              ? { build: { builder: 'x', options: { styles } } }
              : {},
          },
          other: { root: 'projects/other', projectType: 'application' },
        },
      }),
    );

  const migrate = () => lastValueFrom(runner.callRule(migration(), tree));

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
  });

  it("imports Lynx's utilities after Tailwind's, once", async () => {
    workspace();
    tree.create('src/styles.css', OLD_STYLESHEET);

    await migrate();
    await migrate();

    expect(tree.readText('src/styles.css')).toBe(
      OLD_STYLESHEET.replace(
        'layer(utilities);\n',
        "layer(utilities);\n@import '@blotch/angular-lynx/tailwind.css';\n",
      ),
    );
  });

  it("follows Angular CLI's import, in a stylesheet the build lists", async () => {
    workspace([{ input: 'src/theme/app.css' }, 'src/other.scss']);
    tree.create('src/theme/app.css', '@import "tailwindcss";\n.a { b: c; }\n');

    await migrate();

    expect(tree.readText('src/theme/app.css')).toBe(
      '@import "tailwindcss";\n@import \'@blotch/angular-lynx/tailwind.css\';\n.a { b: c; }\n',
    );
  });

  it("finds a project's stylesheet without a sourceRoot", async () => {
    workspace();
    tree.create('projects/other/src/tailwind.css', OLD_STYLESHEET);

    await migrate();

    expect(tree.readText('projects/other/src/tailwind.css')).toContain(
      "@import '@blotch/angular-lynx/tailwind.css';",
    );
  });

  it('leaves Tailwind 3 and stylesheets without Tailwind alone', async () => {
    workspace(['src/plain.css']);
    tree.create('src/styles.css', '@tailwind base;\n@tailwind utilities;\n');
    tree.create('src/plain.css', '.a { b: c; }\n');

    await migrate();

    expect(tree.readText('src/styles.css')).toBe(
      '@tailwind base;\n@tailwind utilities;\n',
    );
    expect(tree.readText('src/plain.css')).toBe('.a { b: c; }\n');
  });
});

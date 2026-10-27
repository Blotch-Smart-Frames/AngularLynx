import { HostTree } from '@angular-devkit/schematics';
import {
  SchematicTestRunner,
  UnitTestTree,
} from '@angular-devkit/schematics/testing';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { TAILWIND_4_STYLESHEET } from '../utility/tailwind';

const runner = new SchematicTestRunner(
  '@blotch/angular-lynx',
  path.join(import.meta.dirname, '../collection.json'),
);

describe('the add-tailwind schematic', () => {
  let tree: UnitTestTree;

  /**
   * An app as `ng add` leaves it, with these package.json dependencies.
   */
  const app = (
    devDependencies: Record<string, string> = {},
    project: Record<string, unknown> = {},
  ) => {
    tree.create(
      'package.json',
      JSON.stringify({
        dependencies: { '@angular/core': '^22.2.0' },
        devDependencies,
      }),
    );
    tree.create(
      'angular.json',
      JSON.stringify({
        version: 1,
        projects: {
          app: {
            root: '',
            sourceRoot: 'src',
            projectType: 'application',
            architect: {
              build: {
                builder: '@blotch/angular-lynx-build:application',
                options: { browser: 'src/main.ts', styles: ['src/styles.css'] },
              },
            },
            ...project,
          },
        },
      }),
    );
  };

  const addTailwind = async (options: Record<string, unknown> = {}) => {
    tree = await runner.runSchematic('add-tailwind', options, tree);
  };

  /**
   * The options of the app's build target.
   */
  const buildOptions = () =>
    (
      tree.readJson('angular.json') as {
        projects: {
          app: {
            architect: { build: { options: Record<string, unknown> } };
          };
        };
      }
    ).projects.app.architect.build.options;

  const devDependencies = () =>
    (tree.readJson('package.json') as { devDependencies: object })
      .devDependencies;

  beforeEach(() => {
    tree = new UnitTestTree(new HostTree());
  });

  describe('Tailwind 4', () => {
    it('sets Tailwind 4 up as Angular CLI does, without Preflight', async () => {
      app();
      tree.create('src/styles.css', '/* mine */');

      await addTailwind();

      expect(tree.readText('src/styles.css')).toBe(TAILWIND_4_STYLESHEET);
      expect(tree.readJson('.postcssrc.json')).toEqual({
        plugins: { '@tailwindcss/postcss': {} },
      });
      expect(devDependencies()).toEqual({
        '@tailwindcss/postcss': '^4.3.3',
        tailwindcss: '^4.3.3',
      });
      expect(tree.exists('tailwind.config.ts')).toBe(false);
    });

    it("keeps the version of an app that `ng new --style=tailwind` made, and its PostCSS config's other plugins", async () => {
      app({ tailwindcss: '^4.1.12', '@tailwindcss/postcss': '^4.1.12' });
      tree.create('src/styles.css', "@import 'tailwindcss';\n");
      tree.create(
        'postcss.config.json',
        JSON.stringify({ plugins: { autoprefixer: {} } }),
      );

      await addTailwind();

      expect(tree.readText('src/styles.css')).toBe(TAILWIND_4_STYLESHEET);
      expect(tree.readJson('postcss.config.json')).toEqual({
        plugins: { autoprefixer: {}, '@tailwindcss/postcss': {} },
      });
      expect(tree.exists('.postcssrc.json')).toBe(false);
      expect(devDependencies()).toEqual({
        tailwindcss: '^4.1.12',
        '@tailwindcss/postcss': '^4.1.12',
      });
    });

    it('moves a Tailwind 3 app to Tailwind 4 when asked, and warns about its config', async () => {
      app({ tailwindcss: '^3.4.19', '@lynx-js/tailwind-preset': '^0.6.0' });
      tree.create('tailwind.config.ts', 'export default {};');
      const warnings: string[] = [];
      runner.logger.subscribe((entry) => {
        if (entry.level === 'warn') {
          warnings.push(entry.message);
        }
      });

      await addTailwind({ tailwindVersion: '4' });

      expect(devDependencies()).toMatchObject({ tailwindcss: '^4.3.3' });
      expect(warnings).toContainEqual(
        expect.stringContaining(
          "Tailwind CSS 4 doesn't read tailwind.config.ts",
        ),
      );
    });

    it('writes tailwind.css for a Sass app, as Angular CLI does', async () => {
      app();
      tree.create('src/styles.scss', '$x: 1;');

      await addTailwind();

      expect(tree.readText('src/styles.scss')).toBe('$x: 1;');
      expect(tree.readText('src/tailwind.css')).toBe(TAILWIND_4_STYLESHEET);
      expect(buildOptions()).toEqual({
        browser: 'src/main.ts',
        styles: ['src/tailwind.css', 'src/styles.css'],
      });

      // Again, which adds it once.
      await addTailwind();
      expect(buildOptions()['styles']).toEqual([
        'src/tailwind.css',
        'src/styles.css',
      ]);
    });

    it('adds the styles option to a build target without one', async () => {
      app();
      tree.overwrite(
        'angular.json',
        JSON.stringify({
          version: 1,
          projects: {
            app: {
              root: 'projects/app',
              projectType: 'application',
              architect: { build: { builder: 'x' }, test: { builder: 'y' } },
            },
          },
        }),
      );
      tree.create('projects/app/src/styles.scss', '');

      await addTailwind({ project: 'app' });

      expect(tree.exists('projects/app/.postcssrc.json')).toBe(true);
      expect(buildOptions()).toEqual({
        styles: ['projects/app/src/tailwind.css'],
      });
    });

    it('writes tailwind.css even for a Sass app without a build target', async () => {
      app({}, { architect: {} });
      tree.create('src/styles.scss', '');

      await addTailwind();

      expect(tree.readText('src/tailwind.css')).toBe(TAILWIND_4_STYLESHEET);
    });

    it('changes nothing when it runs again', async () => {
      app();
      await addTailwind();
      const files = ['src/styles.css', '.postcssrc.json', 'package.json'].map(
        (file) => tree.readText(file),
      );

      await addTailwind();

      expect(
        ['src/styles.css', '.postcssrc.json', 'package.json'].map((file) =>
          tree.readText(file),
        ),
      ).toEqual(files);
    });
  });

  describe('Tailwind 3', () => {
    it('keeps an app on Tailwind 3 with the Lynx preset', async () => {
      app({ tailwindcss: '~3.4.0' });

      await addTailwind();

      expect(tree.readText('tailwind.config.ts')).toContain(
        "import preset from '@lynx-js/tailwind-preset';",
      );
      expect(tree.readText('src/styles.css')).toBe(
        '@tailwind base;\n@tailwind utilities;\n',
      );
      expect(tree.exists('.postcssrc.json')).toBe(false);
      expect(devDependencies()).toEqual({
        tailwindcss: '^3.4.19',
        '@lynx-js/tailwind-preset': '^0.6.0',
      });
    });

    it('sets Tailwind 3 up when asked, into styles.scss if the app has one', async () => {
      app();
      tree.create('src/styles.scss', '$x: 1;');
      tree.create('tailwind.config.ts', 'old');

      await addTailwind({ tailwindVersion: 3 });

      expect(tree.readText('src/styles.scss')).toBe(
        '@tailwind base;\n@tailwind utilities;\n',
      );
      expect(tree.readText('tailwind.config.ts')).not.toBe('old');
    });
  });

  it('fails without a project', async () => {
    tree.create('angular.json', JSON.stringify({ version: 1, projects: {} }));

    await expect(addTailwind()).rejects.toThrow('No project found');
    await expect(addTailwind({ project: 'nope' })).rejects.toThrow(
      'Project "nope" not found',
    );
  });
});

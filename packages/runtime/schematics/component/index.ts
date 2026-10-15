import { strings } from '@angular-devkit/core';
import {
  type Rule,
  type Tree,
  chain,
  externalSchematic,
} from '@angular-devkit/schematics';

import type { Schema } from './schema';

/**
 * `ng generate component` for Lynx (`ng add` makes it the one
 * `ng generate component` runs). Angular's own component schematic generates
 * the files, so every option, file name and angular.json default works as it
 * does in any Angular app. Then the component becomes a Lynx one:
 *
 *   1. **Its template uses Lynx elements**: `<view><text>…</text></view>`
 *      instead of `<p>…</p>`, which Lynx has no element for.
 *   2. **It imports LYNX_ELEMENTS**, the directives that declare Lynx's
 *      elements to Angular, so the template type-checks in the editor and
 *      under `ng test`, as it does in the app build.
 *   3. **Its test renders it on Lynx** when the project has
 *      @blotch/angular-lynx-testing-library: a `*.test.ts` that renders the
 *      component through the Lynx renderer, in place of Angular's TestBed
 *      spec, which renders it with the DOM renderer. Without the library,
 *      Angular's spec stays: `ng test` runs both.
 */
export default (options: Schema): Rule =>
  async (tree: Tree) => {
    const before = createdFiles(tree);
    return chain([
      externalSchematic(
        '@schematics/angular',
        'component',
        withoutUnset(options),
      ),
      (tree: Tree) => {
        const created = [...createdFiles(tree)].filter(
          (file) => !before.has(file),
        );
        const componentFile = created.find(
          (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
        );
        if (!componentFile) {
          return;
        }
        for (const file of created) {
          if (file.endsWith('.html')) {
            tree.overwrite(file, lynxTemplate(tree.readText(file)));
          }
        }
        tree.overwrite(
          componentFile,
          lynxComponent(tree.readText(componentFile)),
        );
        const specFile = created.find((file) => file.endsWith('.spec.ts'));
        if (specFile && hasTestingLibrary(tree)) {
          tree.delete(specFile);
          tree.create(
            specFile.replace(/\.spec\.ts$/, '.test.ts'),
            lynxTest(tree.readText(componentFile), componentFile, options.name),
          );
        }
      },
    ]);
  };

/**
 * The options the user (or angular.json's defaults for this schematic) set.
 * Leaving the rest out lets Angular CLI apply angular.json's defaults for
 * `@schematics/angular:component` (e.g. `style: scss` from
 * `ng new --style scss`), then Angular's own, as `ng generate component`
 * does without AngularLynx.
 */
const withoutUnset = (options: Schema): Schema =>
  Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as Schema;

/**
 * The files created so far in this run.
 */
const createdFiles = (tree: Tree): Set<string> =>
  new Set(
    tree.actions
      .filter((action) => action.kind === 'c')
      .map((action) => action.path),
  );

/**
 * Angular's placeholder paragraph (`<p>name works!</p>`, in a template file
 * or inline), as Lynx elements. Lynx has no `<p>`: text goes in `<text>`,
 * inside a `<view>` for layout.
 */
const lynxTemplate = (source: string): string =>
  source.replace(
    /^([ \t]*)<p>\s*([\s\S]*?)\s*<\/p>/m,
    (_match, indent: string, text: string) =>
      `${indent}<view>\n${indent}  <text>${text}</text>\n${indent}</view>`,
  );

/**
 * The generated component, with a Lynx template if it's inline, and
 * LYNX_ELEMENTS among its imports. A component declared in an NgModule
 * (`--standalone false`) has no `imports` of its own; its module would import
 * them, so it's left as Angular generates it.
 */
const lynxComponent = (source: string): string => {
  const component = lynxTemplate(source);
  if (!/^\s*imports: \[\],$/m.test(component)) {
    return component;
  }
  return component
    .replace(/^(\s*)imports: \[\],$/m, '$1imports: [LYNX_ELEMENTS],')
    .replace(
      /^(import .* from '@angular\/core';)$/m,
      "$1\nimport { LYNX_ELEMENTS } from '@blotch/angular-lynx';",
    );
};

const hasTestingLibrary = (tree: Tree): boolean => {
  if (!tree.exists('/package.json')) {
    return false;
  }
  const packageJson = tree.readJson('/package.json') as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [packageJson.dependencies, packageJson.devDependencies].some(
    (dependencies) =>
      dependencies?.['@blotch/angular-lynx-testing-library'] !== undefined,
  );
};

/**
 * A test that renders the component on Lynx with the testing library and
 * finds its placeholder text, in place of Angular's TestBed spec.
 */
const lynxTest = (
  component: string,
  componentFile: string,
  name: string,
): string => {
  const className = /export (?:default )?class (\w+)/.exec(component)![1]!;
  const isDefault = /export default class/.test(component);
  const importPath = `./${componentFile.split('/').pop()!.replace(/\.ts$/, '')}`;
  // The text Angular's template says: the name's last segment, dasherized.
  const text = `${strings.dasherize(name.split('/').pop()!)} works!`;
  return `import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';

import ${isDefault ? className : `{ ${className} }`} from '${importPath}';

describe('${className}', () => {
  it('should render', async () => {
    const { getByText } = await render(${className});
    expect(getByText('${text}')).toBeTruthy();
  });
});
`;
};

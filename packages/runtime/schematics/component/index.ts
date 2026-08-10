import {
  type Rule,
  type Tree,
  SchematicsException,
} from '@angular-devkit/schematics';
import { getWorkspace } from '@schematics/angular/utility/workspace';

import type { Schema } from './schema';

/**
 * Generates a Lynx-flavored Angular component (standalone, OnPush, signal-based)
 * along with optional template/style/spec files. This is the AngularLynx
 * equivalent of `ng generate component`, but it differs in three important
 * ways:
 *
 *   1. **Template uses Lynx elements** — the boilerplate template renders
 *      `<view><text>...</text></view>` instead of `<div><p>...`. LYNX_ELEMENTS
 *      is imported automatically so the elements type-check.
 *   2. **OnPush + zoneless** — Lynx apps run zoneless, so default change
 *      detection would never tick. OnPush + signals is the only safe pattern.
 *   3. **Vitest spec, not Karma** — Karma launches a browser and can't host
 *      the Lynx runtime; the testing-library spec template runs under Vitest
 *      with `@blotch/angular-lynx-testing-library` providing PAPI polyfills.
 */
export default (options: Schema): Rule =>
  async (tree: Tree) => {
    const workspace = await getWorkspace(tree);
    const projectName =
      options.project ??
      (workspace.extensions['defaultProject'] as string | undefined) ??
      [...workspace.projects.keys()][0];

    if (!projectName) {
      throw new SchematicsException(
        'No project found. Run this schematic inside an Angular workspace.',
      );
    }

    const project = workspace.projects.get(projectName);
    if (!project) {
      throw new SchematicsException(
        `Project "${projectName}" not found in angular.json.`,
      );
    }

    const sourceRoot = (project.sourceRoot ?? `${project.root}/src`) as string;
    const prefix =
      options.prefix ?? (project.extensions['prefix'] as string) ?? 'app';

    // Split a slash-bearing name like "forms/inputs/my-button" into
    //   componentName     = "my-button"  (the actual component identifier)
    //   additionalPath    = "forms/inputs" (intermediate directories to nest in)
    // This lets users colocate generated components with their feature folder
    // in a single `ng generate` invocation instead of cd-ing or passing --path.
    const nameParts = options.name.split('/');
    const componentName = nameParts[nameParts.length - 1];
    const additionalPath = nameParts.slice(0, -1).join('/');

    const dasherized = dasherize(componentName);
    const classified = classify(componentName);
    const selector = `${prefix}-${dasherized}`;

    // --flat means "put the files directly in the parent directory", matching
    // Angular's own --flat. Otherwise create a wrapping folder named after
    // the dasherized component so each component has its own directory for
    // template, styles, spec, and any future per-component assets.
    const basePath = options.path ?? 'app';
    const dirPath = options.flat
      ? `${sourceRoot}/${basePath}${additionalPath ? '/' + additionalPath : ''}`
      : `${sourceRoot}/${basePath}${additionalPath ? '/' + additionalPath : ''}/${dasherized}`;

    const componentPath = `${dirPath}/${dasherized}.ts`;

    if (tree.exists(componentPath)) {
      // Hard fail rather than overwrite — Schematics has no "force" semantics
      // for component generation and silently overwriting user code would be
      // dangerous. The user can `rm` and re-run if they really want to.
      throw new SchematicsException(
        `Component file already exists: ${componentPath}`,
      );
    }

    const componentContent = buildComponentFile(
      selector,
      classified,
      dasherized,
      options,
    );
    tree.create(componentPath, componentContent);

    if (!options.inlineTemplate) {
      const templatePath = `${dirPath}/${dasherized}.html`;
      tree.create(templatePath, buildTemplateFile(dasherized));
    }

    if (!options.inlineStyle) {
      const stylePath = `${dirPath}/${dasherized}.css`;
      tree.create(stylePath, buildStyleFile());
    }

    if (!options.skipTests) {
      const specPath = `${dirPath}/${dasherized}.spec.ts`;
      tree.create(specPath, buildSpecFile(classified, dasherized));
    }
  };

const buildComponentFile = (
  selector: string,
  className: string,
  dasherized: string,
  options: Schema,
): string => {
  const lines: string[] = [];

  lines.push(
    `import { Component, ChangeDetectionStrategy } from '@angular/core';`,
  );
  lines.push(`import { LYNX_ELEMENTS } from '@blotch/angular-lynx';`);
  lines.push('');
  lines.push(`@Component({`);
  lines.push(`  selector: '${selector}',`);
  lines.push(`  imports: [LYNX_ELEMENTS],`);
  lines.push(`  changeDetection: ChangeDetectionStrategy.OnPush,`);

  // `!== false` means the template is inlined by default (when the option
  // is true or undefined). This matches Lynx's convention of keeping the
  // template in the same file since Lynx components rarely have large templates.
  if (options.inlineTemplate !== false) {
    lines.push(`  template: \``);
    lines.push(`    <view>`);
    lines.push(`      <text>${dasherized} works!</text>`);
    lines.push(`    </view>`);
    lines.push(`  \`,`);
  } else {
    lines.push(`  templateUrl: './${dasherized}.html',`);
  }

  if (options.inlineStyle !== false) {
    lines.push(`  styles: [\`\`],`);
  } else {
    lines.push(`  styleUrl: './${dasherized}.css',`);
  }

  lines.push(`})`);
  lines.push(`export class ${className} {}`);
  lines.push('');

  return lines.join('\n');
};

const buildTemplateFile = (dasherized: string): string => {
  return `<view>
  <text>${dasherized} works!</text>
</view>
`;
};

const buildStyleFile = (): string => {
  return '';
};

const buildSpecFile = (className: string, dasherized: string): string => {
  return `import { describe, expect, it } from 'vitest';
import { render } from '@blotch/angular-lynx-testing-library';

import { ${className} } from './${dasherized}';

describe('${className}', () => {
  it('should render', async () => {
    const { getByText } = await render(${className});
    expect(getByText('${dasherized} works!')).toBeTruthy();
  });
});
`;
};

/**
 * Converts "myComponent" or "MyComponent" to "my-component"
 */
const dasherize = (str: string): string => {
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
};

/**
 * Converts "my-component" to "MyComponent" (PascalCase)
 */
const classify = (str: string): string => {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
};

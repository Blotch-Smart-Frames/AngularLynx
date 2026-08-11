import {
  type Rule,
  type Tree,
  chain,
  SchematicsException,
} from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  InstallBehavior,
} from '@schematics/angular/utility/dependency';
import { getWorkspace } from '@schematics/angular/utility/workspace';

import type { Schema } from './schema';
import { VERSIONS } from '../ng-add/versions';

/**
 * Adds Tailwind CSS to an existing AngularLynx project. This is split out
 * from `ng-add` because users may opt out of Tailwind at scaffold time
 * (`ng add @blotch/angular-lynx --tailwind=false`) but later change their
 * minds — running this schematic later is the supported recovery path.
 *
 * Three steps, each idempotent:
 *   1. **tailwind.config.ts** — written with `@lynx-js/tailwind-preset` as
 *      the only preset. The preset narrows Tailwind's class output to the
 *      subset Lynx's CSS engine can parse (no logical properties, no
 *      `:has()` selectors, no advanced color functions).
 *   2. **styles.css/scss** — replaced with the Tailwind base + utilities
 *      layer directives (no components layer; see ng-add for why).
 *   3. **package.json deps** — adds tailwindcss + the Lynx preset.
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
    const projectRoot = project.root as string;

    return chain([
      addTailwindConfig(projectRoot),
      updateStylesCss(sourceRoot),
      addTailwindDependencies(),
    ]);
  };

const addTailwindConfig = (projectRoot: string): Rule => {
  return (tree: Tree) => {
    const configPath = `${projectRoot ? projectRoot + '/' : ''}tailwind.config.ts`;
    // content: ['./src/**/*.ts'] scans only .ts files — AngularLynx components
    // inline their templates (no .html template files), so all class names
    // live in TypeScript source. Including .html in the glob would just slow
    // the watcher down without finding anything.
    const content = `import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';

const config: Config = {
  content: ['./src/**/*.ts'],
  presets: [preset],
};

export default config;
`;
    if (tree.exists(configPath)) {
      tree.overwrite(configPath, content);
    } else {
      tree.create(configPath, content);
    }
  };
};

const updateStylesCss = (sourceRoot: string): Rule => {
  return (tree: Tree) => {
    const cssPath = `${sourceRoot}/styles.css`;
    const scssPath = `${sourceRoot}/styles.scss`;
    // Prefer styles.scss if it exists (the user picked SCSS at `ng new` time)
    // — overwriting it with .css content would break their other imports.
    const targetPath = tree.exists(scssPath) ? scssPath : cssPath;

    // Only @tailwind base + utilities — no @tailwind components. Lynx's CSS
    // engine doesn't parse many component-layer reset rules (focus-visible
    // pseudo-class, form input pseudo-classes), which would produce
    // diagnostic noise at build time. The base layer ships with the Lynx
    // preset's own compatibility-safe normalize rules.
    const content = `@tailwind base;
@tailwind utilities;
`;

    if (tree.exists(targetPath)) {
      tree.overwrite(targetPath, content);
    } else {
      tree.create(cssPath, content);
    }
  };
};

const addTailwindDependencies = (): Rule => {
  return chain([
    addDependency('tailwindcss', VERSIONS.tailwindcss, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    addDependency('@lynx-js/tailwind-preset', VERSIONS.tailwindPreset, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
  ]);
};
